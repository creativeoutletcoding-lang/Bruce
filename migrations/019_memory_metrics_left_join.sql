-- ============================================================
-- Migration 019: rewrite get_memory_metrics() with LEFT JOIN
-- Guarantees all active members are returned regardless of
-- whether they have any memory records yet. The previous
-- correlated-subquery version was correct in theory but the
-- deployed instance filtered to members with existing records.
-- Apply in Supabase SQL editor. See docs/migration-log.md.
-- ============================================================

CREATE OR REPLACE FUNCTION get_memory_metrics()
RETURNS TABLE (
  user_id              UUID,
  name                 TEXT,
  private_core_count   BIGINT,
  private_active_count BIGINT,
  private_archive_count BIGINT,
  shared_count         BIGINT,
  total_count          BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id   AS user_id,
    u.name,
    COUNT(*) FILTER (
      WHERE m.type = 'private' AND m.tier = 'core'
    ) AS private_core_count,
    COUNT(*) FILTER (
      WHERE m.type = 'private' AND m.tier = 'active'
    ) AS private_active_count,
    COUNT(*) FILTER (
      WHERE m.type = 'private' AND m.tier = 'archive'
    ) AS private_archive_count,
    COUNT(*) FILTER (
      WHERE m.type = 'shared'
    ) AS shared_count,
    COUNT(m.id) AS total_count
  FROM users u
  LEFT JOIN memory m ON (
    (m.type = 'private' AND m.owner_id = u.id)
    OR (m.type = 'shared'
        AND u.id::text = ANY(string_to_array(m.member_combination, ':')))
  )
  WHERE u.status = 'active'
  GROUP BY u.id, u.name
  ORDER BY u.name;
$$;

GRANT EXECUTE ON FUNCTION get_memory_metrics() TO authenticated;
