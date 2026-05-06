# Bruce Database Schema — Live Reference
_Reflects schema.sql + migrations 003–014_

---

## household

Single shared record for the whole family.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| memories | JSONB | NOT NULL | `'[]'` |
| context | JSONB | NOT NULL | `'{}'` |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id
- **Trigger:** `household_updated_at` — auto-updates `updated_at`
- **RLS:** enabled
  - `household_read_authenticated` — any authenticated user can SELECT
  - `household_write_admin` — INSERT/UPDATE/DELETE requires `is_admin()`
- **Seeded:** one row on schema init with Johnson family context JSON

---

## users

One row per household member. Linked to `auth.users` via id.  
Columns added incrementally across migrations 003, 005, 011, 012.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | — (PK, FK → auth.users) |
| email | TEXT | NOT NULL | — (UNIQUE) |
| name | TEXT | NOT NULL | — |
| avatar_url | TEXT | nullable | — |
| role | TEXT | NOT NULL | `'member'` |
| status | TEXT | NOT NULL | `'active'` |
| morning_summary_time | TEXT | NOT NULL | `'08:00'` |
| notification_sensitivity | TEXT | NOT NULL | `'medium'` |
| notification_preferences | JSONB | NOT NULL | `'{}'` |
| fcm_token | TEXT | nullable | — |
| google_access_token | TEXT | nullable | — |
| google_refresh_token | TEXT | nullable | — |
| google_token_expires_at | TIMESTAMPTZ | nullable | — |
| google_drive_root_id | TEXT | nullable | — |
| google_drive_personal_id | TEXT | nullable | — |
| google_drive_projects_id | TEXT | nullable | — |
| color_hex | TEXT | NOT NULL | `'#6B7280'` |
| home_location | TEXT | NOT NULL | `'Arlington, Virginia'` |
| preferred_model | TEXT | nullable | `'claude-sonnet-4-6'` |
| deactivated_at | TIMESTAMPTZ | nullable | — |
| purge_at | TIMESTAMPTZ | nullable | — |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FK:** `auth.users(id)` ON DELETE CASCADE
- **Constraints:** `role IN ('admin','member')`, `status IN ('active','suspended','deactivated')`, `notification_sensitivity IN ('low','medium','high')`
- **Indexes:** `idx_users_email (email)`, `idx_users_status (status)`
- **Trigger:** `users_updated_at`
- **RLS:** enabled
  - `users_select_own` — own row or `is_admin()`
  - `users_insert_self` — id must equal auth.uid()
  - `users_update_own` — own row or admin
  - `users_delete_admin` — admin only

---

## invite_tokens

Single-use, 48-hour invite links. Created by admin only.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| token | TEXT | NOT NULL | `encode(gen_random_bytes(32),'hex')` (UNIQUE) |
| created_by | UUID | NOT NULL | — (FK → users) |
| email | TEXT | nullable | — |
| role | TEXT | NOT NULL | `'member'` |
| used | BOOLEAN | NOT NULL | `false` |
| expires_at | TIMESTAMPTZ | NOT NULL | NOW() + 48h |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FK:** `created_by → users(id)` ON DELETE CASCADE
- **Constraint:** `role IN ('admin','member')`
- **Index:** `idx_invite_tokens_token (token)`
- **RLS:** enabled
  - `invite_tokens_admin_all` — full access for admin
  - `invite_tokens_public_validate` (anon) — SELECT on unused, non-expired tokens only (powers /join page pre-login)

---

## projects

Workspace containers. Any member can own a project.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| owner_id | UUID | NOT NULL | — (FK → users, ON DELETE SET NULL) |
| name | TEXT | NOT NULL | — |
| icon | TEXT | NOT NULL | `'📁'` |
| instructions | TEXT | NOT NULL | `''` |
| status | TEXT | NOT NULL | `'active'` |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FK:** `owner_id → users(id)` ON DELETE SET NULL
- **Constraint:** `status IN ('active','archived')`
- **Index:** `idx_projects_owner (owner_id)`
- **Trigger:** `projects_updated_at`
- **RLS:** enabled
  - `projects_select_member` — project member or admin
  - `projects_insert_authenticated` — owner_id = auth.uid()
  - `projects_update_owner` — owner or admin
  - `projects_delete_owner` — owner or admin

---

## project_members

