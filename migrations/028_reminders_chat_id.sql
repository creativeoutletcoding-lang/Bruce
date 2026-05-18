-- Migration 028: Add chat_id to reminders for deep-link FCM notifications.
-- When a reminder is created from a chat, the cron job links back to that chat.
-- ON DELETE SET NULL so deleting a chat doesn't orphan the reminder.

ALTER TABLE reminders
  ADD COLUMN chat_id UUID REFERENCES chats(id) ON DELETE SET NULL;
