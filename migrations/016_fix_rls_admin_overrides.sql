-- ============================================================
-- MIGRATION 016 — Fix RLS admin overrides that violate privacy spec
-- Date: 2026-05-06
--
-- Privacy rule (non-negotiable): no member — including admin — can
-- access content from another member's private space.
--
-- Legitimate admin access (kept untouched):
--   household, users, invite_tokens, pending_memory
--
-- Violations being fixed (is_admin() removed):
--   projects, project_members, chats, chat_members, messages, files
-- ============================================================


-- ------------------------------------------------------------
-- TABLE: projects
-- Admin override on SELECT, UPDATE, DELETE is a privacy violation.
-- Only project members (via project_members join) may access a project.
-- The project owner manages their own project; no admin bypass.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "projects_select_member" ON projects;
CREATE POLICY "projects_select_member"
  ON projects FOR SELECT
  TO authenticated
  USING (is_project_member(id));

DROP POLICY IF EXISTS "projects_update_owner" ON projects;
CREATE POLICY "projects_update_owner"
  ON projects FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "projects_delete_owner" ON projects;
CREATE POLICY "projects_delete_owner"
  ON projects FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());


-- ------------------------------------------------------------
-- TABLE: project_members
-- Admin should not be able to enumerate membership of projects
-- they don't belong to, nor add/remove members from those projects.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select"
  ON project_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_members_insert_owner" ON project_members;
CREATE POLICY "project_members_insert_owner"
  ON project_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_members_delete_owner" ON project_members;
CREATE POLICY "project_members_delete_owner"
  ON project_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );


-- ------------------------------------------------------------
-- TABLE: chats
-- Admin should not be able to read, update, or delete another
-- member's private chats or project chats they don't belong to.
-- Family group chat remains visible to all authenticated members
-- via the separate family_group_chat_select policy.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "chats_select" ON chats;
CREATE POLICY "chats_select"
  ON chats FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR is_chat_member(id)
    OR (project_id IS NOT NULL AND is_project_member(project_id))
  );

DROP POLICY IF EXISTS "chats_update_owner" ON chats;
CREATE POLICY "chats_update_owner"
  ON chats FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "chats_delete_owner" ON chats;
CREATE POLICY "chats_delete_owner"
  ON chats FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());


-- ------------------------------------------------------------
-- TABLE: chat_members
-- Admin should not be able to enumerate who is in a chat they
-- don't participate in, nor add/remove members from it.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "chat_members_select" ON chat_members;
CREATE POLICY "chat_members_select"
  ON chat_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_chat_member(chat_id)
  );

DROP POLICY IF EXISTS "chat_members_insert_owner" ON chat_members;
CREATE POLICY "chat_members_insert_owner"
  ON chat_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_members_delete_owner" ON chat_members;
CREATE POLICY "chat_members_delete_owner"
  ON chat_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id AND c.owner_id = auth.uid()
    )
  );


-- ------------------------------------------------------------
-- TABLE: messages
-- Admin should not be able to read messages from chats/projects
-- they don't belong to. The family_thread_messages_select policy
-- (added in migration 008) remains untouched.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select"
  ON messages FOR SELECT
  TO authenticated
  USING (
    is_chat_member(chat_id)
    OR EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id
        AND c.project_id IS NOT NULL
        AND is_project_member(c.project_id)
    )
  );


-- ------------------------------------------------------------
-- TABLE: files
-- Admin should not be able to read, attach, or remove files from
-- projects they are not members of.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "files_select" ON files;
CREATE POLICY "files_select"
  ON files FOR SELECT
  TO authenticated
  USING (is_project_member(project_id));

DROP POLICY IF EXISTS "files_insert" ON files;
CREATE POLICY "files_insert"
  ON files FOR INSERT
  TO authenticated
  WITH CHECK (
    is_project_member(project_id) AND owner_id = auth.uid()
  );

DROP POLICY IF EXISTS "files_delete_owner" ON files;
CREATE POLICY "files_delete_owner"
  ON files FOR DELETE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );
