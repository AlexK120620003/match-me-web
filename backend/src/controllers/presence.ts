import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool';
import { HttpError } from '../middleware/error';
import { isOnline } from '../sockets/io';
import { canView } from '../services/visibility';

/**
 * GET /users/:id/presence — { online: boolean, lastSeenAt: string }
 * Only visible to users who can view this profile (404 otherwise).
 */
export async function getPresence(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const targetId = req.params.id === 'me' ? req.userId : req.params.id;

    const { rows } = await query<{ last_seen_at: string }>(
      'SELECT last_seen_at FROM users WHERE id = $1',
      [targetId]
    );
    if (rows.length === 0) throw new HttpError(404, 'Not found');

    const allowed = await canView(req.userId, targetId);
    if (!allowed) throw new HttpError(404, 'Not found');

    res.json({ online: isOnline(targetId), lastSeenAt: rows[0].last_seen_at });
  } catch (e) {
    next(e);
  }
}
