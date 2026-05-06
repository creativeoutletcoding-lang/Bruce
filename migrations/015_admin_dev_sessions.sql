-- Admin dev workspace: named sessions with persistent history per session.
-- Accessed exclusively via service role — no RLS needed.

-- 1. Create sessions table first (messages will reference it)
CREATE TABLE IF NOT EXISTS admin_dev_sessions (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT        NOT NULL DEFAULT 'Untitled session',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Add session_id column to existing messages table (nullable to allow migration)
ALTER TABLE admin_dev_messages
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES admin_dev_sessions(id) ON DELETE CASCADE;

-- 3. Migrate all existing messages into "Session 1" using a CTE
WITH new_session AS (
  INSERT INTO admin_dev_sessions (name, created_at, updated_at)
  VALUES ('Session 1', NOW(), NOW())
  RETURNING id
)
UPDATE admin_dev_messages
SET session_id = (SELECT id FROM new_session);
