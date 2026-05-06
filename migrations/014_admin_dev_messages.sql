-- Admin dev workspace persistent session history.
-- Accessed exclusively via service role — no RLS needed.

CREATE TABLE IF NOT EXISTS admin_dev_messages (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
