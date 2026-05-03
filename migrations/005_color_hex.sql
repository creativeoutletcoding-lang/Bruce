-- Add color_hex column for per-member bubble colors (Google Calendar palette)
ALTER TABLE users ADD COLUMN IF NOT EXISTS color_hex TEXT NOT NULL DEFAULT '#6B7280';

-- Seed household member colors (johnson2016family Google Calendar palette)
UPDATE users SET color_hex = '#33B679' WHERE email = 'jakej35@me.com';
UPDATE users SET color_hex = '#9E69AF' WHERE name LIKE 'Laurianne%';
UPDATE users SET color_hex = '#0B8043' WHERE name LIKE 'Jocelynn%';
UPDATE users SET color_hex = '#C0CA33' WHERE name LIKE 'Nana%';
