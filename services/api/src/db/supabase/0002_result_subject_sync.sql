-- ===========================================================================
-- Supabase 0002 — result subjects join the sync, and cannot cross students
-- ===========================================================================
--
-- Authority: docs/08 §8.18 · docs/09 §9.19 · docs/13 §13.18 · M9.1 §1, §3
--
-- Forward-only. `0001_student_cloud.sql` is released and is not edited.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
--
-- `result_subjects` was created with ownership and a parent and NOTHING ELSE:
-- no `revision`, no `updated_at`, no `deleted_at`, no trigger. Every other
-- student table has all four, because that is what sync needs to detect a
-- change, order a pull and represent a deletion (docs/08 §8.17).
--
-- So a semester result could reach the cloud while the subjects that give it
-- meaning — the codes, credits and grades the SGPA is computed from — could
-- not. A student syncing to a second device would have found results with no
-- subjects in them, which is worse than having no results at all: an empty
-- result looks like a real record of a semester in which nothing was taken.
--
-- ---------------------------------------------------------------------------
-- THE OWNERSHIP HOLE THIS ALSO CLOSES
-- ---------------------------------------------------------------------------
--
-- `result_subjects.auth_user_id` and `result_subjects.result_id` were
-- independent. RLS guaranteed a row's OWN owner matched the caller, and the FK
-- guaranteed the parent existed — but nothing tied the two together. A row
-- owned by A could point at a result owned by B.
--
-- RLS alone would still have hidden B's parent from A. But the invariant a
-- reader needs is stronger and simpler than "you cannot see it": a subject row
-- belongs to the same student as the result it is part of, always, by
-- construction. A composite foreign key states exactly that, and the database
-- enforces it on every write without anybody remembering to check (M9.1 §3).

-- ---------------------------------------------------------------------------
-- Sync metadata
-- ---------------------------------------------------------------------------

ALTER TABLE result_subjects
  ADD COLUMN revision   integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  -- A TOMBSTONE, like everywhere else. A subject row that simply vanished is
  -- indistinguishable from one the other device has not seen yet, and would be
  -- resurrected on the next pull (M9 §68).
  ADD COLUMN deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- The parent/child ownership invariant
-- ---------------------------------------------------------------------------
--
-- A composite FK needs a matching unique constraint on the parent. `id` is
-- already the primary key, so `(id, auth_user_id)` is unique for free — it
-- exists to be REFERENCED, not to constrain anything new.

ALTER TABLE semester_results
  ADD CONSTRAINT semester_results_id_owner UNIQUE (id, auth_user_id);

-- Replace the plain parent reference with one that carries the owner.
ALTER TABLE result_subjects
  DROP CONSTRAINT result_subjects_result_id_fkey;

ALTER TABLE result_subjects
  ADD CONSTRAINT result_subjects_belong_to_their_result
    FOREIGN KEY (result_id, auth_user_id)
    REFERENCES semester_results (id, auth_user_id)
    ON DELETE CASCADE;

COMMENT ON CONSTRAINT result_subjects_belong_to_their_result ON result_subjects IS
  'A subject row belongs to the same student as its result. Enforced by the database, not by application logic (M9.1 §3).';

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
--
-- `touch_row()` already exists (0001). It was simply never attached here,
-- which is the same omission as the missing columns.

CREATE TRIGGER result_subjects_touch
  BEFORE UPDATE ON result_subjects
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX result_subjects_changed ON result_subjects (auth_user_id, updated_at);
CREATE INDEX result_subjects_live    ON result_subjects (auth_user_id) WHERE deleted_at IS NULL;
