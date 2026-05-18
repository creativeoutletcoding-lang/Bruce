-- Migration 027: Personal reminders table.
-- Bruce can create, list, complete, and snooze reminders via the manage_reminders tool.
-- The cron job at /api/cron/reminders fires FCM for due reminders.

CREATE TABLE reminders (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  remind_at    TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  notified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reminders_user_pending
  ON reminders (user_id, remind_at)
  WHERE completed_at IS NULL;

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_reminders"
  ON reminders FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
