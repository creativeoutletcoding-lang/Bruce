-- ============================================================
-- MIGRATION 007: Family Thread Membership (chat_members-based RLS)
-- Run in Supabase SQL editor after 006
-- Replaces the type-based thread policies from 006 with
-- membership-gated policies so users only see threads they're in.
-- ============================================================

-- 1. Drop the type-based policies added in migration 006
DROP POLICY IF EXISTS "family_thread_chat_select" ON chats;
DROP POLICY IF EXISTS "family_thread_messages_select" ON messages;
DROP POLICY IF EXISTS "family_thread_messages_insert" ON messages;

-- 2. New SELECT on chats: must be in chat_members for that thread
CREATE POLICY "family_thread_chat_select"
  ON chats FOR SELECT
  TO authenticated
  USING (
    type = 'family_thread'
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = id
        AND cm.user_id = auth.uid()
    )
  );

-- 3. New SELECT on messages: must be a thread member
CREATE POLICY "family_thread_messages_select"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE c.id = chat_id
        AND c.type = 'family_thread'
        AND c.deleted_at IS NULL
        AND cm.user_id = auth.uid()
    )
  );

-- 4. New INSERT on messages: must be a thread member
CREATE POLICY "family_thread_messages_insert"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE c.id = chat_id
        AND c.type = 'family_thread'
        AND c.deleted_at IS NULL
        AND cm.user_id = auth.uid()
    )
  );

-- 5. Allow any thread member to read the chat_members rows for their threads
--    (needed so the sidebar and topbar can enumerate members)
CREATE POLICY "family_thread_members_select"
  ON chat_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id
        AND c.type = 'family_thread'
        AND c.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM chat_members cm2
          WHERE cm2.chat_id = c.id AND cm2.user_id = auth.uid()
        )
    )
  );
