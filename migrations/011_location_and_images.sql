-- Migration 011: location and images
-- Applied after 010_notifications_chat.sql

-- Add home_location for location-aware responses
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_location TEXT DEFAULT 'Arlington, Virginia';
UPDATE users SET home_location = 'Arlington, Virginia' WHERE home_location IS NULL;

-- Add image_url for user-uploaded images in messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Note: create the 'message-images' Supabase Storage bucket manually in the
-- Supabase dashboard (Storage → New bucket → name: message-images, public: true).
