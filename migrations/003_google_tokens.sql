-- ============================================================
-- Migration 003 — Google OAuth tokens + Drive folder IDs
-- Run in Supabase SQL editor
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_access_token       TEXT,
  ADD COLUMN IF NOT EXISTS google_refresh_token      TEXT,
  ADD COLUMN IF NOT EXISTS google_token_expires_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_drive_root_id      TEXT,
  ADD COLUMN IF NOT EXISTS google_drive_personal_id  TEXT,
  ADD COLUMN IF NOT EXISTS google_drive_projects_id  TEXT;
