-- Migration 029: full-text search index on messages.content
-- Enables fast tsvector-based search for search_chat_history tool
-- and /api/search/chats endpoint.

CREATE INDEX IF NOT EXISTS messages_content_fts_idx
  ON messages USING GIN (to_tsvector('english', content));
