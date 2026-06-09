-- Migration 034 — browser_sessions.connect_url
-- Stores the signed CDP WebSocket URL returned by bb.sessions.create() so the
-- action runner can connect to the existing Browserbase session directly via
-- Playwright (chromium.connectOverCDP) without re-retrieving it from Browserbase.
-- Stagehand v3.5's browserbaseSessionID reconnect path is unreliable (it can't
-- locate the connectUrl on the retrieved session), so we connect over CDP instead.

ALTER TABLE browser_sessions
ADD COLUMN IF NOT EXISTS connect_url TEXT;
