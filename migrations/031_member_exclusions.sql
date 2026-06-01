-- member_exclusions: prevents two members from ever sharing a chat or project
CREATE TABLE member_exclusions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_a   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_b   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_exclusion CHECK (user_id_a <> user_id_b)
);

-- Canonical pair uniqueness regardless of which ID is in which column
CREATE UNIQUE INDEX unique_exclusion_pair ON member_exclusions (
  LEAST(user_id_a::text, user_id_b::text),
  GREATEST(user_id_a::text, user_id_b::text)
);

-- Only admins can read/write exclusions
ALTER TABLE member_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_only" ON member_exclusions
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Block adding a member to chat_members if the other excluded member is already present
CREATE OR REPLACE FUNCTION check_chat_member_exclusion()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM chat_members cm
    JOIN member_exclusions me
      ON (
        (me.user_id_a = NEW.user_id AND me.user_id_b = cm.user_id)
        OR
        (me.user_id_b = NEW.user_id AND me.user_id_a = cm.user_id)
      )
    WHERE cm.chat_id = NEW.chat_id
  ) THEN
    RAISE EXCEPTION 'member_exclusion_violation: this member cannot be added to a chat containing an excluded member';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_chat_member_exclusion
  BEFORE INSERT ON chat_members
  FOR EACH ROW EXECUTE FUNCTION check_chat_member_exclusion();

-- Block adding a member to project_members if the other excluded member is already present
CREATE OR REPLACE FUNCTION check_project_member_exclusion()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM project_members pm
    JOIN member_exclusions me
      ON (
        (me.user_id_a = NEW.user_id AND me.user_id_b = pm.user_id)
        OR
        (me.user_id_b = NEW.user_id AND me.user_id_a = pm.user_id)
      )
    WHERE pm.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'member_exclusion_violation: this member cannot be added to a project containing an excluded member';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_project_member_exclusion
  BEFORE INSERT ON project_members
  FOR EACH ROW EXECUTE FUNCTION check_project_member_exclusion();

-- ── Seed: Grampy ↔ Nana mutual exclusion ─────────────────────────────────────
-- Run this block after Grampy's user row exists. Replace the subqueries with
-- the real UUIDs if name matching is ambiguous in your environment.
--
-- INSERT INTO member_exclusions (user_id_a, user_id_b, created_by)
-- SELECT
--   (SELECT id FROM users WHERE name ILIKE '%grampy%' LIMIT 1),
--   (SELECT id FROM users WHERE name ILIKE '%nana%'   LIMIT 1),
--   (SELECT id FROM users WHERE role = 'admin'        LIMIT 1);
--
-- Verify:
-- SELECT u1.name AS member_a, u2.name AS member_b
-- FROM member_exclusions me
-- JOIN users u1 ON u1.id = me.user_id_a
-- JOIN users u2 ON u2.id = me.user_id_b;
