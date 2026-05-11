-- 021 — Anthropic Files API: add file_ids to messages
-- Stores Anthropic file IDs in parallel with metadata.attachments so history
-- can reference uploaded files by ID instead of re-sending base64 on every call.
ALTER TABLE messages ADD COLUMN file_ids JSONB;
