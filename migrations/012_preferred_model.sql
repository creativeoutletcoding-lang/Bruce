-- Migration 012: preferred model and attachment columns
-- Applied after 011_location_and_images.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_model TEXT DEFAULT 'claude-sonnet-4-6';

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_filename TEXT;
