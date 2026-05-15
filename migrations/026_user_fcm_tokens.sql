-- Migration 026: Replace single fcm_token column with multi-device token table.
-- users.fcm_token is retained (not dropped) for a clean rollback path; notifyUser
-- now fans out from user_fcm_tokens and ignores the old column.

CREATE TABLE user_fcm_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         TEXT        NOT NULL,
  device_hint   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(token)
);

CREATE INDEX idx_user_fcm_tokens_user_id ON user_fcm_tokens(user_id);

ALTER TABLE user_fcm_tokens ENABLE ROW LEVEL SECURITY;
-- No user-facing policies — accessed exclusively via service role,
-- same pattern as user_presence.

-- Seed existing tokens from users.fcm_token so current devices don't lose
-- notifications until they re-register on next app open.
INSERT INTO user_fcm_tokens (user_id, token, device_hint)
SELECT id, fcm_token, 'migrated'
FROM users
WHERE fcm_token IS NOT NULL
ON CONFLICT (token) DO NOTHING;