Join table. Members explicitly invited by the project owner.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| project_id | UUID | NOT NULL | — (FK → projects) |
| user_id | UUID | NOT NULL | — (FK → users) |
| role | TEXT | NOT NULL | `'member'` |
| joined_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FKs:** `project_id → projects(id)` CASCADE, `user_id → users(id)` CASCADE
- **Constraint:** `role IN ('owner','member')`, UNIQUE(project_id, user_id)
- **Indexes:** `idx_project_members_project`, `idx_project_members_user`
- **RLS:** enabled
  - `project_members_select` — own membership, admin, or is project owner
  - `project_members_insert_owner` — project owner or admin
  - `project_members_delete_owner` — project owner or admin

---

## chats

All conversation containers: private, project, family group, family threads, incognito.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| owner_id | UUID | NOT NULL | — (FK → users) |
| project_id | UUID | nullable | — (FK → projects, NULL = standalone) |
| type | TEXT | NOT NULL | `'private'` |
| title | TEXT | nullable | — |
| is_incognito | BOOLEAN | NOT NULL | `false` |
| deleted_at | TIMESTAMPTZ | nullable | — (soft-delete for family_thread) |
| last_message_at | TIMESTAMPTZ | NOT NULL | NOW() |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FKs:** `owner_id → users(id)` CASCADE, `project_id → projects(id)` CASCADE
- **Constraint:** `type IN ('private','group','family','family_group','family_thread','incognito')`
- **Indexes:** `idx_chats_owner`, `idx_chats_project`, `idx_chats_last_message (DESC)`, `idx_chats_type`, `idx_chats_deleted (WHERE deleted_at IS NOT NULL)`
- **Trigger:** `chats_updated_at`
- **Realtime:** yes (supabase_realtime)
- **RLS:** enabled
  - `chats_select` — owner, chat member, project member, or admin
  - `chats_insert` — owner_id = uid, project_id must be a member project
  - `chats_update_owner` — owner or admin
  - `chats_delete_owner` — owner or admin
  - `family_group_chat_select` — any authenticated user sees type='family_group'
  - `family_thread_chat_select` — must be in chat_members for that thread and thread not deleted

---

## chat_members

Who is in a group, family group, or family thread chat.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| chat_id | UUID | NOT NULL | — (FK → chats) |
| user_id | UUID | NOT NULL | — (FK → users) |
| joined_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FKs:** `chat_id → chats(id)` CASCADE, `user_id → users(id)` CASCADE
- **Constraint:** UNIQUE(chat_id, user_id)
- **Indexes:** `idx_chat_members_chat`, `idx_chat_members_user`
- **Realtime:** yes
- **RLS:** enabled
  - `chat_members_select` — own row, chat member, or admin
  - `chat_members_insert_owner` — chat owner or admin
  - `chat_members_delete_owner` — chat owner or admin
  - `family_thread_members_select` — any member of the same family thread

---

## messages

Every persisted message in every chat. Incognito messages never reach this table.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| chat_id | UUID | NOT NULL | — (FK → chats) |
| sender_id | UUID | nullable | — (NULL = Bruce) |
| role | TEXT | NOT NULL | — |
| content | TEXT | NOT NULL | — |
| metadata | JSONB | NOT NULL | `'{}'` |
| image_url | TEXT | nullable | — |
| attachment_type | TEXT | nullable | — |
| attachment_filename | TEXT | nullable | — |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FKs:** `chat_id → chats(id)` CASCADE, `sender_id → users(id)` ON DELETE SET NULL
- **Constraint:** `role IN ('user','assistant','system')`
- **Indexes:** `idx_messages_chat`, `idx_messages_chat_created (chat_id, created_at)`, `idx_messages_sender`
- **Realtime:** yes
- **RLS:** enabled — messages never updated or deleted by users
  - `messages_select` — chat member, project member of the containing project, or admin
  - `messages_insert` — sender_id = uid, must be chat/project member
  - `family_thread_messages_select` — membership-gated family thread access
  - `family_thread_messages_insert` — membership-gated insert

---

## files

Google Drive files attached to projects.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| project_id | UUID | NOT NULL | — (FK → projects) |
| owner_id | UUID | nullable | — (FK → users, ON DELETE SET NULL) |
| google_drive_file_id | TEXT | NOT NULL | — |
| name | TEXT | NOT NULL | — |
| mime_type | TEXT | nullable | — |
| drive_url | TEXT | nullable | — |
| last_updated | TIMESTAMPTZ | NOT NULL | NOW() |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FKs:** `project_id → projects(id)` CASCADE, `owner_id → users(id)` ON DELETE SET NULL
- **Index:** `idx_files_project`
- **RLS:** enabled
  - `files_select` — project member or admin
  - `files_insert` — project member with owner_id = uid, or admin
  - `files_delete_owner` — file owner, project owner, or admin

