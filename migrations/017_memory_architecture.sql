-- ============================================================
-- Migration 017: Memory architecture — private vs shared
-- Apply in Supabase SQL editor. See docs/migration-log.md.
-- ============================================================

-- 1. Add isolate_memory to projects
ALTER TABLE projects
  ADD COLUMN isolate_memory BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Rename user_id → owner_id in memory (all existing rows become private)
ALTER TABLE memory RENAME COLUMN user_id TO owner_id;

-- 3. Allow owner_id to be null (shared memories have no single owner)
ALTER TABLE memory ALTER COLUMN owner_id DROP NOT NULL;

-- 4. Add type, member_combination, project_id
ALTER TABLE memory
  ADD COLUMN type TEXT NOT NULL DEFAULT 'private'
    CHECK (type IN ('private', 'shared')),
  ADD COLUMN member_combination TEXT,
  ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- 5. Drop old indexes
DROP INDEX IF EXISTS idx_memory_user;
DROP INDEX IF EXISTS idx_memory_user_tier;
DROP INDEX IF EXISTS idx_memory_relevance;

-- 6. New indexes
CREATE INDEX idx_memory_owner           ON memory(owner_id)              WHERE owner_id IS NOT NULL;
CREATE INDEX idx_memory_owner_tier      ON memory(owner_id, tier)        WHERE owner_id IS NOT NULL;
CREATE INDEX idx_memory_owner_relevance ON memory(owner_id, relevance_score DESC) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_memory_member_combo    ON memory(member_combination)    WHERE member_combination IS NOT NULL;
CREATE INDEX idx_memory_project         ON memory(project_id)            WHERE project_id IS NOT NULL;

-- 7. Replace the old single-policy with split SELECT/INSERT/UPDATE/DELETE policies
DROP POLICY IF EXISTS "memory_owner_only" ON memory;

-- Private: only the owner.
-- Shared: any member whose UUID appears in the colon-separated member_combination.
CREATE POLICY "memory_select"
  ON memory FOR SELECT TO authenticated
  USING (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );

CREATE POLICY "memory_insert"
  ON memory FOR INSERT TO authenticated
  WITH CHECK (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );

CREATE POLICY "memory_update"
  ON memory FOR UPDATE TO authenticated
  USING (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  )
  WITH CHECK (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );

CREATE POLICY "memory_delete"
  ON memory FOR DELETE TO authenticated
  USING (
    (type = 'private' AND owner_id = auth.uid())
    OR (type = 'shared' AND auth.uid()::text = ANY(string_to_array(member_combination, ':')))
  );
