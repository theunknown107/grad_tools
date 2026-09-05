-- ===========================================================================
-- 0013 — the question-paper extraction tables, dropped
-- ===========================================================================
--
-- Authority: docs/31 §31.41 · M10A.13 §27, §42
--
-- Forward-only. Earlier migrations are released and are not edited; this one
-- removes what they created rather than rewriting history.
--
-- ---------------------------------------------------------------------------
-- WHY THESE SIX AND NOT THE OTHERS
-- ---------------------------------------------------------------------------
--
-- Question papers stopped being a product in M10A.9. The pages went in
-- M10A.10, the query surface in M10A.11, and the ingestion pipeline — the
-- router, `documents/`, `jobs/`, and seventeen query functions — in M10A.13.
-- These six tables are what is left with NO READER AT ALL: nothing in the
-- API, nothing in the web app, and nothing in any test now selects from them.
--
-- `documents` and `sources` are NOT dropped and are not dead. The reference
-- router still serves both as a public registry (`listPublicDocuments`,
-- `findPublicDocument`, `listSources`), `announcements.source_id` has a
-- foreign key into `sources`, and `gates.test.ts` proves the CHECK constraints
-- on both. Removing the readers of a table is what makes it droppable;
-- `documents` still has readers.
--
-- ---------------------------------------------------------------------------
-- ORDER, AND WHY NOT CASCADE
-- ---------------------------------------------------------------------------
--
-- Dropped children-first, in foreign-key order, WITHOUT `CASCADE`. Cascade
-- would silently take anything that had come to depend on these while nobody
-- was looking — which is the exact failure this project has already had once,
-- when a route deleted in M10A.11 kept a test asserting it returned 200 for
-- two milestones because the suite was not running. A dependency that exists
-- and is not listed here should raise an error, not disappear quietly.
--
-- A fresh database proves this: the suite drops and recreates `public` on
-- every run, so these tables are created by 0006-0010 and dropped again here
-- on every single test run.

DROP TABLE IF EXISTS extracted_sub_questions;
DROP TABLE IF EXISTS extracted_mcq_items;
DROP TABLE IF EXISTS extracted_questions;
DROP TABLE IF EXISTS extracted_papers;
DROP TABLE IF EXISTS document_sections;

-- The OCR job queue. Its only producer was the document router and its only
-- consumer the worker in `jobs/`, both removed in M10A.13.
DROP TABLE IF EXISTS jobs;
