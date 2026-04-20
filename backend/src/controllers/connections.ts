/**
 * Connection lifecycle:
 *   POST /connections/request/:id  -> create pending request (me -> :id)
 *   POST /connections/:id/accept   -> accept pending request (:id -> me)
 *   POST /connections/:id/decline  -> decline pending request (:id -> me)
 *   DELETE /connections/:id        -> disconnect (both directions)
 *   GET  /connections              -> list accepted connection ids
 *   GET  /connections/requests     -> list incoming pending requests (with ids + requester info for UI)
 *   GET  /connections/outgoing     -> list outgoing pending requests (ids only)
 */
import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool';
import { HttpError } from '../middleware/error';

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function ensureChat(a: string, b: string): Promise<void> {
  const [ua, ub] = orderedPair(a, b);
  await query(
    `INSERT INTO chats (user_a_id, user_b_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [ua, ub]
  );
}

export async function requestConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const targetId = req.params.id;
    if (targetId === req.userId) throw new HttpError(400, 'Cannot request connection with yourself');

    // Ensure target exists
    const t = await query('SELECT 1 FROM users WHERE id = $1', [targetId]);
    if (t.rowCount === 0) throw new HttpError(404, 'Not found');

    // If a row already exists in either direction: handle cleanly.
    const existing = await query<{ id: string; requester_id: string; addressee_id: string; status: string }>(
      `SELECT id, requester_id, addressee_id, status FROM connections
        WHERE (requester_id = $1 AND addressee_id = $2)
           OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, targetId]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      if (row.status === 'accepted') throw new HttpError(409, 'Already connected');
      if (row.status === 'pending') {
        // If reverse-direction pending and current user is the addressee, auto-accept.
        if (row.requester_id === targetId && row.addressee_id === req.userId) {
          await query(
            `UPDATE connections SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
            [row.id]
          );
          await ensureChat(req.userId, targetId);
          return res.json({ status: 'accepted' });
        }
        throw new HttpError(409, 'Request already pending');
      }
      if (row.status === 'declined') {
        // Allow re-request after decline.
        await query(
          `UPDATE connections
              SET requester_id = $1, addressee_id = $2, status = 'pending', updated_at = NOW()
            WHERE id = $3`,
          [req.userId, targetId, row.id]
        );
        return res.json({ status: 'pending' });
      }
    }

    await query(
      `INSERT INTO connections (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`,
      [req.userId, targetId]
    );
    res.status(201).json({ status: 'pending' });
  } catch (e) {
    next(e);
  }
}

export async function acceptConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const otherId = req.params.id;

    const result = await query(
      `UPDATE connections
          SET status = 'accepted', updated_at = NOW()
        WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [otherId, req.userId]
    );
    if (result.rowCount === 0) throw new HttpError(404, 'No pending request');
    await ensureChat(req.userId, otherId);
    res.json({ status: 'accepted' });
  } catch (e) {
    next(e);
  }
}

export async function declineConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const otherId = req.params.id;
    const result = await query(
      `UPDATE connections
          SET status = 'declined', updated_at = NOW()
        WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [otherId, req.userId]
    );
    if (result.rowCount === 0) throw new HttpError(404, 'No pending request');
    res.json({ status: 'declined' });
  } catch (e) {
    next(e);
  }
}

export async function disconnect(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const otherId = req.params.id;
    const result = await query(
      `DELETE FROM connections
        WHERE ((requester_id = $1 AND addressee_id = $2)
            OR (requester_id = $2 AND addressee_id = $1))
          AND status = 'accepted'`,
      [req.userId, otherId]
    );
    if (result.rowCount === 0) throw new HttpError(404, 'Not connected');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

/** GET /connections — spec: "containing only the id and nothing else." */
export async function listConnections(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const { rows } = await query<{ id: string }>(
      `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
         FROM connections
        WHERE (requester_id = $1 OR addressee_id = $1)
          AND status = 'accepted'
        ORDER BY updated_at DESC`,
      [req.userId]
    );
    res.json(rows.map((r) => ({ id: r.id })));
  } catch (e) {
    next(e);
  }
}

/** Incoming pending requests — UI-facing, returns ids so UI can fetch /users/:id. */
export async function listIncomingRequests(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const { rows } = await query<{ id: string; created_at: string }>(
      `SELECT requester_id AS id, created_at
         FROM connections
        WHERE addressee_id = $1 AND status = 'pending'
        ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

/** Outgoing pending requests — to let UI mark "pending" state. */
export async function listOutgoingRequests(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const { rows } = await query<{ id: string }>(
      `SELECT addressee_id AS id
         FROM connections
        WHERE requester_id = $1 AND status = 'pending'
        ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}
