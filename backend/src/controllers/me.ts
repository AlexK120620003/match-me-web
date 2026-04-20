/**
 * Endpoints for mutating the authenticated user's own data.
 *   PUT  /me              -> displayName
 *   PUT  /me/profile      -> aboutMe, age, gender, city
 *   PUT  /me/bio          -> workoutTypes, experienceLevel, scheduleSlots, goals, lookingFor, gymName, intensity
 *   POST /me/avatar       -> multipart upload 'avatar'
 *   DELETE /me/avatar     -> remove avatar
 *
 * When profile + bio have enough data, profiles.is_complete flips to TRUE.
 * Profile completeness = 5+ bio data points filled (arrays non-empty count as 1 each).
 */
import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { query } from '../db/pool';
import { HttpError } from '../middleware/error';
import { env } from '../config/env';

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(60),
});

const updateProfileSchema = z.object({
  aboutMe: z.string().max(2000).nullable().optional(),
  age: z.number().int().min(14).max(120).nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  city: z.string().min(1).max(100).nullable().optional(),
});

const WORKOUT_TYPES = [
  'strength',
  'cardio',
  'yoga',
  'crossfit',
  'calisthenics',
  'hiit',
  'powerlifting',
  'bodybuilding',
  'running',
  'cycling',
  'swimming',
  'boxing',
  'martial_arts',
] as const;

const GOALS = [
  'lose_weight',
  'build_muscle',
  'endurance',
  'strength',
  'flexibility',
  'competition_prep',
  'general_fitness',
  'recomp',
] as const;

const LOOKING_FOR = ['spotter', 'motivator', 'same_level', 'trainer', 'trainee', 'accountability'] as const;

const SCHEDULE_SLOTS = [
  'mon_morning', 'mon_afternoon', 'mon_evening',
  'tue_morning', 'tue_afternoon', 'tue_evening',
  'wed_morning', 'wed_afternoon', 'wed_evening',
  'thu_morning', 'thu_afternoon', 'thu_evening',
  'fri_morning', 'fri_afternoon', 'fri_evening',
  'sat_morning', 'sat_afternoon', 'sat_evening',
  'sun_morning', 'sun_afternoon', 'sun_evening',
] as const;

const updateBioSchema = z.object({
  workoutTypes: z.array(z.enum(WORKOUT_TYPES)).max(20).optional(),
  experienceLevel: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(),
  scheduleSlots: z.array(z.enum(SCHEDULE_SLOTS)).max(42).optional(),
  goals: z.array(z.enum(GOALS)).max(8).optional(),
  lookingFor: z.array(z.enum(LOOKING_FOR)).max(6).optional(),
  gymName: z.string().max(100).nullable().optional(),
  intensity: z.enum(['chill', 'moderate', 'intense']).nullable().optional(),
});

async function recomputeCompleteness(userId: string) {
  const { rows } = await query<{
    age: number | null;
    city: string | null;
    workout_types: string[];
    experience_level: string | null;
    schedule_slots: string[];
    goals: string[];
    looking_for: string[];
  }>(
    `SELECT p.age, p.city,
            b.workout_types, b.experience_level, b.schedule_slots, b.goals, b.looking_for
       FROM profiles p
       JOIN bios b ON b.user_id = p.user_id
      WHERE p.user_id = $1`,
    [userId]
  );
  if (rows.length === 0) return;
  const r = rows[0];
  // Require 5+ bio data points filled: workout_types, schedule_slots, goals, looking_for, experience_level, plus profile.city.
  let filled = 0;
  if (r.workout_types && r.workout_types.length > 0) filled++;
  if (r.experience_level) filled++;
  if (r.schedule_slots && r.schedule_slots.length > 0) filled++;
  if (r.goals && r.goals.length > 0) filled++;
  if (r.looking_for && r.looking_for.length > 0) filled++;
  if (r.city) filled++;
  const complete = filled >= 5;
  await query(
    'UPDATE profiles SET is_complete = $1, updated_at = NOW() WHERE user_id = $2',
    [complete, userId]
  );
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const body = updateUserSchema.parse(req.body);
    await query(
      'UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2',
      [body.displayName, req.userId]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export async function updateMyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const body = updateProfileSchema.parse(req.body);
    await query(
      `UPDATE profiles
          SET about_me = COALESCE($1, about_me),
              age = COALESCE($2, age),
              gender = COALESCE($3, gender),
              city = COALESCE($4, city),
              updated_at = NOW()
        WHERE user_id = $5`,
      [
        body.aboutMe ?? null,
        body.age ?? null,
        body.gender ?? null,
        body.city ?? null,
        req.userId,
      ]
    );
    await recomputeCompleteness(req.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export async function updateMyBio(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const body = updateBioSchema.parse(req.body);
    await query(
      `UPDATE bios
          SET workout_types   = COALESCE($1, workout_types),
              experience_level= COALESCE($2, experience_level),
              schedule_slots  = COALESCE($3, schedule_slots),
              goals           = COALESCE($4, goals),
              looking_for     = COALESCE($5, looking_for),
              gym_name        = COALESCE($6, gym_name),
              intensity       = COALESCE($7, intensity),
              updated_at = NOW()
        WHERE user_id = $8`,
      [
        body.workoutTypes ?? null,
        body.experienceLevel ?? null,
        body.scheduleSlots ?? null,
        body.goals ?? null,
        body.lookingFor ?? null,
        body.gymName ?? null,
        body.intensity ?? null,
        req.userId,
      ]
    );
    await recomputeCompleteness(req.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export async function uploadAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    if (!req.file) throw new HttpError(400, 'No file uploaded');

    const publicUrl = `/uploads/${path.basename(req.file.path)}`;

    // Remove previous avatar file if it was a local upload
    const prev = await query<{ avatar_url: string | null }>(
      'SELECT avatar_url FROM users WHERE id = $1',
      [req.userId]
    );
    if (prev.rows[0]?.avatar_url && prev.rows[0].avatar_url.startsWith('/uploads/')) {
      const prevPath = path.join(env.UPLOAD_DIR, path.basename(prev.rows[0].avatar_url));
      fs.promises.unlink(prevPath).catch(() => { /* ignore */ });
    }

    await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [
      publicUrl,
      req.userId,
    ]);
    res.json({ avatarUrl: publicUrl });
  } catch (e) {
    next(e);
  }
}

export async function deleteAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const prev = await query<{ avatar_url: string | null }>(
      'SELECT avatar_url FROM users WHERE id = $1',
      [req.userId]
    );
    if (prev.rows[0]?.avatar_url && prev.rows[0].avatar_url.startsWith('/uploads/')) {
      const prevPath = path.join(env.UPLOAD_DIR, path.basename(prev.rows[0].avatar_url));
      fs.promises.unlink(prevPath).catch(() => { /* ignore */ });
    }
    await query('UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1', [req.userId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
