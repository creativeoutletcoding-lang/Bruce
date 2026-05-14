-- ============================================================
-- Migration 024 — chat_members.last_read_at
-- Per-member read marker for sidebar unread indicators.
-- ============================================================

ALTER TABLE chat_members
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_members_last_read
  ON chat_members(chat_id, user_id, last_read_at);

-- A member can update their own last_read_at (without granting write to other
-- columns). RLS already allows reads via chat_members_select.
DROP POLICY IF EXISTS "chat_members_update_self_last_read" ON chat_members;
CREATE POLICY "chat_members_update_self_last_read"
  ON chat_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
