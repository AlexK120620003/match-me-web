# Match-Me Web — Gym & Workout Buddies 🏋️

Full-stack recommendation app that matches people looking for gym/workout partners based on their training profile (workout types, experience level, schedule, goals, what they're looking for, gym and city).

## Stack

- **Backend:** Node.js + TypeScript + Express, `pg` (raw SQL), bcrypt, JWT, Socket.io, multer, zod
- **Frontend:** React + TypeScript + Vite, react-router, socket.io-client
- **Database:** PostgreSQL 16
- **Real-time:** Socket.io (no polling)

## Project layout

```
.
├── backend/         # Express API + Socket.io
│   ├── src/
│   │   ├── config/          # env loading
│   │   ├── controllers/     # HTTP handlers
│   │   ├── db/              # schema.sql, pool, migrate/drop/seed scripts
│   │   ├── middleware/      # auth, error, upload
│   │   ├── routes/          # routes/index.ts
│   │   ├── services/        # recommendations, visibility
│   │   ├── sockets/         # socket.io server
│   │   └── server.ts        # entry point
│   └── uploads/             # user avatars (served as /uploads)
├── frontend/        # Vite + React + TS
│   └── src/
│       ├── api/             # fetch client + types
│       ├── components/      # NavBar, Avatar
│       ├── contexts/        # AuthContext, SocketContext
│       ├── pages/           # Login/Register/Profile/Recs/Connections/Chats/Chat/UserView
│       └── App.tsx
└── docker-compose.yml       # PostgreSQL
```

## Quick start

### 1. Prerequisites
- Node.js 20+
- Docker (for PostgreSQL) **or** a local PostgreSQL 16 instance

### 2. Start the database

```bash
docker compose up -d
```

This exposes PostgreSQL on `localhost:5432` with credentials:
- user: `matchme`
- password: `matchme_dev_password`
- database: `matchme`

If you use a local Postgres, adjust `backend/.env` → `DATABASE_URL`.

### 3. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 4. Set up environment

```bash
cd backend
cp .env.example .env
# Edit .env if needed; defaults work with the docker-compose Postgres.
```

### 5. Migrate + seed the database

From `backend/`:

```bash
npm run db:migrate   # create tables
npm run db:seed      # create 120 fictional users + a demo account
```

To wipe and reload (reviewer workflow):

```bash
npm run db:reset     # drop + migrate + seed
```

Or as separate steps:

```bash
npm run db:drop
npm run db:migrate
npm run db:seed
```

### 6. Run the servers

Two terminals:

```bash
# Terminal 1
cd backend && npm run dev    # http://localhost:4000

# Terminal 2
cd frontend && npm run dev   # http://localhost:5173
```

The Vite dev server proxies `/api`, `/uploads`, and `/socket.io` to the backend.

### 7. Log in

- Demo user: `demo@matchme.test` / `password123`
- All seeded users share the password `password123` (emails look like `user42+abcd@matchme.test`)

## REST API surface

Authenticated endpoints require `Authorization: Bearer <jwt>`.

| Method | Path                               | Purpose |
|--------|------------------------------------|---------|
| POST   | `/api/auth/register`               | Create account, returns JWT |
| POST   | `/api/auth/login`                  | Log in, returns JWT |
| POST   | `/api/auth/logout`                 | No-op (client discards token) |
| GET    | `/api/me`                          | `{ id, displayName, avatarUrl }` for current user |
| GET    | `/api/me/profile`                  | Current user's profile |
| GET    | `/api/me/bio`                      | Current user's bio |
| GET    | `/api/me/email`                    | Private: own email |
| PUT    | `/api/me`                          | Update display name |
| PUT    | `/api/me/profile`                  | Update profile (about me, age, gender, city) |
| PUT    | `/api/me/bio`                      | Update bio (workout types, level, schedule, goals, ...) |
| POST   | `/api/me/avatar`                   | Upload avatar (multipart: `avatar`) |
| DELETE | `/api/me/avatar`                   | Remove avatar |
| GET    | `/api/users/:id`                   | `{ id, displayName, avatarUrl }` (404 if not visible) |
| GET    | `/api/users/:id/profile`           | About me, age, gender, city |
| GET    | `/api/users/:id/bio`               | Bio (recommendation data) |
| GET    | `/api/users/:id/presence`          | `{ online, lastSeenAt }` |
| GET    | `/api/recommendations`             | Up to 10 `{ id }` |
| POST   | `/api/recommendations/:id/dismiss` | Never recommend again |
| GET    | `/api/connections`                 | Accepted connections `{ id }` |
| GET    | `/api/connections/requests`        | Incoming pending requests |
| GET    | `/api/connections/outgoing`        | Outgoing pending requests |
| POST   | `/api/connections/request/:id`     | Request a connection |
| POST   | `/api/connections/:id/accept`      | Accept |
| POST   | `/api/connections/:id/decline`     | Decline |
| DELETE | `/api/connections/:id`             | Disconnect |
| GET    | `/api/chats`                       | My chats, most recent first, with unread counts |
| GET    | `/api/chats/unread-count`          | Total unread count |
| GET    | `/api/chats/:chatId/messages`      | Paginated messages (`?limit=30&before=ISO`) |
| POST   | `/api/chats/:chatId/messages`      | Send a message |
| POST   | `/api/chats/:chatId/read`          | Mark all messages as read |

**Never exposed via any endpoint:** passwords (even hashed), other users' emails.

### Socket.io events

Auth: pass JWT as `socket.handshake.auth.token`.

- `client → server`: `typing:start { chatId }`, `typing:stop { chatId }`
- `server → client`:
  - `message:new <Message>`
  - `message:read { chatId, readerId, messageIds }`
  - `typing:start { chatId, fromId }`, `typing:stop { chatId, fromId }`
  - `presence:update { userId, online }`

## Recommendation algorithm

Scoring out of 100, ranked desc, cut off at < 30 (weak match), max 10 returned:

| Feature | Max pts | Rule |
|---|---|---|
| Workout type overlap | 25 | Jaccard × 25 |
| Schedule overlap | 20 | Jaccard × 20 |
| Experience level compatibility | 15 | Same = 15, ±1 = 8, else = 0 |
| Goals overlap | 15 | Jaccard × 15 |
| Looking-for complementarity | 10 | Same request, or role pair (trainer↔trainee) |
| Same city | 10 | Hard filter — different city excluded |
| Same gym | 5 | Case-insensitive name match |

Hard filters: self, incomplete profile, dismissed, already connected, already declined, different city.

## Profile visibility

A user profile is visible only if one of:
- It's your own
- You are connected (accepted)
- An outstanding connection request exists (either direction)
- They are currently in your recommendations list

Otherwise the endpoint returns **HTTP 404** (per spec — no `403`).

## Extras implemented

- **Online/offline indicator** — via socket presence tracking, updates in real time (`presence:update`).
- **Typing indicator** — sent on keystroke, auto-stop after 2s idle.
- **Profile completion gate** — you can't see recommendations until ≥5 bio data points are filled.
- **Weak-match filter** — 30/100 threshold prevents boring lists.
- **Seeded data** with realistic distribution of levels, matching gyms per city, and pre-made connections + pending requests.

## Demonstrating matching at scale

After `npm run db:seed` you have 120 users across 6 cities with realistic training profiles. Log in as `demo@matchme.test` (password `password123`) — the demo user is set up to produce strong matches in Tallinn with strength/powerlifting/crossfit focus.

To reset with fresh seed data:
```bash
cd backend && npm run db:reset
```

## Security notes

- Passwords hashed with bcrypt (10 rounds by default).
- JWT signed with `JWT_SECRET`. Rotate in production.
- Emails are never returned through public endpoints — only via `/me/email`.
- All mutating endpoints verify ownership.
- Profile visibility returns **404** for unauthorized access so an attacker cannot enumerate user ids.
- Uploads restricted to images, 5 MB default max.

## License

School project — no license chosen.
