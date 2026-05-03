-- ============================================================
-- BRUCE HOUSEHOLD AI — SUPABASE SCHEMA
-- Phase 1 — Foundation
-- Run this in full in the Supabase SQL editor
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- HELPER: auto-update updated_at timestamps
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- TABLE: household
-- Single shared record for the whole family.
-- Household-level memories and member context.
-- ============================================================

CREATE TABLE household (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memories      JSONB NOT NULL DEFAULT '[]'::jsonb,
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- names, ages, relationships
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER household_updated_at
  BEFORE UPDATE ON household
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed one household record on schema init
INSERT INTO household (context) VALUES (
  '{
    "family_name": "Johnson",
    "members": [
      {"name": "Jake", "age": 36, "role": "admin"},
      {"name": "Laurianne", "age": 33, "role": "member"},
      {"name": "Jocelynn", "age": 16, "role": "member"},
      {"name": "Nana", "age": 69, "role": "member"}
    ],
    "household_context": [
      {"name": "Elliot", "age": 8, "relationship": "child"},
      {"name": "Henry", "age": 5, "relationship": "child"},
      {"name": "Violette", "age": 5, "relationship": "child"}
    ]
  }'::jsonb
);


-- ============================================================
-- TABLE: users
-- One row per household member. Linked to auth.users via id.
-- ============================================================

CREATE TABLE users (
  id                        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                     TEXT UNIQUE NOT NULL,
  name                      TEXT NOT NULL,
  avatar_url                TEXT,
  role                      TEXT NOT NULL DEFAULT 'member'
                              CHECK (role IN ('admin', 'member')),
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'deactivated')),
  morning_summary_time      TEXT NOT NULL DEFAULT '08:00',
  notification_sensitivity  TEXT NOT NULL DEFAULT 'medium'
                              CHECK (notification_sensitivity IN ('low', 'medium', 'high')),
  notification_preferences  JSONB NOT NULL DEFAULT '{}'::jsonb,
  fcm_token                 TEXT,           -- Firebase Cloud Messaging token
  google_access_token       TEXT,           -- Google OAuth access token (Drive, Calendar)
  google_refresh_token      TEXT,           -- Google OAuth refresh token (long-lived)
  google_token_expires_at   TIMESTAMPTZ,    -- When the access token expires
  google_drive_root_id      TEXT,           -- Drive folder: "Bruce" root
  google_drive_personal_id  TEXT,           -- Drive folder: "Personal" under root
  google_drive_projects_id  TEXT,           -- Drive folder: "Projects" under root
  color_hex                 TEXT NOT NULL DEFAULT '#6B7280',  -- bubble color (Google Calendar palette)
  deactivated_at            TIMESTAMPTZ,
  purge_at                  TIMESTAMPTZ,    -- 30 days after deactivation
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);


-- ============================================================
-- TABLE: invite_tokens
-- Single-use, 48-hour invite links. Created by admin.
-- ============================================================

CREATE TABLE invite_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT,                           -- optional pre-fill
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invite_tokens_token ON invite_tokens(token);


-- ============================================================
-- TABLE: projects
-- Any member can own a project. Owner is not auto-admin-included.
-- ============================================================

CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT '📁',
  instructions  TEXT NOT NULL DEFAULT '',    -- plain English, shapes Bruce's behavior
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_projects_owner ON projects(owner_id);


-- ============================================================
-- TABLE: project_members
-- Join table. Members explicitly invited by project owner.
-- ============================================================

CREATE TABLE project_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);


-- ============================================================
-- TABLE: chats
-- Covers private, group, family, and project chats.
-- project_id NULL = standalone chat.
-- ============================================================

