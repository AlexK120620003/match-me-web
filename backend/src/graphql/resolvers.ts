/**
 * GraphQL resolvers — mirrors the full REST API surface.
 * Auth context is extracted from the Authorization header in index.ts.
 */
import { GraphQLError } from 'graphql';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { query } from '../db/pool';
import { env } from '../config/env';
import { signToken } from '../middleware/auth';
import { canView } from '../services/visibility';
import { getRecommendations } from '../services/recommendations';
import { getIO, isOnline } from '../sockets/io';

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

export interface GqlContext {
  userId: string | null;
}

function requireAuth(ctx: GqlContext): string {
  if (!ctx.userId) {
    throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  return ctx.userId;
}

/* ------------------------------------------------------------------ */
/*  Row → GraphQL mappers                                             */
/* ------------------------------------------------------------------ */

function mapUser(row: any) {
  return { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url };
}

function mapProfile(row: any) {
  return {
    id: row.user_id,
    aboutMe: row.about_me,
    age: row.age,
    gender: row.gender,
    city: row.city,
    isComplete: row.is_complete,
  };
}

function mapBio(row: any) {
  return {
    id: row.user_id,
    workoutTypes: row.workout_types ?? [],
    experienceLevel: row.experience_level,
    scheduleSlots: row.schedule_slots ?? [],
    goals: row.goals ?? [],
    lookingFor: row.looking_for ?? [],
    gymName: row.gym_name,
    intensity: row.intensity,
  };
}

function mapMessage(row: any) {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                    */
/* ------------------------------------------------------------------ */

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function ensureChat(a: string, b: string) {
  const [ua, ub] = orderedPair(a, b);
  await query(
    'INSERT INTO chats (user_a_id, user_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [ua, ub],
  );
}

async function recomputeCompleteness(userId: string) {
  const { rows } = await query<any>(
    `SELECT p.age, p.city,
            b.workout_types, b.experience_level, b.schedule_slots, b.goals, b.looking_for
       FROM profiles p
       JOIN bios b ON b.user_id = p.user_id
      WHERE p.user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return;
  const r = rows[0];
  let filled = 0;
  if (r.workout_types?.length > 0) filled++;
  if (r.experience_level) filled++;
  if (r.schedule_slots?.length > 0) filled++;
  if (r.goals?.length > 0) filled++;
  if (r.looking_for?.length > 0) filled++;
  if (r.city) filled++;
  await query('UPDATE profiles SET is_complete = $1, updated_at = NOW() WHERE user_id = $2', [
    filled >= 5,
    userId,
  ]);
}

/* ------------------------------------------------------------------ */
/*  Resolvers                                                         */
/* ------------------------------------------------------------------ */

export const resolvers = {
  /* ============================================================== */
  /*  QUERIES                                                       */
  /* ============================================================== */
  Query: {
    user: async (_: any, { id }: { id: string }, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
        [id],
      );
      if (rows.length === 0) return null;
      const allowed = await canView(userId, id);
      if (!allowed) return null;
      return mapUser(rows[0]);
    },

    bio: async (_: any, { id }: { id: string }, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const exists = await query('SELECT 1 FROM users WHERE id = $1', [id]);
      if (exists.rowCount === 0) return null;
      const allowed = await canView(userId, id);
      if (!allowed) return null;
      const { rows } = await query(
        'SELECT user_id, workout_types, experience_level, schedule_slots, goals, looking_for, gym_name, intensity FROM bios WHERE user_id = $1',
        [id],
      );
      if (rows.length === 0) return null;
      return mapBio(rows[0]);
    },

    profile: async (_: any, { id }: { id: string }, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const exists = await query('SELECT 1 FROM users WHERE id = $1', [id]);
      if (exists.rowCount === 0) return null;
      const allowed = await canView(userId, id);
      if (!allowed) return null;
      const { rows } = await query(
        'SELECT user_id, about_me, age, gender, city, is_complete FROM profiles WHERE user_id = $1',
        [id],
      );
      if (rows.length === 0) return null;
      return mapProfile(rows[0]);
    },

    me: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
        [userId],
      );
      return rows.length > 0 ? mapUser(rows[0]) : null;
    },

    myBio: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query(
        'SELECT user_id, workout_types, experience_level, schedule_slots, goals, looking_for, gym_name, intensity FROM bios WHERE user_id = $1',
        [userId],
      );
      return rows.length > 0 ? mapBio(rows[0]) : null;
    },

    myProfile: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query(
        'SELECT user_id, about_me, age, gender, city, is_complete FROM profiles WHERE user_id = $1',
        [userId],
      );
      return rows.length > 0 ? mapProfile(rows[0]) : null;
    },

    myEmail: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query('SELECT email FROM users WHERE id = $1', [userId]);
      if (rows.length === 0) throw new GraphQLError('User not found');
      return rows[0].email;
    },

    recommendations: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows: profRows } = await query<any>(
        'SELECT is_complete FROM profiles WHERE user_id = $1',
        [userId],
      );
      if (!profRows[0]?.is_complete) {
        throw new GraphQLError('Complete your profile before viewing recommendations');
      }
      const recs = await getRecommendations(userId);
      if (recs.length === 0) return [];
      const ids = recs.map((r) => r.id);
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = ANY($1)',
        [ids],
      );
      const userMap = new Map(rows.map((r: any) => [r.id, r]));
      return recs.map((r) => userMap.get(r.id)).filter(Boolean).map(mapUser);
    },

    connections: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows: idRows } = await query<any>(
        `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
           FROM connections
          WHERE (requester_id = $1 OR addressee_id = $1)
            AND status = 'accepted'
          ORDER BY updated_at DESC`,
        [userId],
      );
      if (idRows.length === 0) return [];
      const ids = idRows.map((r: any) => r.id);
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = ANY($1)',
        [ids],
      );
      const userMap = new Map(rows.map((r: any) => [r.id, r]));
      return idRows.map((r: any) => userMap.get(r.id)).filter(Boolean).map(mapUser);
    },

    incomingRequests: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows: idRows } = await query<any>(
        `SELECT requester_id AS id
           FROM connections
          WHERE addressee_id = $1 AND status = 'pending'
          ORDER BY created_at DESC`,
        [userId],
      );
      if (idRows.length === 0) return [];
      const ids = idRows.map((r: any) => r.id);
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = ANY($1)',
        [ids],
      );
      const userMap = new Map(rows.map((r: any) => [r.id, r]));
      return idRows.map((r: any) => userMap.get(r.id)).filter(Boolean).map(mapUser);
    },

    outgoingRequests: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows: idRows } = await query<any>(
        `SELECT addressee_id AS id
           FROM connections
          WHERE requester_id = $1 AND status = 'pending'
          ORDER BY created_at DESC`,
        [userId],
      );
      if (idRows.length === 0) return [];
      const ids = idRows.map((r: any) => r.id);
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = ANY($1)',
        [ids],
      );
      const userMap = new Map(rows.map((r: any) => [r.id, r]));
      return idRows.map((r: any) => userMap.get(r.id)).filter(Boolean).map(mapUser);
    },

    chats: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query<any>(
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
        [userId],
      );
      return rows.map((r: any) => ({
        id: r.id,
        otherId: r.other_id,
        lastMessage: r.last_body
          ? { body: r.last_body, createdAt: r.last_created_at, senderId: r.last_sender_id }
          : null,
        unreadCount: Number(r.unread_count),
      }));
    },

    messages: async (
      _: any,
      { chatId, limit: rawLimit, before }: { chatId: string; limit?: number; before?: string },
      ctx: GqlContext,
    ) => {
      const userId = requireAuth(ctx);
      const chatRes = await query<any>(
        'SELECT user_a_id, user_b_id FROM chats WHERE id = $1',
        [chatId],
      );
      if (chatRes.rowCount === 0) throw new GraphQLError('Chat not found');
      const chat = chatRes.rows[0];
      if (chat.user_a_id !== userId && chat.user_b_id !== userId) {
        throw new GraphQLError('Chat not found');
      }
      const limit = Math.min(rawLimit ?? 30, 100);
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
        params,
      );
      return rows.map(mapMessage);
    },

    unreadCount: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query<any>(
        `SELECT COUNT(*)::text AS count
           FROM messages m
           JOIN chats c ON c.id = m.chat_id
          WHERE (c.user_a_id = $1 OR c.user_b_id = $1)
            AND m.sender_id <> $1
            AND m.read_at IS NULL`,
        [userId],
      );
      return Number(rows[0].count);
    },

    presence: async (_: any, { id }: { id: string }, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const { rows } = await query<any>(
        'SELECT last_seen_at FROM users WHERE id = $1',
        [id],
      );
      if (rows.length === 0) return null;
      const allowed = await canView(userId, id);
      if (!allowed) return null;
      return { online: isOnline(id), lastSeenAt: rows[0].last_seen_at };
    },
  },

  /* ============================================================== */
  /*  MUTATIONS                                                     */
  /* ============================================================== */
  Mutation: {
    register: async (
      _: any,
      { email, password, displayName }: { email: string; password: string; displayName: string },
    ) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new GraphQLError('Invalid email');
      }
      if (password.length < 8 || password.length > 100) {
        throw new GraphQLError('Password must be 8-100 characters');
      }
      if (displayName.length < 1 || displayName.length > 60) {
        throw new GraphQLError('Display name must be 1-60 characters');
      }
      const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount > 0) throw new GraphQLError('Email already in use');

      const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
      const { rows } = await query<any>(
        'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
        [email, hash, displayName],
      );
      const userId = rows[0].id;
      await query('INSERT INTO profiles (user_id) VALUES ($1)', [userId]);
      await query('INSERT INTO bios (user_id) VALUES ($1)', [userId]);
      return { token: signToken(userId), userId };
    },

    login: async (_: any, { email, password }: { email: string; password: string }) => {
      const { rows } = await query<any>(
        'SELECT id, password_hash FROM users WHERE email = $1',
        [email],
      );
      if (rows.length === 0) throw new GraphQLError('Invalid email or password');
      const ok = await bcrypt.compare(password, rows[0].password_hash);
      if (!ok) throw new GraphQLError('Invalid email or password');
      await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [rows[0].id]);
      return { token: signToken(rows[0].id), userId: rows[0].id };
    },

    logout: async (_: any, __: any, ctx: GqlContext) => {
      requireAuth(ctx);
      return true;
    },

    updateMe: async (_: any, { displayName }: { displayName: string }, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      await query('UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2', [
        displayName,
        userId,
      ]);
      return true;
    },

    updateProfile: async (
      _: any,
      args: { aboutMe?: string; age?: number; gender?: string; city?: string },
      ctx: GqlContext,
    ) => {
      const userId = requireAuth(ctx);
      await query(
        `UPDATE profiles
            SET about_me = COALESCE($1, about_me),
                age      = COALESCE($2, age),
                gender   = COALESCE($3, gender),
                city     = COALESCE($4, city),
                updated_at = NOW()
          WHERE user_id = $5`,
        [args.aboutMe ?? null, args.age ?? null, args.gender ?? null, args.city ?? null, userId],
      );
      await recomputeCompleteness(userId);
      return true;
    },

    updateBio: async (_: any, args: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      await query(
        `UPDATE bios
            SET workout_types    = COALESCE($1, workout_types),
                experience_level = COALESCE($2, experience_level),
                schedule_slots   = COALESCE($3, schedule_slots),
                goals            = COALESCE($4, goals),
                looking_for      = COALESCE($5, looking_for),
                gym_name         = COALESCE($6, gym_name),
                intensity        = COALESCE($7, intensity),
                updated_at = NOW()
          WHERE user_id = $8`,
        [
          args.workoutTypes ?? null,
          args.experienceLevel ?? null,
          args.scheduleSlots ?? null,
          args.goals ?? null,
          args.lookingFor ?? null,
          args.gymName ?? null,
          args.intensity ?? null,
          userId,
        ],
      );
      await recomputeCompleteness(userId);
      return true;
    },

    deleteAvatar: async (_: any, __: any, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const prev = await query<any>('SELECT avatar_url FROM users WHERE id = $1', [userId]);
      if (prev.rows[0]?.avatar_url?.startsWith('/uploads/')) {
        const prevPath = path.join(env.UPLOAD_DIR, path.basename(prev.rows[0].avatar_url));
        fs.promises.unlink(prevPath).catch(() => {});
      }
      await query('UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1', [userId]);
      return true;
    },

    requestConnection: async (
      _: any,
      { userId: targetId }: { userId: string },
      ctx: GqlContext,
    ) => {
      const userId = requireAuth(ctx);
      if (targetId === userId) throw new GraphQLError('Cannot connect with yourself');

      const t = await query('SELECT 1 FROM users WHERE id = $1', [targetId]);
      if (t.rowCount === 0) throw new GraphQLError('User not found');

      const existing = await query<any>(
        `SELECT id, requester_id, addressee_id, status FROM connections
          WHERE (requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1)`,
        [userId, targetId],
      );

      if (existing.rowCount > 0) {
        const row = existing.rows[0];
        if (row.status === 'accepted') throw new GraphQLError('Already connected');
        if (row.status === 'pending') {
          if (row.requester_id === targetId && row.addressee_id === userId) {
            await query(
              "UPDATE connections SET status = 'accepted', updated_at = NOW() WHERE id = $1",
              [row.id],
            );
            await ensureChat(userId, targetId);
            return { status: 'accepted' };
          }
          throw new GraphQLError('Request already pending');
        }
        if (row.status === 'declined') {
          await query(
            "UPDATE connections SET requester_id = $1, addressee_id = $2, status = 'pending', updated_at = NOW() WHERE id = $3",
            [userId, targetId, row.id],
          );
          return { status: 'pending' };
        }
      }

      await query(
        "INSERT INTO connections (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')",
        [userId, targetId],
      );
      return { status: 'pending' };
    },

    acceptConnection: async (
      _: any,
      { userId: otherId }: { userId: string },
      ctx: GqlContext,
    ) => {
      const userId = requireAuth(ctx);
      const result = await query(
        `UPDATE connections SET status = 'accepted', updated_at = NOW()
          WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
        [otherId, userId],
      );
      if (result.rowCount === 0) throw new GraphQLError('No pending request');
      await ensureChat(userId, otherId);
      return { status: 'accepted' };
    },

    declineConnection: async (
      _: any,
      { userId: otherId }: { userId: string },
      ctx: GqlContext,
    ) => {
      const userId = requireAuth(ctx);
      const result = await query(
        `UPDATE connections SET status = 'declined', updated_at = NOW()
          WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
        [otherId, userId],
      );
      if (result.rowCount === 0) throw new GraphQLError('No pending request');
      return { status: 'declined' };
    },

    disconnect: async (_: any, { userId: otherId }: { userId: string }, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const result = await query(
        `DELETE FROM connections
          WHERE ((requester_id = $1 AND addressee_id = $2)
              OR (requester_id = $2 AND addressee_id = $1))
            AND status = 'accepted'`,
        [userId, otherId],
      );
      if (result.rowCount === 0) throw new GraphQLError('Not connected');
      return true;
    },

    dismissRecommendation: async (
      _: any,
      { userId: targetId }: { userId: string },
      ctx: GqlContext,
    ) => {
      const userId = requireAuth(ctx);
      if (targetId === userId) throw new GraphQLError('Cannot dismiss yourself');
      await query(
        'INSERT INTO dismissals (user_id, dismissed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, targetId],
      );
      return true;
    },

    sendMessage: async (
      _: any,
      { chatId, body }: { chatId: string; body: string },
      ctx: GqlContext,
    ) => {
      const userId = requireAuth(ctx);
      if (!body || body.length === 0 || body.length > 2000) {
        throw new GraphQLError('Message must be 1-2000 characters');
      }
      const chatRes = await query<any>(
        'SELECT user_a_id, user_b_id FROM chats WHERE id = $1',
        [chatId],
      );
      if (chatRes.rowCount === 0) throw new GraphQLError('Chat not found');
      const chat = chatRes.rows[0];
      if (chat.user_a_id !== userId && chat.user_b_id !== userId) {
        throw new GraphQLError('Chat not found');
      }
      const otherId = chat.user_a_id === userId ? chat.user_b_id : chat.user_a_id;

      const conn = await query(
        `SELECT 1 FROM connections
          WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
            AND status = 'accepted'`,
        [userId, otherId],
      );
      if (conn.rowCount === 0) throw new GraphQLError('Must be connected to send messages');

      const { rows } = await query<any>(
        `INSERT INTO messages (chat_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, chat_id, sender_id, body, created_at, read_at`,
        [chatId, userId, body],
      );
      const msg = rows[0];

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit('message:new', msg);
        io.to(`user:${otherId}`).emit('message:new', msg);
      }
      return mapMessage(msg);
    },

    markRead: async (_: any, { chatId }: { chatId: string }, ctx: GqlContext) => {
      const userId = requireAuth(ctx);
      const chatRes = await query<any>(
        'SELECT user_a_id, user_b_id FROM chats WHERE id = $1',
        [chatId],
      );
      if (chatRes.rowCount === 0) throw new GraphQLError('Chat not found');
      const chat = chatRes.rows[0];
      if (chat.user_a_id !== userId && chat.user_b_id !== userId) {
        throw new GraphQLError('Chat not found');
      }
      const otherId = chat.user_a_id === userId ? chat.user_b_id : chat.user_a_id;

      const result = await query<any>(
        `UPDATE messages SET read_at = NOW()
          WHERE chat_id = $1 AND sender_id <> $2 AND read_at IS NULL
          RETURNING id`,
        [chatId, userId],
      );

      const io = getIO();
      if (io && result.rowCount > 0) {
        io.to(`user:${otherId}`).emit('message:read', {
          chatId,
          readerId: userId,
          messageIds: result.rows.map((r: any) => r.id),
        });
      }
      return true;
    },
  },

  /* ============================================================== */
  /*  TYPE RESOLVERS (nested fields)                                */
  /* ============================================================== */
  User: {
    profile: async (parent: any) => {
      const { rows } = await query(
        'SELECT user_id, about_me, age, gender, city, is_complete FROM profiles WHERE user_id = $1',
        [parent.id],
      );
      return rows.length > 0 ? mapProfile(rows[0]) : null;
    },
    bio: async (parent: any) => {
      const { rows } = await query(
        'SELECT user_id, workout_types, experience_level, schedule_slots, goals, looking_for, gym_name, intensity FROM bios WHERE user_id = $1',
        [parent.id],
      );
      return rows.length > 0 ? mapBio(rows[0]) : null;
    },
  },

  Profile: {
    user: async (parent: any) => {
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
        [parent.id],
      );
      return rows.length > 0 ? mapUser(rows[0]) : null;
    },
  },

  Bio: {
    user: async (parent: any) => {
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
        [parent.id],
      );
      return rows.length > 0 ? mapUser(rows[0]) : null;
    },
  },

  Chat: {
    other: async (parent: any) => {
      const { rows } = await query(
        'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
        [parent.otherId],
      );
      return rows.length > 0 ? mapUser(rows[0]) : null;
    },
  },
};
