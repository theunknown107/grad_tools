-- 0003_taxonomy_contract.sql
--
-- Authority: M4.2 · docs/08 §8.3 · docs/09 §9.4 · docs/14 §14.10
--
-- Forward-only. 0001 and 0002 are not edited.
--
-- THE QUESTION THIS MIGRATION ANSWERS
--
-- Review found that `universities` and `branches` have no verification or
-- publication controls, while `schemes`, `colleges`, `rule_sets`, `subjects`
-- and `syllabus_modules` do — and that `listUniversities()` filtered nothing at
-- all while `listBranches()` filtered `active`.
--
-- The inconsistency in the QUERIES was a real defect and is fixed here. The
-- absence of provenance COLUMNS is not: it is deliberate, and the specification
-- already said so. In one code block of docs/09 §9.4, `schemes`, `rule_sets`,
-- `subjects` and `syllabus_modules` each carry `source_url`, while
-- `universities` and `branches` carry none. That is a distinction drawn, not an
-- omission. docs/14 §14.10 scopes the provenance invariant to every published
-- EXTERNAL record, and neither of these is ingested from anywhere.
--
-- THE CLASSIFICATION TEST, stated so future entities are decided consistently:
--
--   Does the row make a checkable claim about the external world that can
--   change a calculation or mislead a student if wrong?
--
--   YES -> verified reference data. Needs provenance, verification and
--          publication gating. schemes, colleges, rule_sets, subjects,
--          syllabus_modules.
--
--   NO  -> internal taxonomy. The application owns the identifiers; the row
--          exists to give other tables something to join to. universities,
--          branches.
--
-- Applying the test:
--   * `universities` holds exactly one row, VTU, and exists "to make the model
--     honest about scope rather than to support multi-tenancy" (docs/08). It is
--     the product's scope anchor. "VTU is a university" is not a claim needing
--     a clause citation.
--   * `branches` rows are join keys the application chose (`cse`). The set of
--     branches in a scheme is a verified fact, but it is carried by `subjects`,
--     which does have provenance.
--   * `colleges` is on the other side of the line even though docs/09 grouped it
--     here: a college's name, affiliation and especially `is_autonomous` are
--     factual claims about a real institution, and `is_autonomous` decides
--     whether VTU's rules apply at all. Getting it wrong silently corrupts every
--     calculation for that college. 0002 gave it provenance for that reason.
--
-- Inventing a source URL for "VTU exists" in order to make the tables look
-- uniform would be fabricated provenance, which is worse than none (docs/14
-- §14.10, M4.2 §4).

-- ---------------------------------------------------------------------------
-- The taxonomy control is `active`, and universities lacked it
-- ---------------------------------------------------------------------------
--
-- Taxonomy rows are approved by being in the reviewed, committed seed; `active`
-- is how one is withdrawn without deleting rows that other tables reference.
-- `branches` had it and `universities` did not, which is why the two list
-- queries disagreed. They now have the same control and the same filter.

ALTER TABLE universities ADD COLUMN active boolean NOT NULL DEFAULT true;

COMMENT ON TABLE universities IS
  'Internal taxonomy, not externally verified reference data. Deliberately has no provenance or publication columns; `active` is the control. See migration 0003.';

COMMENT ON TABLE branches IS
  'Internal taxonomy, not externally verified reference data. Deliberately has no provenance or publication columns; `active` is the control. See migration 0003.';
