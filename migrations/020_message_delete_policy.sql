-- Migration 020: Allow users to delete their own messages
-- Applies to standalone chats and project chats; assistant messages (sender_id = null) are never deletable.

CREATE POLICY "messages_delete"
  ON messages FOR DELETE
  USING (
    sender_id = auth.uid()
  );