---

## memory

Per-member personal memory. Three tiers: core, active, archive.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| user_id | UUID | NOT NULL | — (FK → users) |
| content | TEXT | NOT NULL | — |
| tier | TEXT | NOT NULL | `'active'` |
| relevance_score | FLOAT | NOT NULL | `1.0` |
| category | TEXT | nullable | — |
| last_accessed | TIMESTAMPTZ | NOT NULL | NOW() |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FK:** `user_id → users(id)` CASCADE
- **Constraint:** `tier IN ('core','active','archive')`
- **Indexes:** `idx_memory_user`, `idx_memory_user_tier`, `idx_memory_relevance (user_id, relevance_score DESC)`
- **Trigger:** `memory_updated_at`
- **RLS:** enabled — strict owner-only, no admin bypass
  - `memory_owner_only` — ALL operations require user_id = auth.uid()

---

## notifications

All push notifications. Linked to the generating chat when applicable.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| user_id | UUID | NOT NULL | — (FK → users) |
| type | TEXT | NOT NULL | — |
| content | TEXT | NOT NULL | — |
| metadata | JSONB | NOT NULL | `'{}'` |
| read | BOOLEAN | NOT NULL | `false` |
| chat_id | UUID | nullable | — (FK → chats, ON DELETE SET NULL) |
| read_at | TIMESTAMPTZ | nullable | — |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FKs:** `user_id → users(id)` CASCADE, `chat_id → chats(id)` ON DELETE SET NULL
- **Indexes:** `idx_notifications_user`, `idx_notifications_unread (WHERE read=false)`, `idx_notifications_chat_unread (user_id, chat_id WHERE read=false)`
- **Realtime:** yes
- **RLS:** enabled
  - `notifications_owner_only` — ALL operations: user_id = auth.uid()

---

## pending_memory

Household memory suggestions from members awaiting admin approval.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| suggested_by | UUID | nullable | — (FK → users, ON DELETE SET NULL) |
| content | TEXT | NOT NULL | — |
| status | TEXT | NOT NULL | `'pending'` |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id — **FK:** `suggested_by → users(id)` ON DELETE SET NULL
- **Constraint:** `status IN ('pending','approved','rejected')`
- **RLS:** enabled
  - `pending_memory_insert` — suggested_by = auth.uid()
  - `pending_memory_select` — own suggestions or admin
  - `pending_memory_update_admin` — admin only

---

## user_presence

Tracks which chat each user has open for push notification suppression.  
One row per (user_id, chat_id). Upserted on a 30s heartbeat while a chat window is mounted.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| user_id | UUID | NOT NULL | — (FK → users) |
| chat_id | UUID | NOT NULL | — (FK → chats) |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** (user_id, chat_id) — **FKs:** both CASCADE
- **RLS:** enabled, no user-facing policies — service role access only

---

## admin_dev_messages

Persistent history for the Bruce Dev admin workspace. Added in migration 014.

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | UUID | NOT NULL | uuid_generate_v4() |
| role | TEXT | NOT NULL | — |
| content | TEXT | NOT NULL | — |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() |

- **PK:** id
- **Constraint:** `role IN ('user','assistant')`
- **RLS:** none — accessed exclusively via service role client in admin API routes

---

## Helper Functions

| Function | Returns | Notes |
|----------|---------|-------|
| `is_admin()` | BOOLEAN | True if auth.uid() has role='admin'. SECURITY DEFINER, STABLE. |
| `is_project_member(p_id UUID)` | BOOLEAN | True if auth.uid() is in project_members for that project. |
| `is_chat_member(c_id UUID)` | BOOLEAN | True if auth.uid() owns or is a member of that chat. |
| `update_updated_at()` | TRIGGER | Sets NEW.updated_at = NOW() before UPDATE. |

---

## Realtime Publications

Tables on `supabase_realtime`: `messages`, `notifications`, `chats`, `chat_members`

## Extensions

`uuid-ossp` (uuid_generate_v4), `pgcrypto` (gen_random_bytes for invite tokens)
