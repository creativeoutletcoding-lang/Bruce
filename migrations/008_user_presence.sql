-- Migration 008: user_presence
-- Tracks which chat a user has open so push notifications can be suppressed
-- when the recipient already has that conversation visible.
--
-- One row per (user_id, chat_id). Upserted on a 30-second heartbeat from the
-- client while a chat window is mounted. Checked server-side before sending FCM.
-- No RLS — accessed exclusively via service role from API routes.

CREATE TABLE user_presence (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id    UUID        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, chat_id)
);
