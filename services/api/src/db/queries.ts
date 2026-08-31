/**
 * Reference-data queries.
 *
 * Authority: docs/10_API_SPECIFICATION.md §10.7, docs/14 §14.10
 *
 * TWO INVARIANTS, ENFORCED HERE AND IN THE DATABASE
 * -------------------------------------------------
 * 1. **Only published rows leave this module.** Every query filters
 *    `publication = 'published'`, and the database additionally forbids
 *    publishing an unverified row. Two independent layers, because publishing
 *    unverified academic data is the failure that would cost the most trust.
 *
 * 2. **Every row is validated against the SHARED contract before it is
 *    returned.** Not the ORM's idea of the schema — the exact Zod schema the
 *    web app parses. A column rename that breaks the contract fails a test
 *    here rather than reaching a student's screen.
 *
 * There are no student-data queries in this file, and none may be added while
 * Stage 1 holds (docs/33 §33.3).
 */

import {
  documentSchema,
  documentStatusSchema,
  type DocumentStatus,
  documentSectionSchema,
  type DocumentSection,
  extractedPaperSchema,
  type ExtractedPaper,
  extractedQuestionSchema,
  type ExtractedQuestion,
  extractedMcqItemSchema,
  type ExtractedMcqItem,
  reviewQueueItemSchema,
  type ReviewQueueItem,
  announcementSchema,
  type Announcement,
  questionPaperSchema,
  questionSearchResultSchema,
  type QuestionSearchResult,
  type QuestionPaper,
  questionPaperFiltersSchema,
  type QuestionPaperFilters,
  type AnnouncementCategory,
  sourceSchema,
  type DocumentRecord,
  type Source,
  branchSchema,
  collegeSchema,
  ruleSetMetaSchema,
  schemeSchema,
  subjectSchema,
  syllabusModuleSchema,
  universitySchema,
  type Branch,
  type College,
  type RuleSetMeta,
  type Scheme,
  type Subject,
  type SubjectQuery,
  type SyllabusModule,
  type University,
} from '@gradtools/shared-types';
import type { Sql } from './client.js';

/**
 * Parses rows through the shared contract.
 *
 * A failure here is a server fault, not a client one: it means the database
 * and the published contract have diverged. It throws so the error handler
 * returns a 500 with a reference id, rather than emitting a malformed payload
 * that the client would have to defend against.
 */
function parseRows<T>(schema: { parse: (value: unknown) => T }, rows: unknown[]): T[] {
  return rows.map((row) => schema.parse(row));
}

/* -------------------------------------------------------------------------- */
/* Universities                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Universities and branches are INTERNAL TAXONOMY, not verified reference data
 * (M4.2, migration 0003). They deliberately carry no provenance or publication
 * columns: neither makes a checkable claim about the world that could change a
 * calculation. Their control is `active`, and both queries apply it — this one
 * previously applied no filter at all, which is the defect M4.2 found.
 *
 * Everything else served from this module IS verified reference data and
 * filters `publication = 'published'`. Do not merge the two models.
 */
export async function listUniversities(sql: Sql): Promise<University[]> {
  const rows = await sql`
    SELECT id, name, short_name AS "shortName"
    FROM universities
    WHERE active
    ORDER BY name
  `;
  return parseRows(universitySchema, rows);
}

/* -------------------------------------------------------------------------- */
/* Schemes                                                                    */
/* -------------------------------------------------------------------------- */

const SCHEME_COLUMNS = (sql: Sql) => sql`
  id,
  university_id   AS "universityId",
  code,
  regulation_code AS "regulationCode",
  name,
  to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
  to_char(effective_to,   'YYYY-MM-DD') AS "effectiveTo",
  json_build_object(
    'sourceUrl',    source_url,
    'sourceClause', source_clause,
    'verifiedAt',   to_char(verified_at, 'YYYY-MM-DD'),
    'verifiedBy',   verified_by
  ) AS provenance
`;

export async function listSchemes(sql: Sql): Promise<Scheme[]> {
  const rows = await sql`
    SELECT ${SCHEME_COLUMNS(sql)}
    FROM schemes
    WHERE publication = 'published'
    ORDER BY effective_from DESC
  `;
  return parseRows(schemeSchema, rows);
}

