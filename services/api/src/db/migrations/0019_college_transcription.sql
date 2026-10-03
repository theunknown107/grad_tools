-- ===========================================================================
-- 0019 — colleges can say "autonomy not established", and carry their region
-- ===========================================================================
--
-- Forward-only. Earlier migrations are released and are not edited.
--
-- The college list is a one-time transcription of
-- https://vtu.ac.in/affiliated-institute/ (packages/vtu-catalogue/data/
-- vtu-colleges.json). That page states code, name and region, and says nothing
-- about autonomy. 0001 made `is_autonomous NOT NULL DEFAULT false`, so seeding
-- the list would have asserted "not autonomous" for every college — the same
-- defaulted-fact defect 0002 and 0011 fixed for other columns, and on the one
-- column that decides whether VTU's rules apply at all (0003).
--
-- After this:
--   is_autonomous = true/false  established by a source
--   is_autonomous IS NULL       nobody has established it
-- and a college cannot be PUBLISHED while it is NULL, so the public API (whose
-- contract types it as boolean) never serves an unknown as a fact.
--
-- `region` is the page's section heading. `catalogue_id` is the transcription's
-- stable id, the upsert key: the page's codes are not unique (the same code is
-- printed for different institutions), so code cannot be the key.

ALTER TABLE colleges
  ALTER COLUMN is_autonomous DROP NOT NULL,
  ALTER COLUMN is_autonomous DROP DEFAULT,
  ADD COLUMN region text,
  ADD COLUMN catalogue_id text UNIQUE;

ALTER TABLE colleges
  ADD CONSTRAINT colleges_publish_requires_known_autonomy CHECK (
    publication = 'unpublished' OR is_autonomous IS NOT NULL
  );

COMMENT ON COLUMN colleges.is_autonomous IS
  'Whether the college is autonomous. NULL means no source has established it; it must never be read as false (0019).';
COMMENT ON COLUMN colleges.catalogue_id IS
  'Stable id from packages/vtu-catalogue/data/vtu-colleges.json; the seed upserts on it (0019).';
