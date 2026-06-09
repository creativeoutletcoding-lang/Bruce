-- Migration 033 — browser_sessions
-- Shared inline browser sessions. One active Browserbase session per chat;
-- Bruce drives it server-side via Stagehand, household members watch + interact
-- through a Browserbase Live View iframe. The current_url column is synced on
-- every action so all chat members' URL bars update via Supabase Realtime.

CREATE TABLE browser_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
  browserbase_session_id TEXT NOT NULL,
  live_view_url TEXT NOT NULL,
  current_url TEXT DEFAULT 'about:blank',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

ALTER TABLE browser_sessions ENABLE ROW LEVEL SECURITY;

-- Chat owner OR any chat_member can view
CREATE POLICY "browser_sessions_select"
ON browser_sessions FOR SELECT
USING (
  auth.uid() = created_by
  OR EXISTS (
    SELECT 1 FROM chats WHERE chats.id = browser_sessions.chat_id AND chats.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM chat_members WHERE chat_members.chat_id = browser_sessions.chat_id AND chat_members.user_id = auth.uid()
  )
);

CREATE POLICY "browser_sessions_insert"
ON browser_sessions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM chats WHERE chats.id = chat_id AND chats.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM chat_members WHERE chat_members.chat_id = chat_id AND chat_members.user_id = auth.uid()
  )
);

CREATE POLICY "browser_sessions_update"
ON browser_sessions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM chats WHERE chats.id = browser_sessions.chat_id AND chats.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM chat_members WHERE chat_members.chat_id = browser_sessions.chat_id AND chat_members.user_id = auth.uid()
  )
);

CREATE INDEX browser_sessions_chat_active_idx
ON browser_sessions(chat_id, is_active)
WHERE is_active = TRUE;

-- Realtime: the BrowserPanel subscribes to UPDATE on current_url so every
-- member's address bar stays in step when Bruce or a human navigates.
ALTER PUBLICATION supabase_realtime ADD TABLE browser_sessions;
