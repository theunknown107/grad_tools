-- ===========================================================================
-- 0011 — the catalogue can say "we have not checked"
-- ===========================================================================
--
-- Authority: docs/09 §9.21 · docs/32 OQ-052 · M10A.2 §4, §5
--
-- Forward-only. 0001 is released and is not edited.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
--
-- `subjects.has_see` was `NOT NULL DEFAULT true` and `subjects.credits` was
-- `NOT NULL`. A reference row therefore ALWAYS asserted both, whether or not
-- anybody had established them — so the catalogue had two states where the
-- world has three:
--
--     row exists   ->  an answer, verified or not
--     row absent   ->  no subject at all
--
-- and no way at all to say "this subject exists, and this property of it has
-- not been checked".
--
-- For `has_see` that is not a tidiness problem. An external mark of 0 is
-- equally consistent with "this course has no semester-end examination" and
-- "sat the SEE and scored nothing", the two have OPPOSITE outcomes, and no
-- arithmetic on the marks separates them (DEC-037). A defaulted `true` on a
-- course that is really CIE-only tells a student they have a backlog in a
-- subject the university passed them in. A default is not a fact, and this one
-- defaulted toward the dangerous answer.
--
-- ---------------------------------------------------------------------------
-- WHY THE VERIFICATION GATE WAS NOT ENOUGH ON ITS OWN
-- ---------------------------------------------------------------------------
--
-- Only `publication = 'published'` rows reach a client, and publication already
-- requires `verification = 'verified'`, so no defaulted value was visible to a
-- student. The hazard was latent rather than live.
--
-- But that safety depended on a reviewer noticing a field the schema had
-- already filled in. Verifying a subject's code, title and credits is a
-- different act from verifying whether it has a semester-end examination, and
-- a row-level flag cannot record that only the first was done. NULL can.
--
-- ---------------------------------------------------------------------------
-- THE THREE STATES, AFTER THIS
-- ---------------------------------------------------------------------------
--
--     has_see = true    an authoritative source says this course has a SEE
--     has_see = false   an authoritative source says it does not
--     has_see IS NULL   nobody has established it in this reference dataset
--
-- Publication is deliberately NOT made conditional on either column being
-- known. "This subject exists, its code and title and credits are verified,
-- and its SEE applicability is not established" is a legitimate and useful
-- state, and hiding such a subject entirely would be worse for a student than
-- showing it with one honest gap in it.

ALTER TABLE subjects
  ALTER COLUMN credits DROP NOT NULL,
  ALTER COLUMN has_see DROP NOT NULL,
  -- The default goes with the constraint. Left in place, an INSERT that simply
  -- omitted the column would go on asserting `true` — which is the whole of the
  -- defect, unchanged.
  ALTER COLUMN has_see DROP DEFAULT;

COMMENT ON COLUMN subjects.has_see IS
  'Whether this course has a semester-end examination. NULL means nobody has established it; it must never be read as false, and an external mark of 0 does not establish it either (DEC-037, OQ-052).';

COMMENT ON COLUMN subjects.credits IS
  'Credits from an authoritative source, or NULL where none has been established. NULL is not 0: a course carrying no weight and a course whose weight is unrecorded are different facts (OQ-052).';
