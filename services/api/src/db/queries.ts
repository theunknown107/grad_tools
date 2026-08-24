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

export async function listUniversities(sql: Sql): Promise<University[]> {
  const rows = await sql`
    SELECT id, name, short_name AS "shortName"
    FROM universities
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
    WHERE active
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
export async function findActiveRuleSetForScheme(
  sql: Sql,
  schemeId: string,
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
    WHERE publication = 'published' AND active AND scheme_id = ${schemeId}
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

export async function findSubjectByCode(sql: Sql, code: string): Promise<Subject | null> {
  const rows = await sql`
    SELECT ${SUBJECT_COLUMNS(sql)}
    FROM subjects
    WHERE publication = 'published' AND upper(code) = upper(${code})
    LIMIT 1
  `;
  const parsed = parseRows(subjectSchema, rows);
  return parsed[0] ?? null;
}

export async function listSyllabusModules(
  sql: Sql,
  subjectCode: string,
): Promise<SyllabusModule[]> {
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
      AND upper(s.code) = upper(${subjectCode})
    ORDER BY m.module_number
  `;
  return parseRows(syllabusModuleSchema, rows);
}
