-- ============================================================
-- Migration 018: get_memory_metrics() — aggregate counts only
-- Runs with SECURITY DEFINER so it can read across all members
-- without bypassing the RLS privacy model on content queries.
-- No memory content is returned — aggregate counts only.
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
    u.id AS user_id,
    u.name,
    (SELECT COUNT(*) FROM memory m
      WHERE m.type = 'private' AND m.owner_id = u.id AND m.tier = 'core'
    ) AS private_core_count,
    (SELECT COUNT(*) FROM memory m
      WHERE m.type = 'private' AND m.owner_id = u.id AND m.tier = 'active'
    ) AS private_active_count,
    (SELECT COUNT(*) FROM memory m
      WHERE m.type = 'private' AND m.owner_id = u.id AND m.tier = 'archive'
    ) AS private_archive_count,
    (SELECT COUNT(*) FROM memory m
      WHERE m.type = 'shared'
        AND u.id::text = ANY(string_to_array(m.member_combination, ':'))
    ) AS shared_count,
    (SELECT COUNT(*) FROM memory m
      WHERE (m.type = 'private' AND m.owner_id = u.id)
         OR (m.type = 'shared'
             AND u.id::text = ANY(string_to_array(m.member_combination, ':')))
    ) AS total_count
  FROM users u
  WHERE u.status = 'active'
  ORDER BY u.name;
$$;

GRANT EXECUTE ON FUNCTION get_memory_metrics() TO authenticated;
