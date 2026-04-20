/**
 * Recommendation algorithm for gym/workout buddies.
 *
 * Scoring (total 100 pts, normalized):
 *   - Workout types overlap         (0..25)   Jaccard similarity × 25
 *   - Schedule slots overlap        (0..20)   Jaccard × 20  (huge — if you can't train together, pointless)
 *   - Experience level compatibility (0..15)  same=15, ±1=8, else=0  (big gap = bad match)
 *   - Goals overlap                 (0..15)   Jaccard × 15
 *   - Looking-for complementarity   (0..10)   symmetric — both ask for same thing (same_level) OR role pair (spotter↔spotter, trainer↔trainee)
 *   - Same city                     (0..10)   hard filter below; bonus if gym matches
 *   - Same gym                      (0..5)    exact name match (case-insensitive)
 *
 * Hard filters (exclusions):
 *   - Self
 *   - Not-complete profile
 *   - Already dismissed by viewer
 *   - Already connected (accepted) or declined
 *   - Different city (if both have a city set)
 *
 * Weak-match threshold: 30/100. Below that we skip.
 * Maximum returned: 10.
 */
import { query } from '../db/pool';

const LEVEL_RANK: Record<string, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

// Role pairs that are "complementary" (A looks for B -> B looks for A)
const COMPLEMENTARY_ROLES: Array<[string, string]> = [
  ['spotter', 'spotter'],
  ['motivator', 'motivator'],
  ['same_level', 'same_level'],
  ['trainer', 'trainee'],
  ['trainee', 'trainer'],
];

interface ScoringCandidate {
  id: string;
  workout_types: string[];
  experience_level: string | null;
  schedule_slots: string[];
  goals: string[];
  looking_for: string[];
  gym_name: string | null;
  city: string | null;
}

interface ScoringMe {
  id: string;
  workout_types: string[];
  experience_level: string | null;
  schedule_slots: string[];
  goals: string[];
  looking_for: string[];
  gym_name: string | null;
  city: string | null;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function levelScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const ra = LEVEL_RANK[a];
  const rb = LEVEL_RANK[b];
  if (ra === undefined || rb === undefined) return 0;
  const diff = Math.abs(ra - rb);
  if (diff === 0) return 15;
  if (diff === 1) return 8;
  return 0;
}

function lookingForScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  // Direct overlap
  const setB = new Set(b);
  for (const x of a) if (setB.has(x)) return 10;
  // Complementary role pair?
  const setA = new Set(a);
  for (const [from, to] of COMPLEMENTARY_ROLES) {
    if (setA.has(from) && setB.has(to)) return 10;
  }
  return 0;
}

export function scoreMatch(me: ScoringMe, other: ScoringCandidate): number {
  const workout = jaccard(me.workout_types, other.workout_types) * 25;
  const schedule = jaccard(me.schedule_slots, other.schedule_slots) * 20;
  const level = levelScore(me.experience_level, other.experience_level);
  const goals = jaccard(me.goals, other.goals) * 15;
  const looking = lookingForScore(me.looking_for, other.looking_for);
  const city = me.city && other.city && me.city.toLowerCase() === other.city.toLowerCase() ? 10 : 0;
  const gym =
    me.gym_name && other.gym_name && me.gym_name.toLowerCase() === other.gym_name.toLowerCase()
      ? 5
      : 0;
  return Math.round(workout + schedule + level + goals + looking + city + gym);
}

const WEAK_THRESHOLD = 30;
const MAX_RESULTS = 10;

export async function getRecommendations(userId: string): Promise<Array<{ id: string; score: number }>> {
  // Load requester's bio + profile
  const meRes = await query<ScoringMe>(
    `SELECT u.id,
            b.workout_types, b.experience_level, b.schedule_slots, b.goals, b.looking_for, b.gym_name,
            p.city
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       JOIN bios b     ON b.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  if (meRes.rowCount === 0) return [];
  const me = meRes.rows[0];

  // Candidate set: all other users with complete profile, not dismissed, not already connected/declined.
  // City filter: if I have a city, only people in the same city (simple location sense-check).
  const cityClause = me.city ? 'AND LOWER(p.city) = LOWER($2)' : '';
  const params: any[] = [userId];
  if (me.city) params.push(me.city);

  const sql = `
    SELECT u.id,
           b.workout_types, b.experience_level, b.schedule_slots, b.goals, b.looking_for, b.gym_name,
           p.city
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      JOIN bios b     ON b.user_id = u.id
     WHERE u.id <> $1
       AND p.is_complete = TRUE
       ${cityClause}
       AND u.id NOT IN (SELECT dismissed_id FROM dismissals WHERE user_id = $1)
       AND u.id NOT IN (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
           FROM connections
          WHERE (requester_id = $1 OR addressee_id = $1)
            AND status IN ('accepted','declined','pending')
       )
     LIMIT 500
  `;
  const candidatesRes = await query<ScoringCandidate>(sql, params);

  const scored = candidatesRes.rows
    .map((c) => ({ id: c.id, score: scoreMatch(me, c) }))
    .filter((x) => x.score >= WEAK_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  return scored;
}
