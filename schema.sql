-- ============================================================
-- BRUCE HOUSEHOLD AI — SUPABASE SCHEMA
-- Synced through migration 025 (2026-05-15)
-- This file reflects the full current database state.
-- Run this in full in the Supabase SQL editor for a fresh install.
-- For incremental changes, run the numbered files in migrations/.
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
  home_location             TEXT NOT NULL DEFAULT 'Arlington, Virginia',
  preferred_model           TEXT DEFAULT 'claude-sonnet-4-6',
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
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  icon            TEXT NOT NULL DEFAULT '📁',
  instructions    TEXT NOT NULL DEFAULT '',    -- plain English, shapes Bruce's behavior
  isolate_memory  BOOLEAN NOT NULL DEFAULT FALSE, -- when true, memories stay inside this project
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id      UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,                                 -- per-member read marker (migration 024)
  UNIQUE(chat_id, user_id)
);

CREATE INDEX idx_chat_members_chat ON chat_members(chat_id);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);
CREATE INDEX idx_chat_members_last_read ON chat_members(chat_id, user_id, last_read_at);


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
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- tool_use, citations, etc.
  image_url           TEXT,                                 -- user-uploaded image or document URL
  attachment_type     TEXT,                                 -- 'image' or 'document'
  attachment_filename TEXT,                                 -- original filename for documents
  file_ids            JSONB,                                -- Anthropic Files API IDs, parallel to metadata.attachments
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
-- Two types: private (one member + Bruce) and shared (multiple members).
-- Private: owner_id set, member_combination null, project_id null.
-- Shared (global): owner_id null, member_combination = sorted UUIDs joined ':', project_id null.
-- Shared (project-isolated): owner_id null, member_combination set, project_id set.
-- ============================================================

CREATE TABLE memory (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type               TEXT NOT NULL DEFAULT 'private'
                       CHECK (type IN ('private', 'shared')),
  owner_id           UUID REFERENCES users(id) ON DELETE CASCADE,  -- private only
  member_combination TEXT,                  -- shared only: sorted UUIDs joined ':'
  project_id         UUID REFERENCES projects(id) ON DELETE CASCADE, -- project-isolated only
  content            TEXT NOT NULL,
  tier               TEXT NOT NULL DEFAULT 'active'
                       CHECK (tier IN ('core', 'active', 'archive')),
  relevance_score    FLOAT NOT NULL DEFAULT 1.0,
  category           TEXT,
  last_accessed      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER memory_updated_at
  BEFORE UPDATE ON memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_memory_owner           ON memory(owner_id)              WHERE owner_id IS NOT NULL;
CREATE INDEX idx_memory_owner_tier      ON memory(owner_id, tier)        WHERE owner_id IS NOT NULL;
CREATE INDEX idx_memory_owner_relevance ON memory(owner_id, relevance_score DESC) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_memory_member_combo    ON memory(member_combination)    WHERE member_combination IS NOT NULL;
CREATE INDEX idx_memory_project         ON memory(project_id)            WHERE project_id IS NOT NULL;


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
  chat_id     UUID REFERENCES chats(id) ON DELETE SET NULL,  -- chat that generated this notification
  read_at     TIMESTAMPTZ,                                    -- when marked read (alongside boolean read)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX idx_notifications_chat_unread ON notifications(user_id, chat_id) WHERE read = FALSE;


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
-- TABLE: user_presence
-- Tracks which chat each user has open for push notification suppression.
-- One row per (user_id, chat_id). Upserted on a heartbeat while a chat window
-- is mounted. Accessed exclusively via service role — no RLS needed.
-- ============================================================

CREATE TABLE user_presence (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id    UUID        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, chat_id)
);


-- ============================================================
-- TABLE: user_fcm_tokens
-- One row per device per user. Token uniqueness is enforced globally
-- so a token that moves to a different account is re-attributed on
-- the next registration. Stale tokens (FCM 404) are deleted by
-- notifyUser after a failed send attempt.
-- ============================================================

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
-- No user-facing policies — accessed exclusively via service role.


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
ALTER TABLE user_presence    ENABLE ROW LEVEL SECURITY;  -- service role only; no user-facing policies


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

-- Public anon policy — required for /join page to validate tokens without a session.
-- Only exposes unused, non-expired tokens. No sensitive data leakage.
CREATE POLICY "invite_tokens_public_validate"
  ON invite_tokens FOR SELECT
  TO anon
  USING (used = false AND expires_at > NOW());


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

-- Family group: the one permanent household chat is visible to all authenticated members.
CREATE POLICY "family_group_chat_select"
  ON chats FOR SELECT
  TO authenticated
  USING (type = 'family_group');

-- Family threads: membership-gated via chat_members.
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

-- A member can update their own last_read_at (migration 024).
CREATE POLICY "chat_members_update_self_last_read"
  ON chat_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Thread member enumeration: allows any thread member to see who else is in their threads
-- (needed for sidebar member avatars and topbar). The self-referential EXISTS is intentional —
-- Postgres resolves it via the SECURITY DEFINER is_chat_member path in chat_members_select.
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

CREATE POLICY "messages_delete"
  ON messages FOR DELETE
  USING (
    sender_id = auth.uid()
  );

-- Messages are never updated by users

-- Family thread message access: membership-gated (replaces type-only policies from mig 007).
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
-- Private: only the owner. Shared: members whose UUID is in member_combination.
-- Admin sees nothing — privacy guarantee is architectural.
-- Writes go through service role (background generation); these gate reads.
-- ============================================================

