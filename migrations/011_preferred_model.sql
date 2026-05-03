ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_model TEXT DEFAULT 'claude-sonnet-4-6';

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_filename TEXT;
