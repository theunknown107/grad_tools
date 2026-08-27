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
