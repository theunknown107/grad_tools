-- 0002_hardening.sql
--
-- Authority: M4.1 §1, §3 · docs/08 §8.3 · docs/09 §9.4 · docs/14 §14.10
--
-- Forward-only. 0001 is not edited; these are corrections applied on top of it.
--
-- Two defects found by review after M5a shipped, both of the same kind: the
-- schema was able to state something it had not verified.

-- ---------------------------------------------------------------------------
-- 1. module_count must be able to say "unknown"
-- ---------------------------------------------------------------------------
--
-- 0001 declared `module_count smallint NOT NULL DEFAULT 5`. Every seeded
-- subject therefore claimed five modules while `syllabus_modules` held zero
-- rows, so the API published an unverified structural fact next to an empty
-- syllabus. Five is the 2022-scheme norm, not a verified property of any
-- particular subject, and a default is not evidence.
--
-- NULL now means "the syllabus structure has not been verified". It is
-- deliberately NOT 0: a hypothetical verified-zero-module course and an
-- unverified one are different facts, and collapsing them would repeat the
-- error being fixed here (docs/08 §8.3).
--
-- The CHECK is recreated so that a value, when present, is still 1-10. Dropping
-- NOT NULL alone would leave the column able to hold NULL but the constraint
-- unchanged; PostgreSQL already ignores NULL in a CHECK, so this is restated
-- only to keep the constraint's intent legible next to the nullable column.

ALTER TABLE subjects ALTER COLUMN module_count DROP NOT NULL;
ALTER TABLE subjects ALTER COLUMN module_count DROP DEFAULT;

-- Every currently published subject was seeded with the unverified default.
-- Reset them to unknown. This is narrow on purpose: it clears exactly the rows
-- that carry the default, and leaves any genuinely verified count alone.
UPDATE subjects
   SET module_count = NULL
 WHERE module_count = 5
   AND NOT EXISTS (
         SELECT 1 FROM syllabus_modules m WHERE m.subject_id = subjects.id
       );

COMMENT ON COLUMN subjects.module_count IS
  'Number of syllabus modules. NULL means the structure is not verified; it is not zero.';

-- ---------------------------------------------------------------------------
-- 2. Rule-set precedence must be decidable
-- ---------------------------------------------------------------------------
--
-- 0001 permits one active rule set per (scheme, college) pair, where a NULL
-- college means scheme-wide. That is correct, but it means a scheme can have
-- BOTH a scheme-wide active rule set and a college-specific one — which is the
-- intended design, and which made `... WHERE active LIMIT 1` nondeterministic:
-- it returned whichever row the planner happened to produce first.
--
-- The query now orders college-specific ahead of scheme-wide explicitly
-- (see queries.ts). This index exists so that ordering is served rather than
-- sorted, and so the lookup stays a single index scan as rule sets accumulate.

CREATE INDEX rule_sets_active_lookup
    ON rule_sets (scheme_id, college_id)
 WHERE active AND publication = 'published';

-- ---------------------------------------------------------------------------
-- 3. Subject lookup by code was never unique
-- ---------------------------------------------------------------------------
--
-- No schema change is needed: uniqueness is already (scheme_id, branch_id,
-- code), which is correct — the same code legitimately recurs across branches
-- and schemes. The defect was in the API, which looked a subject up by code
-- alone and took LIMIT 1. That is fixed by addressing subjects by their UUID
-- (M4.1 §2); this index supports the collection filter that replaces it.

CREATE INDEX subjects_published_lookup
    ON subjects (scheme_id, branch_id, semester)
 WHERE publication = 'published';

-- ---------------------------------------------------------------------------
-- 4. colleges was publishable without provenance
-- ---------------------------------------------------------------------------
--
-- Found while writing the rule-set precedence tests (M4.1 §3), which needed a
-- college row. `colleges` is a public reference table served by
-- GET /api/v1/colleges, but 0001 gave it no provenance, no verification state
-- and no publication state — it was filtered on `active` alone.
--
-- Two stated invariants did not hold for it:
--   * "every publishable reference record retains provenance" (docs/14 §14.10)
--   * "every reference query filters publication = 'published'" (M5a)
--
-- Nothing incorrect has ever been SERVED, because the table is empty. But the
-- schema permitted an unverified college to reach the public API the moment one
-- was inserted, which is precisely the defect being fixed for module_count
-- above. Backfill is a non-issue for the same reason: there are no rows.

ALTER TABLE colleges
  ADD COLUMN source_url    text,
  ADD COLUMN source_clause text,
  ADD COLUMN verification  verification_state NOT NULL DEFAULT 'draft',
  ADD COLUMN verified_at   timestamptz,
  ADD COLUMN verified_by   text,
  ADD COLUMN publication   publication_state NOT NULL DEFAULT 'unpublished';

ALTER TABLE colleges
  ADD CONSTRAINT colleges_source_url_check
    CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  -- The same central invariant every other publishable table carries: a record
  -- cannot be published unless it is verified and carries its provenance.
  ADD CONSTRAINT colleges_publish_requires_verification CHECK (
    publication = 'unpublished'
    OR (verification = 'verified' AND verified_at IS NOT NULL AND source_url IS NOT NULL)
  );
