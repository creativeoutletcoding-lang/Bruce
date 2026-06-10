-- Migration 035: scheduled_tasks — proactive standing tasks
--
-- A standing task runs as its owner on a recurrence schedule and posts the
-- result into a chat the owner belongs to. The cron dispatcher
-- (/api/cron/scheduled-tasks, every 5 min) claims due rows by advancing
-- next_run_at conditioned on the read value (no double-fire across
-- overlapping invocations).
--
-- schedule jsonb: {type: "daily"|"weekly"|"monthly", time: "HH:MM",
-- weekday?: 0-6 (weekly), day?: 1-31 (monthly)} — wall-clock in `timezone`.
-- next_run_at is precomputed UTC so dispatch is one indexed query.

CREATE TABLE scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  schedule JSONB NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  next_run_at TIMESTAMPTZ NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;

-- Users manage their own tasks; the cron dispatcher uses the service role.
CREATE POLICY "scheduled_tasks_own"
ON scheduled_tasks FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX scheduled_tasks_due_idx
ON scheduled_tasks(next_run_at)
WHERE enabled = TRUE;
