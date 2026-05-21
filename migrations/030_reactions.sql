-- Migration 030: Message reactions.
-- Members and Bruce can react to any message with a thumbs up.
-- chat_id is denormalized for efficient realtime filtering.
-- user_id = NULL means Bruce reacted (no users row for Bruce).

CREATE TABLE reactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chat_id     UUID        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL DEFAULT 'thumbs_up',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reactions_message_id ON reactions (message_id);
CREATE INDEX idx_reactions_chat_id    ON reactions (chat_id);

-- Bruce can only react once per message per type (user_id IS NULL)
CREATE UNIQUE INDEX reactions_bruce_unique
  ON reactions (message_id, type) WHERE user_id IS NULL;

-- A member can only react once per message per type
CREATE UNIQUE INDEX reactions_member_unique
  ON reactions (message_id, user_id, type) WHERE user_id IS NOT NULL;

ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

-- Members can read reactions for messages in chats they have access to
CREATE POLICY "reactions_select"
  ON reactions FOR SELECT
  TO authenticated
  USING (is_chat_member(chat_id));

-- Members can add their own reactions
CREATE POLICY "reactions_insert"
  ON reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Members can remove their own reactions
CREATE POLICY "reactions_delete"
  ON reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
