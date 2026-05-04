-- Migration 013: fix member colors
-- Applied after 012_preferred_model.sql

-- Fix member profile colors to match Google Calendar palette.
-- Matches on first name (case-insensitive) since emails are not available
-- in the migration context. Names are unique across the household.
-- Run once in Supabase SQL editor or via psql.

UPDATE users SET color_hex = '#33B679' WHERE name ILIKE '%Jake%';       -- Sage
UPDATE users SET color_hex = '#9E69AF' WHERE name ILIKE '%Laurianne%';  -- Grape
UPDATE users SET color_hex = '#0B8043' WHERE name ILIKE '%Jocelynn%';   -- Basil
UPDATE users SET color_hex = '#E67C73' WHERE name ILIKE '%Nana%';       -- Flamingo
