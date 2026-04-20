/**
 * Implements the required public REST surface:
 *   GET /users/:id         -> { id, displayName, avatarUrl }
 *   GET /users/:id/profile -> { id, aboutMe, age, gender, city }
 *   GET /users/:id/bio     -> { id, workoutTypes, experienceLevel, scheduleSlots, goals, lookingFor, gymName, intensity }
 *   GET /me, /me/profile, /me/bio  -> shortcuts for authenticated user
 *
 * Returns 404 if target not found OR viewer has no permission.
 * Never exposes email or password.
 */
import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool';
import { canView } from '../services/visibility';
import { HttpError } from '../middleware/error';
import type { UserRow, ProfileRow, BioRow } from '../types';

function notFound(): HttpError {
  return new HttpError(404, 'Not found');
}

/** Resolve :id — if literal 'me', use authenticated user. */
function resolveId(req: Request): string {
  const raw = req.params.id;
  if (raw === 'me' || raw === undefined) {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    return req.userId;
  }
  return raw;
}

async function ensureExistsAndVisible(viewerId: string, targetId: string): Promise<void> {
  // Exists?
  const u = await query('SELECT 1 FROM users WHERE id = $1', [targetId]);
  if (u.rowCount === 0) throw notFound();
  const allowed = await canView(viewerId, targetId);
  if (!allowed) throw notFound(); // 404 (not 403) — per spec
}

export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const id = resolveId(req);
    await ensureExistsAndVisible(req.userId, id);

    const { rows } = await query<UserRow>(
      'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
      [id]
    );
    if (rows.length === 0) throw notFound();
    const u = rows[0];
    res.json({ id: u.id, displayName: u.display_name, avatarUrl: u.avatar_url });
  } catch (e) {
    next(e);
  }
}

export async function getUserProfile(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const id = resolveId(req);
    await ensureExistsAndVisible(req.userId, id);

    const { rows } = await query<ProfileRow>(
      'SELECT user_id, about_me, age, gender, city, is_complete FROM profiles WHERE user_id = $1',
      [id]
    );
    if (rows.length === 0) throw notFound();
    const p = rows[0];
    res.json({
      id: p.user_id,
      aboutMe: p.about_me,
      age: p.age,
      gender: p.gender,
      city: p.city,
      isComplete: p.is_complete,
    });
  } catch (e) {
    next(e);
  }
}

export async function getUserBio(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const id = resolveId(req);
    await ensureExistsAndVisible(req.userId, id);

    const { rows } = await query<BioRow>(
      `SELECT user_id, workout_types, experience_level, schedule_slots, goals, looking_for, gym_name, intensity
         FROM bios WHERE user_id = $1`,
      [id]
    );
    if (rows.length === 0) throw notFound();
    const b = rows[0];
    res.json({
      id: b.user_id,
      workoutTypes: b.workout_types,
      experienceLevel: b.experience_level,
      scheduleSlots: b.schedule_slots,
      goals: b.goals,
      lookingFor: b.looking_for,
      gymName: b.gym_name,
      intensity: b.intensity,
    });
  } catch (e) {
    next(e);
  }
}

/** GET /me/email — only for authenticated user, private. Used by settings screen. */
export async function getMyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const { rows } = await query<UserRow>('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (rows.length === 0) throw notFound();
    res.json({ email: rows[0].email });
  } catch (e) {
    next(e);
  }
}
