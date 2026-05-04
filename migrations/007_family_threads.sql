-- ============================================================
-- MIGRATION 007: Family Threads
-- Applied after 006_family_group.sql
-- Run in Supabase SQL editor after 006
-- ============================================================

-- 1. Expand the chats.type CHECK constraint to include 'family_thread'
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE chats ADD CONSTRAINT chats_type_check
  CHECK (type IN ('private', 'group', 'family', 'family_group', 'family_thread', 'incognito'));

-- 2. Soft-delete support for threads (nullable — null means active)
ALTER TABLE chats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chats_deleted ON chats(deleted_at) WHERE deleted_at IS NOT NULL;

-- 3. RLS: any authenticated user can read active family threads
--    (No chat_members row required — type-based access for the whole family)
CREATE POLICY "family_thread_chat_select"
  ON chats FOR SELECT
  TO authenticated
  USING (type = 'family_thread' AND deleted_at IS NULL);

-- 4. RLS: any authenticated user can read messages in active family threads
CREATE POLICY "family_thread_messages_select"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id
        AND c.type = 'family_thread'
        AND c.deleted_at IS NULL
    )
  );

-- 5. RLS: any authenticated user can write messages to active family threads
CREATE POLICY "family_thread_messages_insert"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id
        AND c.type = 'family_thread'
        AND c.deleted_at IS NULL
    )
  );
