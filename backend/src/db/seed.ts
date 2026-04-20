/**
 * Seed 120 fictional gym/workout buddies spread across a handful of cities.
 * Password for ALL seeded users: "password123" (for review convenience).
 *
 * Distribution:
 *   - 6 cities (even spread), randomized gym names per city (so same-gym bonus actually triggers).
 *   - Experience: 30% beginner, 45% intermediate, 25% advanced.
 *   - Goals, workout types, schedule slots picked from realistic pools.
 *   - 5-10 connections + a few pending requests between random users.
 */
import bcrypt from 'bcrypt';
import { faker } from '@faker-js/faker';
import { pool, query } from './pool';
import { env } from '../config/env';

const CITIES = ['Tallinn', 'Tartu', 'Parnu', 'Narva', 'Helsinki', 'Riga'];

const GYMS_BY_CITY: Record<string, string[]> = {
  Tallinn:  ['MyFitness Rocca', 'MyFitness Kristiine', 'Arena Fitness', 'Reval Sport'],
  Tartu:    ['MyFitness Lõunakeskus', 'Aura Spa', 'Tartu Ülikooli Akadeemiline Spordiklubi'],
  Parnu:    ['MyFitness Parnu', 'Tervise Paradiis Gym'],
  Narva:    ['Astra Gym', 'Narva Sport Center'],
  Helsinki: ['Elixia Kamppi', 'Sats Pasila', 'Forever Ruoholahti'],
  Riga:     ['Lemon Gym Centrs', 'My Fitness Alfa', 'Gym&Fitness Riga'],
};

const WORKOUT_TYPES = ['strength', 'cardio', 'yoga', 'crossfit', 'calisthenics', 'hiit', 'powerlifting', 'bodybuilding', 'running', 'cycling', 'swimming', 'boxing', 'martial_arts'];
const GOALS = ['lose_weight', 'build_muscle', 'endurance', 'strength', 'flexibility', 'competition_prep', 'general_fitness', 'recomp'];
const LOOKING_FOR = ['spotter', 'motivator', 'same_level', 'trainer', 'trainee', 'accountability'];
const INTENSITIES = ['chill', 'moderate', 'intense'];
const GENDERS = ['male', 'female', 'other'];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIMES = ['morning', 'afternoon', 'evening'];

function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = faker.number.int({ min: Math.min(min, arr.length), max: Math.min(max, arr.length) });
  return faker.helpers.arrayElements(arr, n);
}

function pickLevel(): string {
  const r = Math.random();
  if (r < 0.30) return 'beginner';
  if (r < 0.75) return 'intermediate';
  return 'advanced';
}

function makeSchedule(): string[] {
  // 3-8 slots, mostly weekday evenings + weekend mornings
  const slots: string[] = [];
  const count = faker.number.int({ min: 3, max: 8 });
  const used = new Set<string>();
  while (slots.length < count) {
    const d = faker.helpers.arrayElement(DAYS);
    const t = faker.helpers.arrayElement(TIMES);
    const key = `${d}_${t}`;
    if (!used.has(key)) {
      used.add(key);
      slots.push(key);
    }
  }
  return slots;
}

async function main() {
  console.log('[seed] starting...');
  const TOTAL = 120;
  const hash = await bcrypt.hash('password123', env.BCRYPT_ROUNDS);

  const client = await pool.connect();
  const userIds: string[] = [];
  try {
    await client.query('BEGIN');

    for (let i = 0; i < TOTAL; i++) {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      const displayName = `${firstName} ${lastName.charAt(0)}.`;
      const email = `user${i + 1}+${faker.string.alphanumeric(4).toLowerCase()}@matchme.test`;

      const city = faker.helpers.arrayElement(CITIES);
      const gym = faker.helpers.arrayElement(GYMS_BY_CITY[city]);
      const age = faker.number.int({ min: 18, max: 55 });
      const gender = faker.helpers.arrayElement(GENDERS);
      const aboutMe = faker.lorem.sentences({ min: 1, max: 3 });

      const workoutTypes = pickN(WORKOUT_TYPES, 1, 4);
      const level = pickLevel();
      const schedule = makeSchedule();
      const goals = pickN(GOALS, 1, 3);
      const lookingFor = pickN(LOOKING_FOR, 1, 3);
      const intensity = faker.helpers.arrayElement(INTENSITIES);

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [email, hash, displayName]
      );
      const uid: string = userRes.rows[0].id;
      userIds.push(uid);

      await client.query(
        `INSERT INTO profiles (user_id, about_me, age, gender, city, is_complete)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [uid, aboutMe, age, gender, city]
      );

      await client.query(
        `INSERT INTO bios (user_id, workout_types, experience_level, schedule_slots, goals, looking_for, gym_name, intensity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uid, workoutTypes, level, schedule, goals, lookingFor, gym, intensity]
      );
    }

    // Random connections: accepted + pending
    const pairs = new Set<string>();
    const keyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const mkConnection = async (status: 'accepted' | 'pending') => {
      for (let tries = 0; tries < 20; tries++) {
        const a = faker.helpers.arrayElement(userIds);
        const b = faker.helpers.arrayElement(userIds);
        if (a === b) continue;
        const k = keyOf(a, b);
        if (pairs.has(k)) continue;
        pairs.add(k);
        await client.query(
          `INSERT INTO connections (requester_id, addressee_id, status) VALUES ($1, $2, $3)`,
          [a, b, status]
        );
        if (status === 'accepted') {
          const [ua, ub] = a < b ? [a, b] : [b, a];
          await client.query(
            `INSERT INTO chats (user_a_id, user_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [ua, ub]
          );
        }
        return;
      }
    };
    for (let i = 0; i < 40; i++) await mkConnection('accepted');
    for (let i = 0; i < 20; i++) await mkConnection('pending');

    // Seed a demo user for quick login: "demo@matchme.test" / "password123"
    const demoEmail = 'demo@matchme.test';
    const existingDemo = await client.query('SELECT id FROM users WHERE email = $1', [demoEmail]);
    if (existingDemo.rowCount === 0) {
      const demoRes = await client.query(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [demoEmail, hash, 'Demo User']
      );
      const demoId: string = demoRes.rows[0].id;
      await client.query(
        `INSERT INTO profiles (user_id, about_me, age, gender, city, is_complete) VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [demoId, 'I love lifting heavy things and putting them back down.', 28, 'other', 'Tallinn', true]
      );
      await client.query(
        `INSERT INTO bios (user_id, workout_types, experience_level, schedule_slots, goals, looking_for, gym_name, intensity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          demoId,
          ['strength', 'powerlifting', 'crossfit'],
          'intermediate',
          ['mon_evening', 'wed_evening', 'fri_evening', 'sat_morning'],
          ['build_muscle', 'strength'],
          ['spotter', 'same_level', 'accountability'],
          'MyFitness Rocca',
          'intense',
        ]
      );
      console.log(`[seed] demo user: ${demoEmail} / password123`);
    }

    await client.query('COMMIT');
    console.log(`[seed] inserted ${userIds.length} fictional users + connections + demo user ✓`);
    console.log('[seed] all seeded passwords: "password123"');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
