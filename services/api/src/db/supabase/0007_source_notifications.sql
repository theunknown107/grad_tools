-- ===========================================================================
-- Supabase 0007 — what a student has been told about a VTU source
-- ===========================================================================
--
-- Authority: Phase 7B.3 §49–§57, §125–§131 · docs/11 §11.13 · M9 §13–§16
--
-- Forward-only. 0001–0006 are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS IN THE CLOUD DATABASE AND NOT THE REFERENCE ONE
-- ---------------------------------------------------------------------------
--
-- The notice itself is reference data: public, shared, identical for everyone.
-- "The student has been told about it, at 19:40, and has not read it" is a fact
-- about a student, and the reference database holds no student data (docs/33
-- §33.3). So the notice stays there and the DELIVERY lives here, owned, with
-- the same four RLS policies as every other student table.
--
-- The consequence is the one §127 asks for: a compromised API cannot read one
-- student's notification list using another student's id, because the database
-- refuses the rows whatever the query asks for.
--
-- ---------------------------------------------------------------------------
-- ONE NOTIFICATION PER STUDENT, PER ITEM, PER VERSION
-- ---------------------------------------------------------------------------
--
-- The unique index below is the whole of §53. Not "the worker is careful" —
-- careful is what every duplicate-notification bug was before it shipped. The
-- identity is (owner, source item, content hash):
--
--   the worker runs twice over the same snapshot   → the second insert is a
--                                                    no-op, by constraint
--   VTU revises the notice                         → the hash differs, so it
--                                                    is a NEW row, which is
--                                                    correct: a reschedule the
--                                                    student never sees is the
--                                                    failure this exists for
--
-- `content_hash` rather than a timestamp, deliberately. A source that
-- re-publishes identical bytes with a fresh date has not said anything new,
-- and a student woken up for it learns to ignore the next one (§48).
--
-- ---------------------------------------------------------------------------
-- SOURCE TEXT IS UNTRUSTED (§129)
-- ---------------------------------------------------------------------------
--
-- Everything in `title` and `reason` came off a document this project did not
-- write. It is stored as text and rendered as text — never as markup — and
-- `source_url` is constrained to http(s) here rather than only in the client,
-- because the client is not the only thing that will ever read this table.
-- ===========================================================================

CREATE TABLE source_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  auth_user_id   uuid NOT NULL DEFAULT auth.uid()
                   REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id     uuid REFERENCES student_profiles (id) ON DELETE CASCADE,

  -- What was published. The source's own id, and the version of it we read.
  source_family  text NOT NULL CHECK (length(source_family) BETWEEN 1 AND 40),
  external_id    text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  content_hash   text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),

  category       text NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  importance     text NOT NULL CHECK (importance IN ('high', 'medium', 'low')),

  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  -- http(s) only. An allowlist, because a blocklist has to be right about
  -- every scheme that will ever exist (M7 §31).
  source_url     text NOT NULL CHECK (source_url ~ '^https?://'),
  -- The date the SOURCE printed, never the time we noticed (§55).
  published_at   date,

  -- Why this student, in words they can read. Never a score (§43).
  reason         text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),

  -- The run that created it, so a bad run can be identified afterwards (§60).
  run_id         text NOT NULL CHECK (length(run_id) BETWEEN 1 AND 64),

  state          text NOT NULL DEFAULT 'unread'
                   CHECK (state IN ('unread', 'read', 'dismissed')),

  revision       integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- §53, enforced rather than intended.
CREATE UNIQUE INDEX source_notifications_one_per_version
  ON source_notifications (auth_user_id, external_id, content_hash);

-- The list the student actually opens: their unread ones, newest first.
CREATE INDEX source_notifications_by_owner
  ON source_notifications (auth_user_id, state, created_at DESC);

COMMENT ON TABLE source_notifications IS
  'Delivery of a VTU source item to one student. The notice is reference data; '
  'this is the fact that a particular person was told about it.';
COMMENT ON COLUMN source_notifications.content_hash IS
  'The version of the item this notification is about. Part of the uniqueness '
  'key: a revision is a new notification, a re-run is not.';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['source_notifications']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()))',
      t || '_select_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (auth_user_id = (SELECT auth.uid()))',
      t || '_insert_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (auth_user_id = (SELECT auth.uid())) WITH CHECK (auth_user_id = (SELECT auth.uid()))',
      t || '_update_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (auth_user_id = (SELECT auth.uid()))',
      t || '_delete_own', t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);

    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_row()',
      t || '_touch', t);
  END LOOP;
END
$$;
