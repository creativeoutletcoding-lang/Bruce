-- ============================================================
-- Migration 025 — system_config
-- Key/value store for runtime-mutable configuration that cannot
-- live in env vars (e.g. OAuth tokens refreshed through the UI).
-- Writes are service-role only; admins can read via RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Admins can read all config values (never includes plaintext secrets
-- beyond tokens the admin already authorized). Service role (API routes)
-- bypasses RLS for writes.
CREATE POLICY "system_config_admin_read"
  ON system_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );
