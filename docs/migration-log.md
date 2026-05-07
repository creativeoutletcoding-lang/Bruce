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
| 016 | Fix RLS admin overrides — removes `is_admin()` from 14 policies across 6 tables (`projects`, `project_members`, `chats`, `chat_members`, `messages`, `files`); drops and recreates each violating policy without the admin bypass | ⬜ |