CREATE TABLE chats (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,  -- NULL for standalone
  type            TEXT NOT NULL DEFAULT 'private'
                    CHECK (type IN ('private', 'group', 'family', 'family_group', 'family_thread', 'incognito')),
                    -- family_group: the one permanent household group chat
                    -- family_thread: named sub-topics, soft-deleted via deleted_at
  title           TEXT,                          -- auto-generated or user-set
  is_incognito    BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ,                   -- soft delete for family_thread rows
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER chats_updated_at
  BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_chats_owner ON chats(owner_id);
CREATE INDEX idx_chats_project ON chats(project_id);
CREATE INDEX idx_chats_last_message ON chats(last_message_at DESC);
CREATE INDEX idx_chats_type ON chats(type);


-- ============================================================
-- TABLE: chat_members
-- Who is in a group or family chat. Not used for private chats.
-- ============================================================

CREATE TABLE chat_members (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id   UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

CREATE INDEX idx_chat_members_chat ON chat_members(chat_id);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);


-- ============================================================
-- TABLE: messages
-- Every message in every chat. Incognito messages never hit this table.
-- ============================================================

CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id   UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL for Bruce
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- tool_use, citations, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_chat ON messages(chat_id);
CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at);
CREATE INDEX idx_messages_sender ON messages(sender_id);


-- ============================================================
-- TABLE: files
-- Google Drive files attached to projects.
-- ============================================================

CREATE TABLE files (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  google_drive_file_id  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  mime_type             TEXT,
  drive_url             TEXT,
  last_updated          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_project ON files(project_id);


-- ============================================================
-- TABLE: memory
-- Personal memory per member. Three tiers: core / active / archive.
-- ============================================================

CREATE TABLE memory (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,            -- clean concise statement
  tier            TEXT NOT NULL DEFAULT 'active'
                    CHECK (tier IN ('core', 'active', 'archive')),
  relevance_score FLOAT NOT NULL DEFAULT 1.0,
  category        TEXT,                     -- professional, preference, life, etc.
  last_accessed   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER memory_updated_at
  BEFORE UPDATE ON memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_memory_user ON memory(user_id);
CREATE INDEX idx_memory_user_tier ON memory(user_id, tier);
CREATE INDEX idx_memory_relevance ON memory(user_id, relevance_score DESC);


-- ============================================================
-- TABLE: notifications
-- All push notifications logged here.
-- ============================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,              -- mention, invite, task_complete, etc.
  content     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;


-- ============================================================
-- TABLE: pending_memory
-- Household memory suggestions from members. Bruce or admin approves.
-- ============================================================

CREATE TABLE pending_memory (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suggested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- ROW LEVEL SECURITY
-- Enabled on every table. No data returns without a matching
-- authenticated identity. This is architectural — not a setting.
-- ============================================================

ALTER TABLE household        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE files            ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_memory   ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- HELPER: is_admin()
-- Returns true if the authenticated user has role = 'admin'
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- HELPER: is_project_member(project_id)
-- Returns true if the authenticated user is in the project
-- ============================================================

CREATE OR REPLACE FUNCTION is_project_member(p_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- HELPER: is_chat_member(chat_id)
-- Returns true if the authenticated user owns or is a member of the chat
-- ============================================================

CREATE OR REPLACE FUNCTION is_chat_member(c_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM chats WHERE id = c_id AND owner_id = auth.uid()
    UNION
    SELECT 1 FROM chat_members WHERE chat_id = c_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- RLS POLICIES — household
-- All authenticated members can read. Only admin can write.
-- ============================================================

CREATE POLICY "household_read_authenticated"
  ON household FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "household_write_admin"
  ON household FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ============================================================
-- RLS POLICIES — users
-- Members read their own row. Admin reads all.
-- Members update their own row. Admin updates any.
-- ============================================================

CREATE POLICY "users_select_own"
  ON users FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "users_insert_self"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR is_admin())
  WITH CHECK (id = auth.uid() OR is_admin());

-- Admin-only delete (soft delete via status field preferred)
CREATE POLICY "users_delete_admin"
  ON users FOR DELETE
  TO authenticated
  USING (is_admin());


-- ============================================================
-- RLS POLICIES — invite_tokens
-- Admin only on all operations.
-- Public read by token for the claim flow (service role handles this).
-- ============================================================

CREATE POLICY "invite_tokens_admin_all"
  ON invite_tokens FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ============================================================
-- RLS POLICIES — projects
-- Members see only projects they belong to.
-- ============================================================

CREATE POLICY "projects_select_member"
  ON projects FOR SELECT
  TO authenticated
  USING (is_project_member(id) OR is_admin());

CREATE POLICY "projects_insert_authenticated"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "projects_update_owner"
  ON projects FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid() OR is_admin())
  WITH CHECK (owner_id = auth.uid() OR is_admin());

CREATE POLICY "projects_delete_owner"
  ON projects FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid() OR is_admin());


-- ============================================================
-- RLS POLICIES — project_members
-- Members can see the membership records for their projects.
-- Project owner can add/remove members.
-- ============================================================

CREATE POLICY "project_members_select"
  ON project_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_admin()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "project_members_insert_owner"
  ON project_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
    OR is_admin()
  );

CREATE POLICY "project_members_delete_owner"
  ON project_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
    OR is_admin()
  );


