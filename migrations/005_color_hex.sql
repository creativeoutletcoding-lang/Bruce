-- Add color_hex column for per-member bubble colors (Google Calendar palette)
ALTER TABLE users ADD COLUMN IF NOT EXISTS color_hex TEXT NOT NULL DEFAULT '#6B7280';

-- Seed household member colors
UPDATE users SET color_hex = '#7CB342' WHERE name LIKE 'Jake%';
UPDATE users SET color_hex = '#E67C73' WHERE name LIKE 'Laurianne%';
UPDATE users SET color_hex = '#4285F4' WHERE name LIKE 'Jocelynn%';
UPDATE users SET color_hex = '#F6BF26' WHERE name LIKE 'Nana%';
