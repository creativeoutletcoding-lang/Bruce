# Migration Log

This file tracks which migrations have been applied to the production Supabase instance. Update it every time a migration is run. The application will 500 on any route that depends on an unapplied migration.

| Migration | Description | Applied |
|-----------|-------------|---------|
| 001–002 | Initial schema — tables, RLS, helper functions, household seed row. Applied via `schema.sql` at project creation. No separate migration file. | ✅ |
| 003 | Google OAuth tokens + Drive folder IDs — adds 6 columns to `users`: `google_access_token`, `google_refresh_token`, `google_token_expires_at`, `google_drive_root_id`, `google_drive_personal_id`, `google_drive_projects_id` | ✅ |
| 004 | Public invite token validation — adds anon `SELECT` RLS policy on `invite_tokens` so the `/join` page can validate tokens without an authenticated session | ✅ |
| 005 | Per-member bubble colors — adds `color_hex` column to `users` (default `#6B7280`), seeds household member colors from the Google Calendar palette | ✅ |
| 006 | Family group chat — schema and RLS changes to support the one permanent household group chat (`type = 'family_group'`) | ✅ |
| 007 | Family threads — adds `deleted_at` to `chats`, RLS policies for `type = 'family_thread'` rows, allows soft-delete of named sub-topic threads | ✅ |
| 008 | Family thread membership — replaces the type-based thread RLS policies from 006/007 with `chat_members`-gated policies; users only see threads they are members of | ✅ |
| 009 | User presence tracking — creates `user_presence` table (one row per `user_id`/`chat_id`, upserted on heartbeat) used to suppress push notifications when the recipient already has the chat open | ✅ |
| 010 | Notifications `chat_id` and `read_at` — adds `chat_id` FK to `notifications` (links notification to the generating chat for per-chat unread counts) and `read_at` timestamp (alongside the existing `read` boolean) | ✅ |
| 011 | Location and image attachment columns — adds `home_location` to `users` (default `'Arlington, Virginia'`), adds `image_url` and `attachment_type` to `messages` | ✅ |
| 012 | Preferred model and attachment metadata — adds `preferred_model` to `users` (default `'claude-sonnet-4-6'`), adds `attachment_filename` to `messages` | ✅ |
| 013 | Fix member colors — corrects `color_hex` values for Laurianne, Jocelynn, and Nana to match their assigned Google Calendar palette colors; matches on name since emails weren't available in migration context | ✅ |
| 014 | Admin dev messages table — creates `admin_dev_messages` table for the Bruce Dev workspace persistent history (`id`, `role`, `content`, `created_at`); service role only, no RLS | ✅ |
| 015 | Admin dev sessions — creates `admin_dev_sessions` table, adds `session_id` FK column to `admin_dev_messages`, migrates any existing messages into a "Session 1" session | ✅ |
| 016 | Fix RLS admin overrides — removes `is_admin()` from 14 policies across 6 tables (`projects`, `project_members`, `chats`, `chat_members`, `messages`, `files`); drops and recreates each violating policy without the admin bypass | ✅ |
| 017 | Memory architecture — private/shared memory types, `owner_id`, `member_combination`, `project_id` on `memory` table | ✅ |
| 018 | Memory metrics function — `get_memory_metrics()` SECURITY DEFINER function for admin panel | ✅ |
| 019 | Memory metrics left join fix — updates `get_memory_metrics()` to use LEFT JOIN | ✅ |
| 020 | Message delete policy — RLS policy allowing users to delete their own messages | ✅ |
| 021 | Anthropic Files API — adds `file_ids JSONB` to `messages`; stores Anthropic file IDs parallel to `metadata.attachments` for context-window-efficient history replay | ✅ |
| 022 | Meals & Groceries project instructions — appends planning-first guidance to the project: lead with a plan, one round of questions max, conversational prose for questions in group chat | ✅ |
| 023 | Remove Loubi from memory — updates 6 memory records to strip the "Loubi" nickname, deletes 4 records whose content was solely about the nickname; applied directly via REST API 2026-05-12 | ✅ |
| 024 | Chat members `last_read_at` — adds nullable `last_read_at TIMESTAMPTZ` to `chat_members`, an index on `(chat_id, user_id, last_read_at)`, and an `UPDATE` RLS policy letting a member set their own `last_read_at`. Powers the sidebar unread-dot logic. | ✅ |
| 025 | `system_config` table — key/value store for runtime-mutable configuration (e.g. OAuth tokens refreshed via the admin UI). Primary key on `key TEXT`. RLS: admins can read; writes are service-role only. Used to store `family_calendar_refresh_token` set by `/admin/calendar-reauth`. | ✅ |
| 026 | `user_fcm_tokens` table — replaces single `users.fcm_token` column with a multi-device token table. Columns: `id UUID`, `user_id UUID FK`, `token TEXT UNIQUE`, `device_hint TEXT`, `created_at`, `last_seen_at`. Seeded from existing `users.fcm_token` values. RLS enabled, service role only. `notifyUser()` fans out to all tokens; stale tokens (FCM 404) are auto-deleted. | ✅ |
| 027 | `reminders` table — personal reminders managed via the `manage_reminders` tool. Columns: `id UUID`, `user_id UUID FK`, `content TEXT`, `remind_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ`, `notified_at TIMESTAMPTZ`, `created_at`. Index on `(user_id, remind_at) WHERE completed_at IS NULL`. RLS: users manage their own rows. Cron at `/api/cron/reminders` fires FCM and sets `notified_at`. | ✅ |
| 028 | Add `chat_id UUID` to `reminders` — FK to `chats(id)` ON DELETE SET NULL. Populated when `manage_reminders` is called from a chat. Used by the cron to build FCM deep-link URL (`/chat/[id]`). | ✅ |
| 029 | Full-text search index on `messages.content` — `CREATE INDEX messages_content_fts_idx ON messages USING GIN (to_tsvector('english', content))`. Enables fast tsvector-based search for the `search_chat_history` tool and `/api/search/chats` endpoint. | ✅ |
| 030 | `reactions` table — thumbs-up (and extensible) reactions on messages. `id UUID`, `message_id FK`, `chat_id FK` (denormalized for realtime filtering), `user_id UUID` (nullable — NULL = Bruce), `type TEXT` (default `thumbs_up`). Two partial unique indexes enforce one reaction per type per reactor. RLS: read via `is_chat_member(chat_id)`, insert/delete scoped to `auth.uid()`. Service role for Bruce reactions. | ✅ |
| 031 | `member_exclusions` table — mutual exclusion pairs preventing two members from sharing a chat or project. `id UUID`, `user_id_a UUID FK`, `user_id_b UUID FK`, `created_by UUID FK`, `created_at`. Unique expression index on `(LEAST, GREATEST)` of the two UUIDs. Admin-only RLS. DB-level triggers on `chat_members` and `project_members` enforce exclusions at insert time with a `member_exclusion_violation` exception. API routes return 409 on violation. UI greys out excluded members in member pickers. | ⬜ apply in Supabase SQL editor |
| 032 | CPS project instructions data update (not schema) — appends two sections to the CPS project (`c0c4dcb3-…`) instructions: `## OUTPUT 2: SAASANT CSV` (8-column QBO/SaaSant spec, two-rows-per-sitter rule) and `## VERIFICATION SUMMARY RULE` (read totals back from the written sheet via Sheets API before summarizing). Idempotent `NOT LIKE` guards; SELECT after each to verify. | ⬜ apply in Supabase SQL editor |
