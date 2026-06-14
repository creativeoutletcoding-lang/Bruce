-- 036_preferred_effort.sql
-- Per-member global effort preference for the Claude effort parameter
-- (output_config.effort). Nullable: NULL means "use the selected model's
-- default effort" (resolved in app code via defaultEffortForModel). Stored as
-- one global value mirroring preferred_model (not per-chat). Valid values are
-- validated in the app layer (low|medium|high|xhigh|max) against the model's
-- supported levels; models that take no effort param (e.g. Haiku) ignore it.
--
-- Apply manually in the Supabase SQL editor (per the project's manual-migration
-- rule). The app tolerates the column being absent only insofar as reads return
-- null → default effort; add it to avoid PostgREST select errors on the new
-- column in getUserProfile / settings / chat routes.

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_effort TEXT DEFAULT NULL;