-- ============================================================
-- RLS POLICIES — chats
-- Private: only owner sees it.
-- Group/family: owner + members see it.
-- Project chats: project members see it.
-- ============================================================

CREATE POLICY "chats_select"
  ON chats FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR is_chat_member(id)
    OR (project_id IS NOT NULL AND is_project_member(project_id))
    OR is_admin()
  );

CREATE POLICY "chats_insert"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      project_id IS NULL
      OR is_project_member(project_id)
    )
  );

CREATE POLICY "chats_update_owner"
  ON chats FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid() OR is_admin());

CREATE POLICY "chats_delete_owner"
  ON chats FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid() OR is_admin());


-- ============================================================
-- RLS POLICIES — chat_members
-- Readable by anyone in the chat.
-- Writable by the chat owner.
-- ============================================================

CREATE POLICY "chat_members_select"
  ON chat_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_chat_member(chat_id)
    OR is_admin()
  );

CREATE POLICY "chat_members_insert_owner"
  ON chat_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id AND c.owner_id = auth.uid()
    )
    OR is_admin()
  );

CREATE POLICY "chat_members_delete_owner"
  ON chat_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id AND c.owner_id = auth.uid()
    )
    OR is_admin()
  );


-- ============================================================
-- RLS POLICIES — messages
-- Read: user must be in the chat (or project if project chat).
-- Write: sender_id must match auth.uid().
-- ============================================================

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
    OR is_admin()
  );

CREATE POLICY "messages_insert"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      is_chat_member(chat_id)
      OR EXISTS (
        SELECT 1 FROM chats c
        WHERE c.id = chat_id
          AND c.project_id IS NOT NULL
          AND is_project_member(c.project_id)
      )
    )
  );

-- Messages are never updated or deleted by users


-- ============================================================
-- RLS POLICIES — files
-- Project members see project files.
-- Project owner can add/remove files.
-- ============================================================

CREATE POLICY "files_select"
  ON files FOR SELECT
  TO authenticated
  USING (is_project_member(project_id) OR is_admin());

CREATE POLICY "files_insert"
  ON files FOR INSERT
  TO authenticated
  WITH CHECK (
    is_project_member(project_id) AND owner_id = auth.uid()
    OR is_admin()
  );

CREATE POLICY "files_delete_owner"
  ON files FOR DELETE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
    OR is_admin()
  );


-- ============================================================
-- RLS POLICIES — memory
-- STRICT. Only the owner sees their memory. No exceptions.
-- Admin sees nothing — privacy guarantee is architectural.
-- ============================================================

CREATE POLICY "memory_owner_only"
  ON memory FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- RLS POLICIES — notifications
-- Only the recipient sees their notifications.
-- ============================================================

CREATE POLICY "notifications_owner_only"
  ON notifications FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- RLS POLICIES — pending_memory
-- Members can submit suggestions and view their own.
-- Admin can see and action all.
-- ============================================================

CREATE POLICY "pending_memory_insert"
  ON pending_memory FOR INSERT
  TO authenticated
  WITH CHECK (suggested_by = auth.uid());

CREATE POLICY "pending_memory_select"
  ON pending_memory FOR SELECT
  TO authenticated
  USING (suggested_by = auth.uid() OR is_admin());

CREATE POLICY "pending_memory_update_admin"
  ON pending_memory FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ============================================================
-- SUPABASE REALTIME
-- Enable realtime on tables that need live updates in the UI.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE chats;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_members;


-- ============================================================
-- SERVICE ROLE NOTE
-- The invite claim flow and background memory jobs run as service
-- role and bypass RLS. This is intentional. Service role key
-- must never be exposed to the client — server-side only via
-- DigitalOcean and Vercel API routes.
-- ============================================================
