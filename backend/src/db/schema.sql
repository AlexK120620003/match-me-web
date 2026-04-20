-- Match-Me Web :: Gym/Workout Buddies
-- PostgreSQL schema

-- ========================================================
-- USERS: auth + basic identity
-- ========================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================================
-- PROFILES: "about me" free-form content + completion flag
-- ========================================================
CREATE TABLE IF NOT EXISTS profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  about_me     TEXT,
  age          INTEGER CHECK (age BETWEEN 14 AND 120),
  gender       TEXT,                     -- 'male' | 'female' | 'other'
  city         TEXT,                     -- location (city-based matching)
  is_complete  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================================
-- BIOS: structured gym-specific data (drives matching)
-- 5+ biographical data points:
--   1. workout_types   (strength/cardio/yoga/crossfit/...)
--   2. experience_level (beginner/intermediate/advanced)
--   3. schedule_slots  (morning/afternoon/evening × weekdays/weekend)
--   4. goals           (lose_weight/build_muscle/endurance/...)
--   5. looking_for     (spotter/motivator/same_level/trainer...)
--   6. gym_name        (string — same gym = bonus)
--   7. intensity       (chill/moderate/intense)
-- ========================================================
CREATE TABLE IF NOT EXISTS bios (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  workout_types     TEXT[] NOT NULL DEFAULT '{}',     -- multi
  experience_level  TEXT,                              -- one of: beginner/intermediate/advanced
  schedule_slots    TEXT[] NOT NULL DEFAULT '{}',     -- e.g. 'mon_morning','sat_evening'
  goals             TEXT[] NOT NULL DEFAULT '{}',     -- multi
  looking_for       TEXT[] NOT NULL DEFAULT '{}',     -- multi
  gym_name          TEXT,
  intensity         TEXT,                              -- chill/moderate/intense
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================================
-- CONNECTIONS: requests, accepted, declined, removed
-- Directed: requester_id -> addressee_id until accepted, then both see each other.
-- status: 'pending' | 'accepted' | 'declined'
-- Soft-delete via 'declined' + removing row on disconnect.
-- ========================================================
CREATE TABLE IF NOT EXISTS connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending','accepted','declined')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connection_no_self CHECK (requester_id <> addressee_id),
  CONSTRAINT connection_unique_pair UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections(requester_id);
CREATE INDEX IF NOT EXISTS idx_connections_addressee ON connections(addressee_id);
CREATE INDEX IF NOT EXISTS idx_connections_status    ON connections(status);

-- ========================================================
-- DISMISSALS: user X dismissed user Y from recommendations
-- Persists forever so we never recommend again.
-- ========================================================
CREATE TABLE IF NOT EXISTS dismissals (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, dismissed_id)
);

-- ========================================================
-- CHATS: 1:1 chat between two connected users (a,b ordered)
-- We normalize a<b to enforce uniqueness.
-- ========================================================
CREATE TABLE IF NOT EXISTS chats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_ordered_pair CHECK (user_a_id < user_b_id),
  CONSTRAINT chat_unique_pair UNIQUE (user_a_id, user_b_id)
);

-- ========================================================
-- MESSAGES: text messages in a chat
-- ========================================================
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id      UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (length(body) > 0 AND length(body) <= 2000),
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(chat_id, read_at) WHERE read_at IS NULL;
