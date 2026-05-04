-- Migration 010: notifications — add chat_id and read_at
-- Applied after 009_user_presence.sql
--
-- chat_id: links a notification to the specific chat it was generated from.
--   Used to compute per-chat unread counts for sidebar indicators and to mark
--   a single chat's notifications as read when the user opens that chat.
--
-- read_at: timestamp when the notification was marked read. Kept alongside the
--   existing boolean `read` column for backward compatibility — queries still
--   use `read = FALSE`; mark-read sets both fields simultaneously.
--
-- Index covers the common query: user's unread notifications for a given chat.

ALTER TABLE notifications
  ADD COLUMN chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
  ADD COLUMN read_at TIMESTAMPTZ;

CREATE INDEX idx_notifications_chat_unread
  ON notifications(user_id, chat_id) WHERE read = FALSE;
