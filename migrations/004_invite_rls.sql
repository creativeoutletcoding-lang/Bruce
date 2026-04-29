-- ============================================================
-- Migration 004 — Public SELECT policy for invite token validation
-- Run in Supabase SQL editor
-- ============================================================

-- Allow unauthenticated users to validate (not claim) invite tokens.
-- This powers the /join page which must work before the user has a session.
-- Only non-expired, unused tokens are visible — no sensitive leakage.
CREATE POLICY "invite_tokens_public_validate"
  ON invite_tokens FOR SELECT
  TO anon
  USING (used = false AND expires_at > NOW());
