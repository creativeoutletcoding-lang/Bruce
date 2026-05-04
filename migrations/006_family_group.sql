-- ============================================================
-- MIGRATION 006: Family Group Chat
-- Applied after 005_color_hex.sql
-- Run in Supabase SQL editor
-- ============================================================

-- 1. Expand the chats.type CHECK constraint to include 'family_group'
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE chats ADD CONSTRAINT chats_type_check
  CHECK (type IN ('private', 'group', 'family', 'family_group', 'incognito'));

-- 2. All authenticated users can read the permanent family group chat.
--    Message-level access still requires chat_members membership (populated at creation + on each new user join).
CREATE POLICY "family_group_chat_select"
  ON chats FOR SELECT
  TO authenticated
  USING (type = 'family_group');

-- 3. Enable realtime on chat_members so the family chat can react to membership changes
-- (Already enabled on chats, messages — adding chat_members for completeness)
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_members;
-- (uncomment only if not already in the publication)
