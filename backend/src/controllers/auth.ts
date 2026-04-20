import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query } from '../db/pool';
import { env } from '../config/env';
import { signToken } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import type { UserRow } from '../types';

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(100),
  displayName: z.string().min(1).max(60),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(100),
});

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await query<UserRow>('SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing.rowCount > 0) {
      throw new HttpError(409, 'Email already in use');
    }

    const hash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);

    const { rows } = await query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [body.email, hash, body.displayName]
    );
    const userId = rows[0].id;

    // Create empty profile/bio so other endpoints can UPDATE safely.
    await query('INSERT INTO profiles (user_id) VALUES ($1)', [userId]);
    await query('INSERT INTO bios (user_id) VALUES ($1)', [userId]);

    const token = signToken(userId);
    res.status(201).json({ token, userId });
  } catch (e) {
    next(e);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const body = loginSchema.parse(req.body);

    const { rows } = await query<UserRow>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [body.email]
    );
    if (rows.length === 0) {
      // Don't reveal whether email exists.
      throw new HttpError(401, 'Invalid email or password');
    }
    const ok = await bcrypt.compare(body.password, rows[0].password_hash);
    if (!ok) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const token = signToken(rows[0].id);
    await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [rows[0].id]);
    res.json({ token, userId: rows[0].id });
  } catch (e) {
    next(e);
  }
}

/** Client-side logout is just discarding the token. Endpoint is a placeholder for audit/logging. */
export async function logout(_req: Request, res: Response) {
  res.json({ ok: true });
}