export async function findScheme(sql: Sql, id: string): Promise<Scheme | null> {
  const rows = await sql`
    SELECT ${SCHEME_COLUMNS(sql)}
    FROM schemes
    WHERE publication = 'published' AND id = ${id}
    LIMIT 1
  `;
  const parsed = parseRows(schemeSchema, rows);
  return parsed[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Branches and colleges                                                      */
/* -------------------------------------------------------------------------- */

export async function listBranches(sql: Sql): Promise<Branch[]> {
  const rows = await sql`
    SELECT id, university_id AS "universityId", code, name
    FROM branches
    WHERE active
    ORDER BY name
  `;
  return parseRows(branchSchema, rows);
}

export async function listColleges(sql: Sql): Promise<College[]> {
  const rows = await sql`
    SELECT
      id::text,
      university_id AS "universityId",
      name,
      code,
      is_autonomous AS "isAutonomous",
      city
    FROM colleges
    WHERE publication = 'published' AND active
    ORDER BY name
  `;
  return parseRows(collegeSchema, rows);
}

/* -------------------------------------------------------------------------- */
/* Rule sets                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The ACTIVE rule set for a scheme.
 *
 * Returns metadata only. The client feeds nothing from here into a display
 * value directly: it calls @gradtools/academic-rules, which owns every
 * calculation (M5a §9).
 */
/*
 * Precedence, stated explicitly rather than left to the planner (M4.1 §3):
 *
 *   1. the requested college's active rule set, if one exists
 *   2. otherwise the scheme-wide active rule set
 *   3. otherwise nothing
 *
 * The ORDER BY does the work: "college_id IS NULL" is false for a
 * college-specific row, and false sorts before true, so the college's row wins.
 *
 * The previous query had no ORDER BY and took the first row the planner
 * produced. That was not a rule, it was a coin toss that happened to look
 * stable while exactly one rule set existed — and the schema deliberately
 * allows a scheme-wide set and a college override to coexist.
 */
export async function findActiveRuleSetForScheme(
  sql: Sql,
  schemeId: string,
  collegeId?: string,
): Promise<RuleSetMeta | null> {
  const rows = await sql`
    SELECT
      id::text,
      scheme_id  AS "schemeId",
      college_id::text AS "collegeId",
      version,
      active,
      to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
      to_char(effective_to,   'YYYY-MM-DD') AS "effectiveTo",
      json_build_object(
        'sgpa',       sgpa_formula_id,
        'cgpa',       cgpa_formula_id,
        'percentage', percentage_formula_id
      ) AS "formulaIds",
      json_build_object(
        'cieMax',                  cie_max::float8,
        'cieMinPct',               cie_min_pct::float8,
        'seeMax',                  see_max::float8,
        'seeMinPct',               see_min_pct::float8,
        'courseMax',               course_max::float8,
        'overallMinPct',           overall_min_pct::float8,
        'attendanceRequiredPct',   attendance_required_pct::float8,
        'attendanceCondonablePct', attendance_condonable_pct::float8,
        'attendanceDxFloorPct',    attendance_dx_floor_pct::float8
      ) AS thresholds,
      json_build_object(
        'sourceUrl',    source_url,
        'sourceClause', source_clause,
        'verifiedAt',   to_char(verified_at, 'YYYY-MM-DD'),
        'verifiedBy',   verified_by
      ) AS provenance
    FROM rule_sets
    WHERE publication = 'published'
      AND active
      AND scheme_id = ${schemeId}
      AND (
        college_id IS NULL
        ${collegeId === undefined ? sql`` : sql`OR college_id::text = ${collegeId}`}
      )
    -- Precedence: college-specific first, then scheme-wide. See above.
    ORDER BY (college_id IS NULL)
    LIMIT 1
  `;
  const parsed = parseRows(ruleSetMetaSchema, rows);
  return parsed[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Subjects and syllabus                                                      */
/* -------------------------------------------------------------------------- */

const SUBJECT_COLUMNS = (sql: Sql) => sql`
  id::text,
  scheme_id AS "schemeId",
  branch_id AS "branchId",
  semester,
  code,
  title,
  credits::float8,
  category,
  cie_max::float8      AS "cieMax",
  see_max::float8      AS "seeMax",
  has_see              AS "hasSee",
  module_count         AS "moduleCount",
  json_build_object(
    'sourceUrl',    source_url,
    'sourceClause', source_clause,
    'verifiedAt',   to_char(verified_at, 'YYYY-MM-DD'),
    'verifiedBy',   verified_by
  ) AS provenance
`;

/**
 * Subjects, optionally filtered.
 *
 * Filters are an explicit allowlist of three parameters rather than arbitrary
 * field filtering, which would be both an injection and a performance surface
 * (docs/10 §10.4).
 */
export async function listSubjects(sql: Sql, query: SubjectQuery): Promise<Subject[]> {
  const rows = await sql`
    SELECT ${SUBJECT_COLUMNS(sql)}
    FROM subjects
    WHERE publication = 'published'
      ${query.scheme === undefined ? sql`` : sql`AND scheme_id = ${query.scheme}`}
      ${query.branch === undefined ? sql`` : sql`AND branch_id = ${query.branch}`}
      ${query.semester === undefined ? sql`` : sql`AND semester = ${query.semester}`}
    ORDER BY semester, code
  `;
  return parseRows(subjectSchema, rows);
}

/**
 * A subject by its UUID.
 *
 * Not by code: uniqueness is `(scheme_id, branch_id, code)`, so a code alone
 * identifies a set, not a row. Looking up by code required `LIMIT 1`, which
 * silently returned one of several matches once a second branch or scheme was
 * seeded (M4.1 §2). Callers holding a code use `listSubjects` instead.
 */
export async function findSubjectById(sql: Sql, id: string): Promise<Subject | null> {
  const rows = await sql`
    SELECT ${SUBJECT_COLUMNS(sql)}
    FROM subjects
    WHERE publication = 'published' AND id = ${id}::uuid
  `;
  const parsed = parseRows(subjectSchema, rows);
  return parsed[0] ?? null;
}

export async function listSyllabusModules(sql: Sql, subjectId: string): Promise<SyllabusModule[]> {
  const rows = await sql`
    SELECT
      m.id::text,
      m.subject_id::text AS "subjectId",
      m.module_number    AS "moduleNumber",
      m.title,
      m.topics,
      m.hours,
      json_build_object(
        'sourceUrl',    m.source_url,
        'sourceClause', m.source_clause,
        'verifiedAt',   to_char(m.verified_at, 'YYYY-MM-DD'),
        'verifiedBy',   m.verified_by
      ) AS provenance
    FROM syllabus_modules m
    JOIN subjects s ON s.id = m.subject_id
    WHERE m.publication = 'published'
      AND s.publication = 'published'
      AND s.id = ${subjectId}::uuid
    ORDER BY m.module_number
  `;
  return parseRows(syllabusModuleSchema, rows);
}

/* -------------------------------------------------------------------------- */
/* Sources and documents (M5)                                                 */
/* -------------------------------------------------------------------------- */

const SOURCE_COLUMNS = (sql: Sql) => sql`
  id,
  kind,
  publisher,
  canonical_url AS "canonicalUrl",
  authority,
  access_method AS "accessMethod",
  robots_status AS "robotsStatus",
  to_char(robots_checked_at, 'YYYY-MM-DD') AS "robotsCheckedAt",
  robots_note AS "robotsNote",
  terms_status AS "termsStatus",
  to_char(terms_reviewed_at, 'YYYY-MM-DD') AS "termsReviewedAt",
  terms_note AS "termsNote",
  rights_status AS "rightsStatus",
  verification,
  to_char(verified_at, 'YYYY-MM-DD') AS "verifiedAt",
  enabled,
  health,
  consecutive_failures AS "consecutiveFailures",
  to_char(last_checked_at, 'YYYY-MM-DD') AS "lastCheckedAt",
  parser_version AS "parserVersion",
  poll_interval_seconds AS "pollIntervalSeconds",
  notes
`;

/**
 * The source registry is public on purpose.
 *
 * Publishing what GradTools reads, whether it is allowed to, and whether it is
 * switched on is a trust feature: a student or a college can check the claim
 * rather than take it on faith (docs/14 §14.7.1).
 */
export async function listSources(sql: Sql): Promise<Source[]> {
  const rows = await sql`
    SELECT ${SOURCE_COLUMNS(sql)} FROM sources ORDER BY id
  `;
  return parseRows(sourceSchema, rows);
}

export async function findSource(sql: Sql, id: string): Promise<Source | null> {
  const rows = await sql`
    SELECT ${SOURCE_COLUMNS(sql)} FROM sources WHERE id = ${id}
  `;
  return parseRows(sourceSchema, rows)[0] ?? null;
}

const DOCUMENT_COLUMNS = (sql: Sql) => sql`
  id::text,
  source_id AS "sourceId",
  title,
  sha256,
  byte_size::int AS "byteSize",
  mime_type AS "mimeType",
  page_count AS "pageCount",
  state,
  extraction_status AS "extractionStatus",
  rights_status AS "rightsStatus",
  presentation,
  source_url AS "sourceUrl",
  license_note AS "licenseNote",
  rejection_reason AS "rejectionReason",
  to_char(created_at, 'YYYY-MM-DD') AS "createdAt",
  paper_format       AS "paperFormat",
  ocr_engine         AS "ocrEngine",
  ocr_engine_version AS "ocrEngineVersion",
  ocr_languages      AS "ocrLanguages",
  ocr_psm            AS "ocrPsm",
  ocr_dpi            AS "ocrDpi",
  ocr_duration_ms    AS "ocrDurationMs",
  ocr_char_count     AS "ocrCharCount",
  needs_review       AS "needsReview",
  review_reason      AS "reviewReason"
`;

/**
 * The two conditions a document must meet to be visible publicly.
 *
 * They are independent, and both are required (M5.1 §2):
 *
 *   presentation  RIGHTS   — may we show it at all
 *   state         SAFETY   — has it passed validation
 *
 * Having permission to show a document says nothing about whether it is safe
 * to show. A `quarantined` document has not had its bytes checked yet, so it
 * stays invisible however generous its rights are.
 *
 * Expressed once and shared by both read paths, so the list and the by-id
 * lookup cannot drift apart — the by-id path is exactly where such a filter
 * gets forgotten. The database enforces the same rule independently
 * (`document_public_requires_validation`, migration 0005).
 */
const PUBLICLY_VISIBLE = (sql: Sql) => sql`
  presentation IN ('host', 'link')
  AND state IN ('validated', 'extracted')
`;

/**
 * Documents the public may see.
 *
 * `private` and `blocked` are excluded at the query rather than filtered later:
 * a student's own upload has no business appearing in a public listing, and the
 * safest place for that rule is the one every caller goes through.
 *
 * Note this returns METADATA. Serving the file itself is a separate,
 * rights-gated concern, and no route serves one (M5 §17).
 */
export async function listPublicDocuments(sql: Sql): Promise<DocumentRecord[]> {
  const rows = await sql`
    SELECT ${DOCUMENT_COLUMNS(sql)}
    FROM documents
    WHERE ${PUBLICLY_VISIBLE(sql)}
    ORDER BY created_at DESC, id
  `;
  return parseRows(documentSchema, rows);
}

export async function findPublicDocument(sql: Sql, id: string): Promise<DocumentRecord | null> {
  const rows = await sql`
    SELECT ${DOCUMENT_COLUMNS(sql)}
    FROM documents
    WHERE id = ${id}::uuid AND ${PUBLICLY_VISIBLE(sql)}
  `;
  return parseRows(documentSchema, rows)[0] ?? null;
}

/** Last seen payload hash per item, which is what change detection diffs against. */
export async function lastSeenHashes(sql: Sql, sourceId: string): Promise<Map<string, string>> {
  const rows = await sql<{ external_id: string; payload_hash: string }[]>`
    SELECT DISTINCT ON (external_id) external_id, payload_hash
    FROM source_changes
    WHERE source_id = ${sourceId} AND change_type <> 'removed'
    ORDER BY external_id, detected_at DESC
  `;
  return new Map(rows.map((row) => [row.external_id, row.payload_hash]));
}

/**
 * The operator's own private working set.
 *
 * Deliberately a SEPARATE function from `listPublicDocuments` rather than a
 * parameter on it. A single query whose visibility depends on an argument is
 * the shape that eventually leaks: one caller forgets the argument and private
 * documents appear in a public response. Two functions cannot make that
 * mistake.
 *
 * Stage 1 has no accounts, so "private" means "on this machine, belonging to
 * whoever runs it". When identity arrives this gains an owner predicate; until
 * then it is not reachable from any public route.
 */
export async function listPrivateDocuments(sql: Sql): Promise<DocumentRecord[]> {
  const rows = await sql`
    SELECT ${DOCUMENT_COLUMNS(sql)}
    FROM documents
    WHERE presentation = 'private'
    ORDER BY created_at DESC, id
  `;
  return parseRows(documentSchema, rows);
}

/** Any document by id, public or not. For the private working set only. */
export async function findDocument(sql: Sql, id: string): Promise<DocumentRecord | null> {
  const rows = await sql`
    SELECT ${DOCUMENT_COLUMNS(sql)} FROM documents WHERE id = ${id}::uuid
  `;
  return parseRows(documentSchema, rows)[0] ?? null;
}

export async function listDocumentSections(sql: Sql, id: string): Promise<DocumentSection[]> {
  const rows = await sql`
    SELECT
      id::text,
      document_id::text  AS "documentId",
      page_number        AS "pageNumber",
      ordinal,
      content,
      extractor_version  AS "extractorVersion"
    FROM document_sections
    WHERE document_id = ${id}::uuid
    ORDER BY page_number, ordinal
  `;
  return parseRows(documentSectionSchema, rows);
}

/**
 * Everything a client needs to render progress, in one query.
 *
 * The job is LEFT JOINed rather than fetched separately: a document with no
 * active job is the normal case, and two round trips to say "nothing is
 * happening" would be wasteful on a polled endpoint.
 */
export async function findDocumentStatus(sql: Sql, id: string): Promise<DocumentStatus | null> {
  const rows = await sql`
    SELECT
      d.id::text,
      d.state,
      d.extraction_status AS "extractionStatus",
      d.paper_format      AS "paperFormat",
      d.needs_review      AS "needsReview",
      d.review_reason     AS "reviewReason",
      (SELECT count(*)::int FROM document_sections s WHERE s.document_id = d.id)
        AS "sectionCount",
      CASE WHEN j.id IS NULL THEN NULL ELSE
        json_build_object(
          'status', j.status,
          'attempts', j.attempts,
          'maxAttempts', j.max_attempts
        )
      END AS job
    FROM documents d
    LEFT JOIN LATERAL (
      SELECT id, status, attempts, max_attempts
      FROM jobs
      WHERE document_id = d.id AND job_type = 'ocr'
      ORDER BY created_at DESC
      LIMIT 1
    ) j ON true
    WHERE d.id = ${id}::uuid
  `;
  return parseRows(documentStatusSchema, rows)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Extracted question structure (M5A.5)                                       */
/* -------------------------------------------------------------------------- */

/**
 * A paper, with its two summaries computed in the database.
 *
 * The counts are aggregated here rather than by loading every question and
 * counting in JavaScript: the paper header is rendered without the questions,
 * and shipping a hundred rows to produce four numbers would be waste on the
 * one query a reviewer opens most.
 *
 * `reviewSummary` counts HUMAN states and `confidenceSummary` counts MACHINE
 * ones. They are separate objects because they are separate questions, and a
 * single blended "quality" number would let one silently stand for the other
 * (M5A.5 §7).
 */
const PAPER_SELECT = (sql: Sql) => sql`
  p.id::text,
  p.document_id::text     AS "documentId",
  p.paper_format          AS "paperFormat",
  p.extraction_source     AS "extractionSource",
  p.parser_version        AS "parserVersion",
  p.extraction_version    AS "extractionVersion",
  p.is_current            AS "isCurrent",
  p.page_count            AS "pageCount",
  p.question_count        AS "questionCount",
  p.mcq_item_count        AS "mcqItemCount",
  p.needs_review          AS "needsReview",
  p.review_reason         AS "reviewReason",
  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "createdAt",
  (
    SELECT json_build_object(
      'total',      count(*)::int,
      'unreviewed', count(*) FILTER (WHERE r.review_state = 'unreviewed')::int,
      'accepted',   count(*) FILTER (WHERE r.review_state = 'accepted')::int,
      'corrected',  count(*) FILTER (WHERE r.review_state = 'corrected')::int,
      'rejected',   count(*) FILTER (WHERE r.review_state = 'rejected')::int,
      'needsReview', count(*) FILTER (WHERE r.needs_review)::int
    )
    FROM (
      SELECT review_state, needs_review FROM extracted_questions WHERE paper_id = p.id
      UNION ALL
      SELECT review_state, needs_review FROM extracted_mcq_items  WHERE paper_id = p.id
    ) r
  ) AS "reviewSummary",
  (
    SELECT json_build_object(
      'high',           count(*) FILTER (WHERE c.confidence = 'high')::int,
      'medium',         count(*) FILTER (WHERE c.confidence = 'medium')::int,
      'low',            count(*) FILTER (WHERE c.confidence = 'low')::int,
      'reviewRequired', count(*) FILTER (WHERE c.confidence = 'review_required')::int
    )
    FROM (
      SELECT confidence FROM extracted_questions WHERE paper_id = p.id
      UNION ALL
      SELECT confidence FROM extracted_mcq_items WHERE paper_id = p.id
    ) c
  ) AS "confidenceSummary"
`;

/** The run a reader should be shown, or null when nothing has been extracted. */
export async function findCurrentPaper(
  sql: Sql,
  documentId: string,
): Promise<ExtractedPaper | null> {
  const rows = await sql`
    SELECT ${PAPER_SELECT(sql)}
      FROM extracted_papers p
     WHERE p.document_id = ${documentId}::uuid AND p.is_current
  `;
  return parseRows(extractedPaperSchema, rows)[0] ?? null;
}

/** Every run over a document, newest first. Superseded runs are kept, not dropped. */
export async function listPapersForDocument(
  sql: Sql,
  documentId: string,
): Promise<ExtractedPaper[]> {
  const rows = await sql`
    SELECT ${PAPER_SELECT(sql)}
      FROM extracted_papers p
     WHERE p.document_id = ${documentId}::uuid
     ORDER BY p.extraction_version DESC
  `;
  return parseRows(extractedPaperSchema, rows);
}

export async function findPaper(sql: Sql, id: string): Promise<ExtractedPaper | null> {
  const rows = await sql`
    SELECT ${PAPER_SELECT(sql)} FROM extracted_papers p WHERE p.id = ${id}::uuid
  `;
  return parseRows(extractedPaperSchema, rows)[0] ?? null;
}

/**
 * The MACHINE values at the top level, a person's corrections in `reviewed`.
 *
 * Both are served, never one merged over the other (M5A.5 §9). A client that
 * wants the effective value writes `reviewed?.marks ?? marks`; a client
 * auditing the extraction can still see exactly what the parser produced.
 *
 * `reviewed` is null unless a correction exists, so "nobody changed anything"
 * is distinguishable from "somebody set it back to the same value".
 */
const QUESTION_SELECT = (sql: Sql) => sql`
  q.id::text,
  q.paper_id::text      AS "paperId",
  q.ordinal,
  q.question_number     AS "questionNumber",
  q.module,
  q.question_text       AS "text",
  q.marks,
  q.bloom_level         AS "bloomLevel",
  q.course_outcome      AS "courseOutcome",
  q.page_number         AS "pageNumber",
  json_build_object(
    'x', q.bbox_x, 'y', q.bbox_y, 'width', q.bbox_width, 'height', q.bbox_height
  ) AS "boundingBox",
  q.confidence,
  q.needs_review        AS "needsReview",
  q.review_state        AS "reviewState",
  CASE WHEN COALESCE(
         q.reviewed_question_number, q.reviewed_module, q.reviewed_question_text,
         q.reviewed_marks::text, q.reviewed_bloom_level, q.reviewed_course_outcome
       ) IS NULL THEN NULL
       ELSE json_build_object(
         'questionNumber', q.reviewed_question_number,
         'module',         q.reviewed_module,
         'text',           q.reviewed_question_text,
         'marks',          q.reviewed_marks,
         'bloomLevel',     q.reviewed_bloom_level,
         'courseOutcome',  q.reviewed_course_outcome
       )
  END AS "reviewed",
  q.review_note   AS "reviewNote",
  to_char(q.reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "reviewedAt",
  q.reviewed_by   AS "reviewedBy",
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', sq.id::text,
        'questionId', sq.question_id::text,
        'ordinal', sq.ordinal,
        'label', sq.label,
        'text', sq.sub_text,
        'marks', sq.marks,
        'bloomLevel', sq.bloom_level,
        'courseOutcome', sq.course_outcome,
        'pageNumber', sq.page_number,
        'boundingBox', json_build_object(
          'x', sq.bbox_x, 'y', sq.bbox_y, 'width', sq.bbox_width, 'height', sq.bbox_height
        ),
        'confidence', sq.confidence,
        'needsReview', sq.needs_review,
        'reviewState', sq.review_state,
        'reviewed', CASE WHEN COALESCE(
                      sq.reviewed_label, sq.reviewed_sub_text, sq.reviewed_marks::text,
                      sq.reviewed_bloom_level, sq.reviewed_course_outcome
                    ) IS NULL THEN NULL
                    ELSE json_build_object(
                      'label', sq.reviewed_label,
                      'text',  sq.reviewed_sub_text,
                      'marks', sq.reviewed_marks,
                      'bloomLevel', sq.reviewed_bloom_level,
                      'courseOutcome', sq.reviewed_course_outcome
                    )
                    END,
        'reviewNote', sq.review_note,
        'reviewedAt', to_char(sq.reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
        'reviewedBy', sq.reviewed_by
      ) ORDER BY sq.ordinal
    )
    FROM extracted_sub_questions sq WHERE sq.question_id = q.id
  ), '[]'::json) AS "subQuestions"
`;

export async function listPaperQuestions(sql: Sql, paperId: string): Promise<ExtractedQuestion[]> {
  const rows = await sql`
    SELECT ${QUESTION_SELECT(sql)}
      FROM extracted_questions q
     WHERE q.paper_id = ${paperId}::uuid
     ORDER BY q.ordinal
  `;
  return parseRows(extractedQuestionSchema, rows);
}

export async function findQuestion(sql: Sql, id: string): Promise<ExtractedQuestion | null> {
  const rows = await sql`
    SELECT ${QUESTION_SELECT(sql)} FROM extracted_questions q WHERE q.id = ${id}::uuid
  `;
  return parseRows(extractedQuestionSchema, rows)[0] ?? null;
}

/**
 * MCQ items. A separate query because they are a separate shape: no module, no
 * Bloom's level, no CO, no marks, because the format never had them
 * (M5A.5 §13).
 */
export async function listPaperMcqItems(sql: Sql, paperId: string): Promise<ExtractedMcqItem[]> {
  const rows = await sql`
    SELECT
      m.id::text,
      m.paper_id::text  AS "paperId",
      m.ordinal,
      m.item_number     AS "itemNumber",
      m.item_text       AS "text",
      m.options,
      m.page_number     AS "pageNumber",
      json_build_object(
        'x', m.bbox_x, 'y', m.bbox_y, 'width', m.bbox_width, 'height', m.bbox_height
      ) AS "boundingBox",
      m.confidence,
      m.needs_review    AS "needsReview",
      m.review_state    AS "reviewState",
      CASE WHEN COALESCE(
             m.reviewed_item_number::text, m.reviewed_item_text, m.reviewed_options::text
           ) IS NULL THEN NULL
           ELSE json_build_object(
             'itemNumber', m.reviewed_item_number,
             'text',       m.reviewed_item_text,
             'options',    m.reviewed_options
           )
      END AS "reviewed",
      m.review_note  AS "reviewNote",
      to_char(m.reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "reviewedAt",
      m.reviewed_by  AS "reviewedBy"
    FROM extracted_mcq_items m
    WHERE m.paper_id = ${paperId}::uuid
    ORDER BY m.ordinal
  `;
  return parseRows(extractedMcqItemSchema, rows);
}

/**
 * Everything still waiting for a person, worst first.
 *
 * ORDER: review_required -> low -> medium -> high, then paper and position, so
 * a reviewer works down a page rather than jumping between documents.
 *
 * NOT A SCORE (M5A.6 §7). `review_priority` is an ordering. A number would have
 * to be invented, would imply a precision nothing here has, and would blend two
 * incomparable things — how much the geometry agreed, and how much work a
 * record needs — into one misleading figure (docs/32 ED-46).
 *
 * One UNION over three differently-shaped tables, because a reviewer works
 * through RECORDS: three lists would make "what is left?" three questions.
 * Rejected and accepted rows are absent by definition — the queue is what
 * nobody has looked at yet, not an archive.
 */
export async function listReviewQueue(sql: Sql, limit = 50): Promise<ReviewQueueItem[]> {
  const rows = await sql`
    WITH pending AS (
      SELECT
        'question'::text AS kind, q.id, q.paper_id, q.ordinal,
        COALESCE('Q' || q.question_number, 'Unnumbered') AS label,
        q.question_text AS text, q.page_number, q.confidence, q.needs_review,
        q.ordinal AS sort_a, 0 AS sort_b
      FROM extracted_questions q
      WHERE q.review_state = 'unreviewed'

      UNION ALL

      SELECT
        'sub-question', sq.id, q.paper_id, sq.ordinal,
        COALESCE('Q' || q.question_number, 'Q?') || ' ' || COALESCE(sq.label, '?'),
        sq.sub_text, sq.page_number, sq.confidence, sq.needs_review,
        q.ordinal, sq.ordinal + 1
      FROM extracted_sub_questions sq
      JOIN extracted_questions q ON q.id = sq.question_id
      WHERE sq.review_state = 'unreviewed'

      UNION ALL

      SELECT
        'mcq-item', m.id, m.paper_id, m.ordinal,
        'Item ' || COALESCE(m.item_number::text, '?'),
        m.item_text, m.page_number, m.confidence, m.needs_review,
        m.ordinal, 0
      FROM extracted_mcq_items m
      WHERE m.review_state = 'unreviewed'
    )
    SELECT
      p.kind,
      p.id::text,
      p.paper_id::text     AS "paperId",
      ep.document_id::text AS "documentId",
      d.title              AS "documentTitle",
      ep.paper_format      AS "paperFormat",
      ep.extraction_source AS "extractionSource",
      p.label,
      p.text,
      p.page_number        AS "pageNumber",
      p.confidence,
      p.needs_review       AS "needsReview"
    FROM pending p
    JOIN extracted_papers ep ON ep.id = p.paper_id
    JOIN documents d ON d.id = ep.document_id
    -- Only the run a reader is actually shown. A superseded run's rows are kept
    -- for audit; queueing them would ask a person to review history.
    WHERE ep.is_current
    ORDER BY review_priority(p.confidence), d.title, p.sort_a, p.sort_b
    LIMIT ${limit}
  `;
  return parseRows(reviewQueueItemSchema, rows);
}

/* -------------------------------------------------------------------------- */
/* Announcements (M7)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * THE PUBLICATION GATE, IN THE QUERY AS WELL AS THE SCHEMA.
 *
 * The database refuses to mark anything published without verification, and
 * this refuses to read anything that is not published. Two independent reasons
 * an unvalidated notice cannot reach a student, and neither depends on the
 * other being right (M7 §11).
 *
 * Neither state is SELECTed: everything returned has already passed, and
 * shipping the field would invite a client to decide for itself.
 */
const PUBLISHED_ANNOUNCEMENT = (sql: Sql) => sql`
  a.publication = 'published' AND a.verification = 'verified'
`;

const ANNOUNCEMENT_COLUMNS = (sql: Sql) => sql`
  a.id::text,
  a.source_id     AS "sourceId",
  a.origin,
  a.publisher,
  a.title,
  a.body,
  a.category,
  a.canonical_url AS "canonicalUrl",
  to_char(a.published_at,   'YYYY-MM-DD"T"HH24:MI:SSOF') AS "publishedAt",
  to_char(a.event_start_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "eventStartAt",
  to_char(a.deadline_at,    'YYYY-MM-DD"T"HH24:MI:SSOF') AS "deadlineAt",
  json_build_object(
    'schemeId',    a.scheme_id,
    'branchId',    a.branch_id,
    'branchName',  a.branch_name,
    'collegeId',   a.college_id::text,
    'collegeName', a.college_name,
    'semester',    a.semester
  ) AS audience,
  to_char(a.first_seen_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "firstSeenAt",
  to_char(a.last_seen_at,  'YYYY-MM-DD"T"HH24:MI:SSOF') AS "lastSeenAt",
  to_char(a.updated_at,    'YYYY-MM-DD"T"HH24:MI:SSOF') AS "updatedAt"
`;

export interface AnnouncementQuery {
  readonly category?: AnnouncementCategory | undefined;
  readonly sourceId?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

/**
 * The student feed: published notices, newest first.
 *
 * NO STUDENT CONTEXT IS ACCEPTED (M7 §13, §40). There is no branch, semester or
 * profile parameter, because relevance is computed in the browser from data
 * that never leaves the device. This endpoint cannot personalise, which is what
 * makes it impossible for it to learn anything about who is asking.
 */
export async function listPublishedAnnouncements(
  sql: Sql,
  query: AnnouncementQuery,
): Promise<{ items: Announcement[]; total: number }> {
  const categoryFilter =
    query.category === undefined ? sql`` : sql`AND a.category = ${query.category}`;
  const sourceFilter =
    query.sourceId === undefined ? sql`` : sql`AND a.source_id = ${query.sourceId}`;

  const rows = await sql`
    SELECT ${ANNOUNCEMENT_COLUMNS(sql)}
      FROM announcements a
     WHERE ${PUBLISHED_ANNOUNCEMENT(sql)} ${categoryFilter} ${sourceFilter}
     ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC
     LIMIT ${query.limit} OFFSET ${query.offset}
  `;

  const [counted] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total
      FROM announcements a
     WHERE ${PUBLISHED_ANNOUNCEMENT(sql)} ${categoryFilter} ${sourceFilter}
  `;

  return { items: parseRows(announcementSchema, rows), total: counted?.total ?? 0 };
}

/** One published announcement. Unpublished ids are not found, not forbidden. */
export async function findPublishedAnnouncement(
  sql: Sql,
  id: string,
): Promise<Announcement | null> {
  const rows = await sql`
    SELECT ${ANNOUNCEMENT_COLUMNS(sql)}
      FROM announcements a
     WHERE a.id = ${id}::uuid AND ${PUBLISHED_ANNOUNCEMENT(sql)}
  `;
  return parseRows(announcementSchema, rows)[0] ?? null;
}

/**
 * Which sources actually have published notices.
 *
 * The filter list is built from this rather than from the source registry, so a
 * student is never offered a filter that returns nothing (M7 §24).
 */
export async function listAnnouncementFilters(sql: Sql): Promise<{
  categories: { value: string; count: number }[];
  sources: { value: string; label: string; count: number }[];
}> {
  const categories = await sql<{ value: string; count: number }[]>`
    SELECT a.category AS value, count(*)::int AS count
      FROM announcements a
     WHERE ${PUBLISHED_ANNOUNCEMENT(sql)}
     GROUP BY a.category
     ORDER BY count DESC, value
  `;
  const sources = await sql<{ value: string; label: string; count: number }[]>`
    SELECT COALESCE(a.source_id, 'operator') AS value,
           COALESCE(s.publisher, 'Entered by an operator') AS label,
           count(*)::int AS count
      FROM announcements a
      LEFT JOIN sources s ON s.id = a.source_id
     WHERE ${PUBLISHED_ANNOUNCEMENT(sql)}
     GROUP BY COALESCE(a.source_id, 'operator'), COALESCE(s.publisher, 'Entered by an operator')
     ORDER BY count DESC, label
  `;
  return { categories: [...categories], sources: [...sources] };
}

/* -------------------------------------------------------------------------- */
/* The question-paper library (M8)                                            */
/* -------------------------------------------------------------------------- */

/**
 * A library row.
 *
 * ONE JOIN, ASSEMBLED ONCE. The taxonomy has two possible homes — the subject
 * catalogue, or the loose columns for a paper whose subject nobody has
 * transcribed (docs/09 §9.17) — and `COALESCE` picks between them here so that
 * no caller has to know there were ever two.
 *
 * `extracted_papers` is joined on `is_current` only: superseded parser runs
 * stay queryable for audit, and a student should see the run a reader is meant
 * to be shown, not the history.
 */
const PAPER_COLUMNS = (sql: Sql) => sql`
  d.id::text,
  d.title,
  d.subject_id::text                      AS "subjectId",
  COALESCE(s.code, d.subject_code)        AS "subjectCode",
  s.title                                 AS "subjectTitle",
  COALESCE(s.scheme_id, d.scheme_id)      AS "schemeId",
  COALESCE(s.branch_id, d.branch_id)      AS "branchId",
  b.name                                  AS "branchName",
  COALESCE(s.semester, d.semester)::int   AS "semester",
  d.exam_year::int                        AS "examYear",
  d.exam_session                          AS "examSession",
  d.paper_format                          AS "paperFormat",
  d.page_count                            AS "pageCount",
  d.source_id                             AS "sourceId",
  src.publisher                           AS "sourceName",
  d.source_url                            AS "sourceUrl",
  d.presentation                          AS "availability",
  d.rights_status                         AS "rightsStatus",
  ep.question_count                       AS "questionCount",
  ep.mcq_item_count                       AS "mcqItemCount",
  ep.extraction_source                    AS "extractionSource",
  ep.parser_version                       AS "parserVersion",
  ep.needs_review                         AS "needsReview",
  to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "addedAt"
`;

const PAPER_JOINS = (sql: Sql) => sql`
  FROM documents d
  LEFT JOIN subjects s          ON s.id = d.subject_id
  LEFT JOIN branches b          ON b.id = COALESCE(s.branch_id, d.branch_id)
  LEFT JOIN sources  src        ON src.id = d.source_id
  LEFT JOIN extracted_papers ep ON ep.document_id = d.id AND ep.is_current
`;

/**
 * Which papers a student may see.
 *
 * THE SAME TWO CONDITIONS AS `PUBLICLY_VISIBLE`, and deliberately no others
 * (M8 §29): rights say whether we may show it, state says whether it is safe
 * to show, and `private` and `blocked` fail the first. The only addition is
 * the kind — a syllabus PDF is publicly visible and is not a question paper.
 */
const LIBRARY_VISIBLE = (sql: Sql) => sql`
  d.document_kind = 'question_paper'
  AND d.presentation IN ('host', 'link')
  AND d.state IN ('validated', 'extracted')
`;

export interface PaperFilter {
  readonly subjectCode?: string | undefined;
  readonly schemeId?: string | undefined;
  readonly branchId?: string | undefined;
  readonly semester?: number | undefined;
  readonly year?: number | undefined;
  readonly format?: string | undefined;
  readonly sourceId?: string | undefined;
  readonly search?: string | undefined;
  readonly sort?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

/**
 * The library listing.
 *
 * SEARCH IS DETERMINISTIC AND LEXICAL (M8 §9, §46). A case-insensitive
 * substring match over the subject code, the subject title, the paper title and
 * the sitting — nothing is ranked, embedded, expanded or interpreted. A student
 * who types `BCS403` gets the papers whose code contains `BCS403`, and can
 * predict that before pressing the key, which is the property that makes a
 * search box usable for finding one specific paper.
 *
 * `%` and `_` in the input are escaped, so a search for `100%` is a search for
 * `100%` rather than a scan of the whole library.
 */
export async function listQuestionPapers(
  sql: Sql,
  filter: PaperFilter,
): Promise<{ items: QuestionPaper[]; total: number }> {
  const search =
    filter.search === undefined || filter.search.trim() === ''
      ? null
      : `%${filter.search.trim().replace(/[\\%_]/g, '\\$&')}%`;

  const where = sql`
    WHERE ${LIBRARY_VISIBLE(sql)}
      AND (${filter.subjectCode ?? null}::text IS NULL
           OR COALESCE(s.code, d.subject_code) = ${filter.subjectCode ?? null})
      AND (${filter.schemeId ?? null}::text IS NULL
           OR COALESCE(s.scheme_id, d.scheme_id) = ${filter.schemeId ?? null})
      AND (${filter.branchId ?? null}::text IS NULL
           OR COALESCE(s.branch_id, d.branch_id) = ${filter.branchId ?? null})
      AND (${filter.semester ?? null}::int IS NULL
           OR COALESCE(s.semester, d.semester) = ${filter.semester ?? null})
      AND (${filter.year ?? null}::int IS NULL OR d.exam_year = ${filter.year ?? null})
      AND (${filter.format ?? null}::text IS NULL
           OR d.paper_format = ${filter.format ?? null}::paper_format)
      AND (${filter.sourceId ?? null}::text IS NULL OR d.source_id = ${filter.sourceId ?? null})
      AND (${search}::text IS NULL
           OR COALESCE(s.code, d.subject_code) ILIKE ${search} ESCAPE '\\'
           OR s.title ILIKE ${search} ESCAPE '\\'
           OR d.title ILIKE ${search} ESCAPE '\\'
           OR d.exam_session ILIKE ${search} ESCAPE '\\'
           OR d.exam_year::text ILIKE ${search} ESCAPE '\\')
  `;

  /*
   * Ordering.
   *
   * NULL YEARS SORT LAST in every mode, `oldest` included. A paper with no
   * stated year is not the oldest paper — it is a paper whose year nobody
   * knows, and heading a year-ordered list with it would present absent
   * information as an extreme value (M8 §11).
   */
  const order =
    filter.sort === 'oldest'
      ? sql`ORDER BY d.exam_year ASC NULLS LAST, d.created_at ASC, d.id`
      : filter.sort === 'recently_added'
        ? sql`ORDER BY d.created_at DESC, d.id`
        : sql`ORDER BY d.exam_year DESC NULLS LAST, d.created_at DESC, d.id`;

  const rows = await sql`
    SELECT ${PAPER_COLUMNS(sql)} ${PAPER_JOINS(sql)} ${where}
    ${order}
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `;

  const [count] = await sql<{ total: string }[]>`
    SELECT count(*)::text AS total ${PAPER_JOINS(sql)} ${where}
  `;

  return {
    items: parseRows(questionPaperSchema, rows),
    total: Number(count?.total ?? 0),
  };
}

/**
 * One paper, by opaque id.
 *
 * The same visibility rule as the listing, applied in the query rather than
 * after it. A private or blocked paper is NOT FOUND rather than forbidden:
 * "this exists but is not yours" is itself a disclosure about someone else's
 * document (docs/13 §T-40).
 */
export async function findQuestionPaper(sql: Sql, id: string): Promise<QuestionPaper | null> {
  const rows = await sql`
    SELECT ${PAPER_COLUMNS(sql)} ${PAPER_JOINS(sql)}
    WHERE d.id = ${id}::uuid AND ${LIBRARY_VISIBLE(sql)}
  `;
  return parseRows(questionPaperSchema, rows)[0] ?? null;
}

/**
 * The storage key for a hosted paper.
 *
 * THE CLIENT NEVER NAMES A FILE (M8 §30). It sends an opaque id; this resolves
 * the key the server itself stored. There is no parameter through which a path,
 * a key or a filename could arrive, so traversal has no input to work with —
 * the same argument the object store rests on, made one layer earlier.
 *
 * `presentation = 'host'` is required here, which by the database's own rights
 * gate means a dated determination of `permitted` exists. A `link` paper has no
 * stored bytes, and asking for them returns nothing rather than reaching out to
 * the origin — GradTools is not a proxy (M8 §15).
 *
 * Returns the KEY ONLY. The stored `mime_type` is deliberately not returned:
 * the route declares `application/pdf` itself, so a wrong or hostile value in
 * that column cannot decide how a browser interprets the response.
 */
export async function findHostedPaperFile(
  sql: Sql,
  id: string,
): Promise<{ storageKey: string } | null> {
  const rows = await sql<{ storage_key: string }[]>`
    SELECT storage_key
    FROM documents
    WHERE id = ${id}::uuid
      AND document_kind = 'question_paper'
      AND presentation = 'host'
      AND state IN ('validated', 'extracted')
      AND storage_key IS NOT NULL
  `;
  const row = rows[0];
  return row === undefined ? null : { storageKey: row.storage_key };
}

/**
 * The filter values that would actually return something.
 *
 * Computed from the visible library rather than from the reference tables, so
 * the interface never offers a semester with no papers in it (M8 §10). Nulls
 * are excluded throughout: "unknown year" is not a year to filter by, and
 * offering it would imply a bucket the filter cannot express.
 */
export async function listQuestionPaperFilters(sql: Sql): Promise<QuestionPaperFilters> {
  const [subjects, schemes, branches, semesters, years, formats, sources] = await Promise.all([
    sql<{ code: string; title: string | null }[]>`
      SELECT DISTINCT COALESCE(s.code, d.subject_code) AS code, s.title
      ${PAPER_JOINS(sql)}
      WHERE ${LIBRARY_VISIBLE(sql)} AND COALESCE(s.code, d.subject_code) IS NOT NULL
      ORDER BY code
    `,
    sql<{ scheme_id: string }[]>`
      SELECT DISTINCT COALESCE(s.scheme_id, d.scheme_id) AS scheme_id
      ${PAPER_JOINS(sql)}
      WHERE ${LIBRARY_VISIBLE(sql)} AND COALESCE(s.scheme_id, d.scheme_id) IS NOT NULL
      ORDER BY scheme_id
    `,
    sql<{ id: string; name: string }[]>`
      SELECT DISTINCT b.id, b.name
      ${PAPER_JOINS(sql)}
      WHERE ${LIBRARY_VISIBLE(sql)} AND b.id IS NOT NULL
      ORDER BY name
    `,
    sql<{ semester: number }[]>`
      SELECT DISTINCT COALESCE(s.semester, d.semester)::int AS semester
      ${PAPER_JOINS(sql)}
      WHERE ${LIBRARY_VISIBLE(sql)} AND COALESCE(s.semester, d.semester) IS NOT NULL
      ORDER BY semester
    `,
    sql<{ exam_year: number }[]>`
      SELECT DISTINCT d.exam_year::int AS exam_year
      ${PAPER_JOINS(sql)}
      WHERE ${LIBRARY_VISIBLE(sql)} AND d.exam_year IS NOT NULL
      ORDER BY exam_year DESC
    `,
    sql<{ paper_format: string }[]>`
      SELECT DISTINCT d.paper_format
      ${PAPER_JOINS(sql)}
      WHERE ${LIBRARY_VISIBLE(sql)} AND d.paper_format IS NOT NULL
      ORDER BY paper_format
    `,
    sql<{ id: string; name: string }[]>`
      SELECT DISTINCT src.id, src.publisher AS name
      ${PAPER_JOINS(sql)}
      WHERE ${LIBRARY_VISIBLE(sql)} AND src.id IS NOT NULL
      ORDER BY name
    `,
  ]);

  return questionPaperFiltersSchema.parse({
    subjects: subjects.map((row) => ({ code: row.code, title: row.title })),
    schemes: schemes.map((row) => row.scheme_id),
    branches,
    semesters: semesters.map((row) => row.semester),
    years: years.map((row) => row.exam_year),
    formats: formats.map((row) => row.paper_format),
    sources,
  });
}

/* -------------------------------------------------------------------------- */
/* Question search (M10B)                                                     */
/* -------------------------------------------------------------------------- */

export interface QuestionSearchFilter {
  readonly search?: string | undefined;
  readonly subjectCode?: string | undefined;
  readonly semester?: number | undefined;
  readonly year?: number | undefined;
  readonly module?: string | undefined;
  readonly marks?: number | undefined;
  readonly format?: string | undefined;
  /** `reviewed` narrows to records a person has actually checked. */
  readonly reviewed?: boolean | undefined;
  readonly limit: number;
  readonly offset: number;
}

/*
 * Only the extraction that is CURRENT for its document.
 *
 * Both parser versions live side by side — the corpus carries nine papers on
 * positional-v1 and nine on positional-v2 — and searching across them would
 * return the same question twice and let a v1 record masquerade as a result
 * about today's extraction (M10B §24). Versions are isolated, never merged.
 */
const QUESTION_JOINS = (sql: Sql) => sql`
    FROM extracted_questions q
    JOIN extracted_papers p ON p.id = q.paper_id AND p.is_current = true
    JOIN documents d        ON d.id = p.document_id
    LEFT JOIN subjects s    ON s.id = d.subject_id
`;

/**
 * Search questions across every paper the library is allowed to show.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A DIFFERENT TRUST DOMAIN FROM THE REVIEW ROUTES
 * ---------------------------------------------------------------------------
 *
 * `/papers/:id/questions` is an operator surface: it answers for any extraction
 * of any document, because a reviewer needs to see work in progress. This is
 * student-facing, so it applies `LIBRARY_VISIBLE` exactly as the paper listing
 * does — a question from a document that is private, blocked or not yet
 * validated is NOT FOUND rather than forbidden, because "this exists but is not
 * yours" is itself a disclosure (docs/13 §T-40, M10B §42).
 *
 * No student academic data is touched. This reads reference material only, and
 * carries no profile, no account and no local record (M10B §6, §42).
 *
 * Matching is deterministic ILIKE over the EFFECTIVE text — reviewed where a
 * reviewer wrote one, machine otherwise (M10B §7, §23). Deliberately not vector
 * search: the corpus measurement found no repeats to justify it (M10B §27).
 */
export async function searchQuestions(
  sql: Sql,
  filter: QuestionSearchFilter,
): Promise<{ items: QuestionSearchResult[]; total: number }> {
  const search =
    filter.search === undefined || filter.search.trim() === ''
      ? null
      : `%${filter.search.trim().replace(/[\\%_]/g, '\\$&')}%`;

  const where = sql`
    WHERE ${LIBRARY_VISIBLE(sql)}
      /*
       * A question with no text is not a search result. btrim matters: the
       * column is NOT NULL, so "no text" arrives as '' or as whitespace, and
       * comparing against '' alone lets a whitespace-only record through to
       * render as a blank row. 65 of the 126 current questions in the local
       * corpus have empty text, so this is the common case, not the edge one.
       */
      AND btrim(COALESCE(q.reviewed_question_text, q.question_text)) <> ''
      AND (${search}::text IS NULL
           OR COALESCE(q.reviewed_question_text, q.question_text) ILIKE ${search} ESCAPE '\\'
           OR COALESCE(q.reviewed_question_number, q.question_number) ILIKE ${search} ESCAPE '\\')
      AND (${filter.subjectCode ?? null}::text IS NULL
           OR COALESCE(s.code, d.subject_code) = ${filter.subjectCode ?? null})
      AND (${filter.semester ?? null}::int IS NULL
           OR COALESCE(s.semester, d.semester) = ${filter.semester ?? null})
      AND (${filter.year ?? null}::int IS NULL OR d.exam_year = ${filter.year ?? null})
      AND (${filter.module ?? null}::text IS NULL
           OR COALESCE(q.reviewed_module, q.module) = ${filter.module ?? null})
      AND (${filter.marks ?? null}::int IS NULL
           OR COALESCE(q.reviewed_marks, q.marks) = ${filter.marks ?? null})
      AND (${filter.format ?? null}::text IS NULL
           OR p.paper_format = ${filter.format ?? null}::paper_format)
      AND (${filter.reviewed ?? null}::boolean IS NULL
           OR (q.review_state <> 'unreviewed') = ${filter.reviewed ?? null})
  `;

  /*
   * STABLE ORDERING (M10B §7, §48). Newest sitting first, then the paper, then
   * the question's own position in it — and `q.id` last so that two questions
   * identical on every other key still come back in the same order on every
   * request. Without that tiebreak, pagination silently duplicates and drops
   * rows.
   */
  const rows = await sql`
    SELECT q.id,
           q.paper_id                                          AS "paperId",
           d.id                                                AS "documentId",
           d.title                                             AS "paperTitle",
           COALESCE(s.code, d.subject_code)                    AS "subjectCode",
           s.title                                             AS "subjectTitle",
           COALESCE(s.semester, d.semester)                    AS semester,
           d.exam_year                                         AS "examYear",
           d.exam_session                                      AS "examSession",
           COALESCE(q.reviewed_question_number, q.question_number) AS "questionNumber",
           COALESCE(q.reviewed_module, q.module)               AS module,
           COALESCE(q.reviewed_marks, q.marks)                 AS marks,
           COALESCE(q.reviewed_question_text, q.question_text) AS text,
           (q.reviewed_question_text IS NOT NULL)              AS "isReviewed",
           q.confidence                                        AS confidence,
           q.needs_review                                      AS "needsReview",
           p.paper_format                                      AS "paperFormat",
           p.extraction_source                                 AS "extractionSource",
           p.parser_version                                    AS "parserVersion"
    ${QUESTION_JOINS(sql)}
    ${where}
    ORDER BY d.exam_year DESC NULLS LAST, d.id, q.ordinal, q.id
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `;

  const [count] = await sql<{ total: string }[]>`
    SELECT count(*)::text AS total ${QUESTION_JOINS(sql)} ${where}
  `;

  return {
    items: parseRows(questionSearchResultSchema, rows),
    total: Number(count?.total ?? 0),
  };
}
