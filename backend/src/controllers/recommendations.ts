import { Request, Response, NextFunction } from 'express';
import { getRecommendations } from '../services/recommendations';
import { HttpError } from '../middleware/error';
import { query } from '../db/pool';

/**
 * GET /recommendations — returns max 10 ids.
 * Per spec: "which returns a maximum of 10 recommendations, containing only the id and nothing else."
 */
export async function listRecommendations(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');

    // Reject if profile is not complete.
    const { rows } = await query<{ is_complete: boolean }>(
      'SELECT is_complete FROM profiles WHERE user_id = $1',
      [req.userId]
    );
    if (rows.length === 0 || !rows[0].is_complete) {
      throw new HttpError(400, 'Complete your profile before viewing recommendations');
    }

    const recs = await getRecommendations(req.userId);
    // Spec: only id and nothing else.
    res.json(recs.map((r) => ({ id: r.id })));
  } catch (e) {
    next(e);
  }
}

/**
 * POST /recommendations/:id/dismiss — persists dismissal so this user is never recommended again.
 */
export async function dismissRecommendation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const targetId = req.params.id;
    if (targetId === req.userId) throw new HttpError(400, 'Cannot dismiss yourself');
    await query(
      `INSERT INTO dismissals (user_id, dismissed_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.userId, targetId]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
