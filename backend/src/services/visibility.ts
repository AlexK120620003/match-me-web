/**
 * Profile visibility rules.
 *
 * A user X can view user Y's profile if and only if one of:
 *   - X == Y (self)
 *   - Y is currently recommended to X (i.e. passes recommendation filters)
 *   - There is an outstanding (pending) connection request between them (either direction)
 *   - They are connected (accepted)
 */
import { query } from '../db/pool';

export async function canView(viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return true;

  // Connected or pending request?
  const conn = await query<{ status: string }>(
    `SELECT status FROM connections
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)
     LIMIT 1`,
    [viewerId, targetId]
  );
  if (conn.rowCount > 0) {
    const status = conn.rows[0].status;
    if (status === 'pending' || status === 'accepted') return true;
  }

  // Is target currently a recommendation for viewer?
  // Re-check the main filters here (not full scoring) including city match.
  const rec = await query<{ user_id: string }>(
    `SELECT u.id AS user_id
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       JOIN bios b     ON b.user_id = u.id
       LEFT JOIN profiles vp ON vp.user_id = $1
      WHERE u.id = $2
        AND p.is_complete = TRUE
        AND (vp.city IS NULL OR LOWER(p.city) = LOWER(vp.city))
        AND u.id NOT IN (SELECT dismissed_id FROM dismissals WHERE user_id = $1)
        AND u.id NOT IN (
          SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
            FROM connections
           WHERE (requester_id = $1 OR addressee_id = $1)
             AND status IN ('accepted','declined')
        )
      LIMIT 1`,
    [viewerId, targetId]
  );
  return rec.rowCount > 0;
}
