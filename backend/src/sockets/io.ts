/**
 * Socket.io server.
 *
 * Auth via JWT in handshake.auth.token.
 * Each user joins a personal room: `user:<id>`.
 *
 * Events:
 *   client -> server : 'typing:start' { chatId }, 'typing:stop' { chatId }
 *   server -> client : 'message:new' Message
 *                      'message:read' { chatId, readerId, messageIds }
 *                      'typing:start' { chatId, fromId }, 'typing:stop' { chatId, fromId }
 *                      'presence:update' { userId, online: boolean }
 */
import { Server as HttpServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { query } from '../db/pool';

let io: IOServer | null = null;

/** Map<userId, Set<socketId>>: track online users with multi-tab support. */
const online = new Map<string, Set<string>>();

export function getIO(): IOServer | null {
  return io;
}

export function isOnline(userId: string): boolean {
  const set = online.get(userId);
  return !!set && set.size > 0;
}

export function initSocket(httpServer: HttpServer) {
  io = new IOServer(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
      (socket as any).userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId as string;
    const room = `user:${userId}`;
    socket.join(room);

    // Track presence
    let set = online.get(userId);
    if (!set) {
      set = new Set();
      online.set(userId, set);
      // Just went online — broadcast to everyone (simple; could be scoped to connections)
      io!.emit('presence:update', { userId, online: true });
    }
    set.add(socket.id);

    // Update last_seen_at (best-effort)
    query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId]).catch(() => {});

    socket.on('typing:start', async ({ chatId }: { chatId: string }) => {
      const other = await chatPartner(chatId, userId);
      if (!other) return;
      io!.to(`user:${other}`).emit('typing:start', { chatId, fromId: userId });
    });

    socket.on('typing:stop', async ({ chatId }: { chatId: string }) => {
      const other = await chatPartner(chatId, userId);
      if (!other) return;
      io!.to(`user:${other}`).emit('typing:stop', { chatId, fromId: userId });
    });

    socket.on('disconnect', () => {
      const s = online.get(userId);
      if (s) {
        s.delete(socket.id);
        if (s.size === 0) {
          online.delete(userId);
          query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId]).catch(() => {});
          io!.emit('presence:update', { userId, online: false });
        }
      }
    });
  });

  return io;
}

async function chatPartner(chatId: string, userId: string): Promise<string | null> {
  const { rows } = await query<{ user_a_id: string; user_b_id: string }>(
    'SELECT user_a_id, user_b_id FROM chats WHERE id = $1',
    [chatId]
  );
  if (rows.length === 0) return null;
  const c = rows[0];
  if (c.user_a_id !== userId && c.user_b_id !== userId) return null;
  return c.user_a_id === userId ? c.user_b_id : c.user_a_id;
}
