/**
 * Chat REST endpoints:
 *   GET  /chats                           -> list of chats for me, most-recent-first, with last message + unread count
 *   GET  /chats/:chatId/messages?before=&limit=  -> paginated history (newest first)
 *   POST /chats/:chatId/messages          -> send a message (also broadcasts via socket.io)
 *   POST /chats/:chatId/read              -> mark all messages in chat as read (by me)
 *   GET  /chats/unread-count              -> total unread messages across chats
 *
 * Chat is auto-created on connection accept; this only manages messages.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { HttpError } from '../middleware/error';
import { getIO } from '../sockets/io';

async function assertChatParticipant(chatId: string, userId: string): Promise<{ otherId: string }> {
  const { rows } = await query<{ user_a_id: string; user_b_id: string }>(
    'SELECT user_a_id, user_b_id FROM chats WHERE id = $1',
    [chatId]
  );
  if (rows.length === 0) throw new HttpError(404, 'Chat not found');
  const chat = rows[0];
  if (chat.user_a_id !== userId && chat.user_b_id !== userId) {
    throw new HttpError(404, 'Chat not found');
  }
  return { otherId: chat.user_a_id === userId ? chat.user_b_id : chat.user_a_id };
}

export async function listChats(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const { rows } = await query<{
      id: string;
      other_id: string;
      last_body: string | null;
      last_created_at: string | null;
      last_sender_id: string | null;
      unread_count: string; // pg returns bigint as string
    }>(
      `SELECT c.id,
              CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS other_id,
              lm.body      AS last_body,
              lm.created_at AS last_created_at,
              lm.sender_id AS last_sender_id,
              COALESCE((
                SELECT COUNT(*) FROM messages m
                 WHERE m.chat_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL
              ), 0) AS unread_count
         FROM chats c
         LEFT JOIN LATERAL (
           SELECT body, created_at, sender_id
             FROM messages
            WHERE chat_id = c.id
            ORDER BY created_at DESC
            LIMIT 1
         ) lm ON TRUE
        WHERE (c.user_a_id = $1 OR c.user_b_id = $1)
          AND EXISTS (
            SELECT 1 FROM connections
             WHERE ((requester_id = c.user_a_id AND addressee_id = c.user_b_id)
                 OR (requester_id = c.user_b_id AND addressee_id = c.user_a_id))
               AND status = 'accepted'
          )
        ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [req.userId]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        otherId: r.other_id,
        lastMessage: r.last_body
          ? { body: r.last_body, createdAt: r.last_created_at, senderId: r.last_sender_id }
          : null,
        unreadCount: Number(r.unread_count),
      }))
    );
  } catch (e) {
    next(e);
  }
}

export async function getMessages(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const chatId = req.params.chatId;
    await assertChatParticipant(chatId, req.userId);

    const limit = Math.min(Number(req.query.limit ?? 30), 100);
    const before = typeof req.query.before === 'string' ? req.query.before : null;

    const params: any[] = [chatId, limit];
    let cursorClause = '';
    if (before) {
      cursorClause = 'AND created_at < $3';
      params.push(before);
    }

    const { rows } = await query(
      `SELECT id, chat_id, sender_id, body, created_at, read_at
         FROM messages
        WHERE chat_id = $1 ${cursorClause}
        ORDER BY created_at DESC
        LIMIT $2`,
      params
    );

    res.json(rows);
  } catch (e) {
    next(e);
  }
}

const sendSchema = z.object({
  body: z.string().min(1).max(2000),
});

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const chatId = req.params.chatId;
    const { otherId } = await assertChatParticipant(chatId, req.userId);
    const body = sendSchema.parse(req.body);

    // Ensure users are still connected
    const conn = await query(
      `SELECT 1 FROM connections
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'`,
      [req.userId, otherId]
    );
    if (conn.rowCount === 0) throw new HttpError(403, 'You must be connected to send messages');

    const { rows } = await query<{
      id: string; chat_id: string; sender_id: string; body: string; created_at: string; read_at: string | null;
    }>(
      `INSERT INTO messages (chat_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, chat_id, sender_id, body, created_at, read_at`,
      [chatId, req.userId, body.body]
    );
    const msg = rows[0];

    // Broadcast via socket.io to both participants' rooms.
    const io = getIO();
    if (io) {
      io.to(`user:${req.userId}`).emit('message:new', msg);
      io.to(`user:${otherId}`).emit('message:new', msg);
    }

    res.status(201).json(msg);
  } catch (e) {
    next(e);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const chatId = req.params.chatId;
    const { otherId } = await assertChatParticipant(chatId, req.userId);
    const result = await query<{ id: string }>(
      `UPDATE messages
          SET read_at = NOW()
        WHERE chat_id = $1 AND sender_id <> $2 AND read_at IS NULL
        RETURNING id`,
      [chatId, req.userId]
    );

    // Notify the other participant that their messages have been read.
    const io = getIO();
    if (io && result.rowCount > 0) {
      io.to(`user:${otherId}`).emit('message:read', {
        chatId,
        readerId: req.userId,
        messageIds: result.rows.map((r) => r.id),
      });
    }
    res.json({ ok: true, count: result.rowCount });
  } catch (e) {
    next(e);
  }
}

export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE (c.user_a_id = $1 OR c.user_b_id = $1)
          AND m.sender_id <> $1
          AND m.read_at IS NULL`,
      [req.userId]
    );
    res.json({ count: Number(rows[0].count) });
  } catch (e) {
    next(e);
  }
}