CREATE POLICY "memory_select"
  ON memory FOR SELECT TO authenticated
  USING (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );

CREATE POLICY "memory_insert"
  ON memory FOR INSERT TO authenticated
  WITH CHECK (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );

CREATE POLICY "memory_update"
  ON memory FOR UPDATE TO authenticated
  USING (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  )
  WITH CHECK (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );

CREATE POLICY "memory_delete"
  ON memory FOR DELETE TO authenticated
  USING (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );


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
-- SYSTEM CONFIG
-- Runtime-mutable key/value store for config that cannot live in
-- env vars (e.g. OAuth tokens refreshed through the admin UI).
-- Writes are service-role only; admins can read via RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_config_admin_read"
  ON system_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );


-- ============================================================
-- REMINDERS
-- Personal reminders managed via the manage_reminders tool.
-- notified_at is set by the cron job after FCM fires.
-- Snooze resets notified_at and updates remind_at.
-- ============================================================

CREATE TABLE reminders (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  remind_at    TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  notified_at  TIMESTAMPTZ,
  chat_id      UUID REFERENCES chats(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reminders_user_pending
  ON reminders (user_id, remind_at)
  WHERE completed_at IS NULL;

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_reminders"
  ON reminders FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- REACTIONS
-- Thumbs-up reactions on messages by members and Bruce.
-- user_id = NULL means Bruce reacted.
-- chat_id is denormalized for efficient realtime channel filtering.
-- ============================================================

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

CREATE UNIQUE INDEX reactions_bruce_unique
  ON reactions (message_id, type) WHERE user_id IS NULL;

CREATE UNIQUE INDEX reactions_member_unique
  ON reactions (message_id, user_id, type) WHERE user_id IS NOT NULL;

ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select"
  ON reactions FOR SELECT
  TO authenticated
  USING (is_chat_member(chat_id));

CREATE POLICY "reactions_insert"
  ON reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "reactions_delete"
  ON reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- TABLE: member_exclusions (migration 031)
-- Mutual exclusion pairs — two members who must never share a chat
-- or project. DB-level triggers on chat_members and project_members
-- enforce this at insert time. Admin-only RLS.
-- ============================================================

CREATE TABLE member_exclusions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_a   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_b   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_exclusion CHECK (user_id_a <> user_id_b)
);

CREATE UNIQUE INDEX unique_exclusion_pair ON member_exclusions (
  LEAST(user_id_a::text, user_id_b::text),
  GREATEST(user_id_a::text, user_id_b::text)
);

ALTER TABLE member_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_only" ON member_exclusions
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE OR REPLACE FUNCTION check_chat_member_exclusion()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM chat_members cm
    JOIN member_exclusions me
      ON (
        (me.user_id_a = NEW.user_id AND me.user_id_b = cm.user_id)
        OR
        (me.user_id_b = NEW.user_id AND me.user_id_a = cm.user_id)
      )
    WHERE cm.chat_id = NEW.chat_id
  ) THEN
    RAISE EXCEPTION 'member_exclusion_violation: this member cannot be added to a chat containing an excluded member';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_chat_member_exclusion
  BEFORE INSERT ON chat_members
  FOR EACH ROW EXECUTE FUNCTION check_chat_member_exclusion();

CREATE OR REPLACE FUNCTION check_project_member_exclusion()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM project_members pm
    JOIN member_exclusions me
      ON (
        (me.user_id_a = NEW.user_id AND me.user_id_b = pm.user_id)
        OR
        (me.user_id_b = NEW.user_id AND me.user_id_a = pm.user_id)
      )
    WHERE pm.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'member_exclusion_violation: this member cannot be added to a project containing an excluded member';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_project_member_exclusion
  BEFORE INSERT ON project_members
  FOR EACH ROW EXECUTE FUNCTION check_project_member_exclusion();


-- ============================================================
-- TABLE: browser_sessions (migration 033)
-- Shared inline browser. One active Browserbase session per chat;
-- Bruce drives it server-side via Stagehand, members watch + interact
-- through a Browserbase Live View iframe. current_url is synced on
-- every action so all members' URL bars update via Realtime.
-- ============================================================

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

CREATE POLICY "browser_sessions_select"
ON browser_sessions FOR SELECT
USING (
  auth.uid() = created_by
  OR EXISTS (SELECT 1 FROM chats WHERE chats.id = browser_sessions.chat_id AND chats.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM chat_members WHERE chat_members.chat_id = browser_sessions.chat_id AND chat_members.user_id = auth.uid())
);

CREATE POLICY "browser_sessions_insert"
ON browser_sessions FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM chats WHERE chats.id = chat_id AND chats.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM chat_members WHERE chat_members.chat_id = chat_id AND chat_members.user_id = auth.uid())
);

CREATE POLICY "browser_sessions_update"
ON browser_sessions FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM chats WHERE chats.id = browser_sessions.chat_id AND chats.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM chat_members WHERE chat_members.chat_id = browser_sessions.chat_id AND chat_members.user_id = auth.uid())
);

CREATE INDEX browser_sessions_chat_active_idx
ON browser_sessions(chat_id, is_active)
WHERE is_active = TRUE;

ALTER PUBLICATION supabase_realtime ADD TABLE browser_sessions;


-- ============================================================
-- SERVICE ROLE NOTE
-- The invite claim flow and background memory jobs run as service
-- role and bypass RLS. This is intentional. Service role key
-- must never be exposed to the client — server-side only via
-- DigitalOcean and Vercel API routes.
-- ============================================================
