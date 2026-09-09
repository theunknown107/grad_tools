/**
 * Check the persisted catalogue against what it claims to be.
 *
 * Authority: Phase 7D.2 §21–§32 · docs/38_VTU_INGESTION.md
 *
 * The rules live here rather than in `scripts/vtu-validate.ts` so that they can
 * be run against a database a TEST built, with a defect deliberately in it. A
 * validator nobody has ever seen fail is not a validator.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE GATE
 * ---------------------------------------------------------------------------
 *
 * `vtu:sync` checks what it can while writing: a foreign key it would violate,
 * a constraint the schema enforces, a course it has already written this run.
 * None of that catches the failures that matter most, because they are failures
 * of the WHOLE catalogue rather than of one row — an orphan module, a course
 * two documents disagree about, a semester whose credits no longer add up to
 * the figure its own scheme prints.
 *
 * Those are only visible once everything is written, so they are checked once
 * everything is written.
 *
 * ---------------------------------------------------------------------------
 * FAILURES, WARNINGS, AND THE DIFFERENCE
 * ---------------------------------------------------------------------------
 *
 * A FAILURE is the catalogue contradicting itself: a topic whose module does
 * not exist, a course with no provenance, an alias pointing at nothing. These
 * are our defects.
 *
 * A WARNING is the SOURCE contradicting itself, faithfully recorded. Two VTU
 * documents that disagree about a course code are not a bug in this pipeline,
 * and making that fail would mean the only way to go green is to silently pick
 * a side — the one thing §16 forbids.
 *
 * ---------------------------------------------------------------------------
 * NO COUNT IS INVENTED (§32)
 * ---------------------------------------------------------------------------
 *
 * Every number reported is the result of a query run in this process. A check
 * that cannot be performed says so and counts as neither a pass nor a failure:
 * "not comparable" is an answer, and dressing it up as a tick would make the
 * report worthless exactly where it matters most.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Sql } from 'postgres';
import { optionGroupsOf, parseScheme, semesterTotalsOf } from '@gradtools/vtu-catalogue';
import type { SchemePage } from '@gradtools/vtu-catalogue';

const CACHE_ROOT = resolve('../../.vtu-store/extractions');
const EXTRACTOR_VERSION = '1.0.0';

export type Severity = 'pass' | 'warn' | 'fail' | 'skip';

export interface Finding {
  readonly area: string;
  readonly severity: Severity;
  readonly message: string;
  /** Offending rows, so a failure names what to look at rather than a count. */
  readonly examples?: readonly string[];
}

const pass = (area: string, message: string): Finding => ({ area, severity: 'pass', message });
const warn = (area: string, message: string, examples?: readonly string[]): Finding => ({
  area,
  severity: 'warn',
  message,
  ...(examples === undefined ? {} : { examples }),
});
const fail = (area: string, message: string, examples?: readonly string[]): Finding => ({
  area,
  severity: 'fail',
  message,
  ...(examples === undefined ? {} : { examples }),
});
const skip = (area: string, message: string): Finding => ({ area, severity: 'skip', message });

/** A count from a single-value query. */
async function scalar(query: ReturnType<Sql>): Promise<number> {
  const rows = (await query) as unknown as { n: string }[];
  return Number(rows[0]?.n ?? 0);
}

/**
 * A rule that must find nothing.
 *
 * Every structural check has this shape — "rows that should not exist" — and
 * writing them as one helper means a failure always reports EXAMPLES rather
 * than a bare count, because a count of 3 tells nobody which 3.
 */
async function mustBeEmpty(
  area: string,
  description: string,
  query: ReturnType<Sql>,
): Promise<Finding> {
  const rows = (await query) as unknown as { what: string }[];
  if (rows.length === 0) return pass(area, `no ${description}`);
  return fail(
    area,
    `${String(rows.length)} ${description}`,
    rows.slice(0, 5).map((row) => row.what),
  );
}

/* -------------------------------------------------------------------------- */
/* Documents (§22)                                                            */
/* -------------------------------------------------------------------------- */

async function checkDocuments(sql: Sql): Promise<Finding[]> {
  const area = 'documents';
  const versions = await scalar(sql`SELECT count(*)::text AS n FROM source_document_versions`);
  if (versions === 0) return [fail(area, 'no document versions at all — has sync ever run?')];

  return [
    pass(area, `${String(versions)} document versions`),
    await mustBeEmpty(
      area,
      'document versions with a malformed SHA-256',
      sql`SELECT sha256 AS what FROM source_document_versions WHERE sha256 !~ '^[0-9a-f]{64}$'`,
    ),
    await mustBeEmpty(
      area,
      'document versions that are not PDFs',
      sql`SELECT sha256 AS what FROM source_document_versions WHERE mime_type <> 'application/pdf'`,
    ),
    await mustBeEmpty(
      area,
      'document versions with no parser or extraction recorded',
      sql`SELECT sha256 AS what FROM source_document_versions
          WHERE coalesce(parser_version, '') = '' OR extraction_status IS NULL`,
    ),
    await mustBeEmpty(
      area,
      'document versions no URL points at',
      sql`SELECT v.sha256 AS what FROM source_document_versions v
          WHERE NOT EXISTS (SELECT 1 FROM source_document_references r WHERE r.version_id = v.id)`,
    ),
    /*
     * §31: the same PDF served from six URLs is ONE binary and six references.
     * That is deduplication working, not a duplicate — so what is checked is
     * that no two VERSIONS share a hash, which the primary key already forbids
     * and which is therefore about the store, not the table.
     */
    await mustBeEmpty(
      area,
      'URLs recorded against more than one document version',
      sql`SELECT url AS what FROM source_document_references
          GROUP BY url HAVING count(DISTINCT version_id) > 1`,
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Programmes, streams and applicability (§23)                                */
/* -------------------------------------------------------------------------- */

async function checkApplicability(sql: Sql): Promise<Finding[]> {
  const area = 'applicability';
  const scopes = (await sql<{ scope: string; n: string }[]>`
    SELECT scope::text, count(*)::text AS n FROM document_applicability GROUP BY scope ORDER BY scope
  `) as unknown as { scope: string; n: string }[];

  const findings: Finding[] = [
    pass(area, scopes.map((row) => `${row.n} ${row.scope}`).join(', ') || 'no applicability rows'),
    await mustBeEmpty(
      area,
      'stream-scoped documents naming no stream',
      sql`SELECT version_id::text AS what FROM document_applicability
          WHERE scope = 'stream' AND stream_id IS NULL`,
    ),
    await mustBeEmpty(
      area,
      'programme-scoped documents naming no programme',
      sql`SELECT version_id::text AS what FROM document_applicability
          WHERE scope = 'programme' AND programme_name IS NULL`,
    ),
    await mustBeEmpty(
      area,
      'documents claiming to be both common and programme-specific',
      sql`SELECT version_id::text AS what FROM document_applicability
          WHERE scope = 'common' AND programme_name IS NOT NULL`,
    ),
  ];

  /*
   * §23: `unknown` and `common` must stay different answers. A document nobody
   * classified is a gap to work on; a document that genuinely serves a whole
   * stream is finished work. Collapsing them hides the first inside the second.
   */
  const unknown = scopes.find((row) => row.scope === 'unknown')?.n ?? '0';
  if (Number(unknown) > 0) {
    findings.push(warn(area, `${unknown} documents whose applicability nobody has established`));
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Courses (§24, §25)                                                         */
/* -------------------------------------------------------------------------- */

async function checkCourses(sql: Sql, schemeYear: string | null): Promise<Finding[]> {
  const area = 'courses';
  const total = await scalar(
    sql`SELECT count(*)::text AS n FROM catalogue_courses
        WHERE ${schemeYear === null ? sql`TRUE` : sql`scheme_year = ${schemeYear}`}`,
  );
  return [
    pass(area, `${String(total)} courses`),
    await mustBeEmpty(
      area,
      'courses with no title',
      sql`SELECT code AS what FROM catalogue_courses WHERE trim(title) = ''`,
    ),
    await mustBeEmpty(
      area,
      'courses whose source document is missing',
      sql`SELECT c.code AS what FROM catalogue_courses c
          WHERE NOT EXISTS (SELECT 1 FROM source_document_versions v WHERE v.id = c.version_id)`,
    ),
    /*
     * The identity, checked as data rather than trusted to the index — the
     * index is over COALESCE and this is the statement it is meant to enforce.
     */
    await mustBeEmpty(
      area,
      'duplicate course identities',
      sql`SELECT scheme_year || ' ' || coalesce(programme_name, '') || ' ' ||
                 coalesce(stream_id, '') || ' sem ' || semester || ' ' || code AS what
          FROM catalogue_courses
          GROUP BY scheme_year, coalesce(programme_name, ''), coalesce(stream_id, ''),
                   semester, code
          HAVING count(*) > 1`,
    ),
    await mustBeEmpty(
      area,
      'borrowed credits that do not name where they came from',
      sql`SELECT code AS what FROM catalogue_courses
          WHERE credit_basis <> 'table' AND related_code IS NULL`,
    ),
    await mustBeEmpty(
      area,
      'courses citing a page number that cannot exist',
      sql`SELECT c.code AS what FROM catalogue_courses c
          JOIN source_document_versions v ON v.id = c.version_id
          WHERE c.source_page IS NOT NULL AND v.page_count IS NOT NULL
            AND c.source_page > v.page_count`,
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Syllabus structure (§26)                                                   */
/* -------------------------------------------------------------------------- */

async function checkSyllabi(sql: Sql): Promise<Finding[]> {
  const area = 'syllabus';
  const syllabi = await scalar(sql`SELECT count(*)::text AS n FROM catalogue_syllabi`);
  const modules = await scalar(sql`SELECT count(*)::text AS n FROM catalogue_modules`);
  const topics = await scalar(sql`SELECT count(*)::text AS n FROM catalogue_topics`);

  const findings: Finding[] = [
    pass(area, `${String(syllabi)} syllabi, ${String(modules)} modules, ${String(topics)} topics`),
    /*
     * Orphans cannot exist while the foreign keys hold, and are checked anyway:
     * a cascade that stops working is exactly the kind of failure that is
     * invisible until something reads the wrong number off a join.
     */
    await mustBeEmpty(
      area,
      'modules whose syllabus is gone',
      sql`SELECT m.id::text AS what FROM catalogue_modules m
          WHERE NOT EXISTS (SELECT 1 FROM catalogue_syllabi s WHERE s.id = m.syllabus_id)`,
    ),
    await mustBeEmpty(
      area,
      'topics whose module is gone',
      sql`SELECT t.id::text AS what FROM catalogue_topics t
          WHERE NOT EXISTS (SELECT 1 FROM catalogue_modules m WHERE m.id = t.module_id)`,
    ),
    /* §9: all four provenance fields, on every extracted row. */
    await mustBeEmpty(
      area,
      'modules or topics missing provenance',
      sql`SELECT what FROM (
            SELECT 'module ' || id::text AS what FROM catalogue_modules
            WHERE source_page IS NULL OR trim(parser_version) = ''
               OR trim(extraction_method) = ''
            UNION ALL
            SELECT 'topic ' || id::text FROM catalogue_topics
            WHERE source_page IS NULL OR trim(parser_version) = ''
               OR trim(extraction_method) = ''
          ) t`,
    ),
    await mustBeEmpty(
      area,
      'modules whose provenance points at a document that is gone',
      sql`SELECT m.id::text AS what FROM catalogue_modules m
          WHERE NOT EXISTS (SELECT 1 FROM source_document_versions v WHERE v.id = m.version_id)`,
    ),
    await mustBeEmpty(
      area,
      'topics numbered from zero or below',
      sql`SELECT id::text AS what FROM catalogue_topics WHERE position < 1`,
    ),
    await mustBeEmpty(
      area,
      'duplicate syllabus identities',
      sql`SELECT code AS what FROM catalogue_syllabi
          GROUP BY scheme_year, coalesce(programme_name, ''), coalesce(stream_id, ''),
                   coalesce(semester, 0), code
          HAVING count(*) > 1`,
    ),
  ];

  /*
   * §26 IS EXPLICIT THAT A SYLLABUS IS NOT KEYED TO A COURSE ROW, so an
   * unmatched syllabus is reported and never treated as a failure. The
   * university prints inconsistent identifiers — that is what the alias table
   * and the conflict table are for — and a foreign key here would force a
   * decision at write time that neither of them has evidence for yet.
   */
  const unmatched = (await sql<{ code: string }[]>`
    SELECT s.code FROM catalogue_syllabi s
    WHERE NOT EXISTS (
      SELECT 1 FROM catalogue_courses c
      WHERE c.scheme_year = s.scheme_year
        AND (c.code = s.code OR c.code IN (
          SELECT a.variant_code FROM catalogue_aliases a
          WHERE a.canonical_code = s.code AND a.scheme_year = s.scheme_year
        ))
    )
    ORDER BY s.code
  `) as unknown as { code: string }[];
  if (unmatched.length > 0) {
    findings.push(
      warn(
        area,
        `${String(unmatched.length)} syllabi describe a course no scheme in the catalogue lists`,
        unmatched.slice(0, 5).map((row) => row.code),
      ),
    );
  } else {
    findings.push(pass(area, 'every syllabus matches a course the scheme lists'));
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Option groups (§27)                                                        */
/* -------------------------------------------------------------------------- */

async function checkOptions(sql: Sql): Promise<Finding[]> {
  const area = 'options';
  const groups = await scalar(sql`SELECT count(*)::text AS n FROM catalogue_option_groups`);
  const members = await scalar(sql`SELECT count(*)::text AS n FROM catalogue_option_members`);
  return [
    pass(area, `${String(groups)} groups, ${String(members)} memberships`),
    await mustBeEmpty(
      area,
      'option groups offering no choice at all',
      sql`SELECT g.slot_code AS what FROM catalogue_option_groups g
          WHERE (SELECT count(*) FROM catalogue_option_members m WHERE m.group_id = g.id) < 2`,
    ),
    /* A slot is not one of its own options; storing it says otherwise. */
    await mustBeEmpty(
      area,
      'groups listing their own slot as an option',
      sql`SELECT g.slot_code AS what FROM catalogue_option_groups g
          JOIN catalogue_option_members m ON m.group_id = g.id
          WHERE g.kind = 'elective_slot' AND m.code = g.slot_code`,
    ),
    await mustBeEmpty(
      area,
      'duplicate option group identities',
      sql`SELECT slot_code AS what FROM catalogue_option_groups
          GROUP BY scheme_year, coalesce(programme_name, ''), coalesce(stream_id, ''),
                   semester, slot_code
          HAVING count(*) > 1`,
    ),
    /*
     * §27: no course belongs to incompatible groups. Two groups in the SAME
     * scope and semester both offering one course would mean the course is
     * simultaneously an option for two different slots, which no scheme prints.
     */
    await mustBeEmpty(
      area,
      'courses offered by two different slots in one semester',
      sql`SELECT m.code || ' sem ' || g.semester AS what
          FROM catalogue_option_members m
          JOIN catalogue_option_groups g ON g.id = m.group_id
          GROUP BY m.code, g.scheme_year, coalesce(g.programme_name, ''),
                   coalesce(g.stream_id, ''), g.semester
          HAVING count(DISTINCT g.slot_code) > 1`,
    ),
    await mustBeEmpty(
      area,
      'option groups whose source document is missing',
      sql`SELECT g.slot_code AS what FROM catalogue_option_groups g
          WHERE NOT EXISTS (SELECT 1 FROM source_document_versions v WHERE v.id = g.version_id)`,
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Aliases (§28)                                                              */
/* -------------------------------------------------------------------------- */

async function checkAliases(sql: Sql): Promise<Finding[]> {
  const area = 'aliases';
  const total = await scalar(sql`SELECT count(*)::text AS n FROM catalogue_aliases`);
  return [
    pass(area, `${String(total)} aliases`),
    await mustBeEmpty(
      area,
      'aliases from a code to itself',
      sql`SELECT variant_code AS what FROM catalogue_aliases WHERE variant_code = canonical_code`,
    ),
    await mustBeEmpty(
      area,
      'codes aliased to two different canonical codes',
      sql`SELECT variant_code AS what FROM catalogue_aliases
          GROUP BY scheme_year, variant_code HAVING count(DISTINCT canonical_code) > 1`,
    ),
    /*
     * A chain — A→B where B→C — makes the answer depend on how many times a
     * caller looks it up. One hop, always, or the equivalence is not one.
     */
    await mustBeEmpty(
      area,
      'alias chains',
      sql`SELECT a.variant_code || ' -> ' || a.canonical_code AS what
          FROM catalogue_aliases a
          JOIN catalogue_aliases b
            ON b.variant_code = a.canonical_code AND b.scheme_year = a.scheme_year`,
    ),
    await mustBeEmpty(
      area,
      'aliases with no evidence recorded',
      sql`SELECT variant_code AS what FROM catalogue_aliases WHERE length(trim(reason)) < 20`,
    ),
    await mustBeEmpty(
      area,
      'aliases whose canonical code names nothing in the catalogue',
      sql`SELECT a.variant_code AS what FROM catalogue_aliases a
          WHERE NOT EXISTS (
            SELECT 1 FROM catalogue_syllabi s
            WHERE s.code = a.canonical_code AND s.scheme_year = a.scheme_year
          )
          AND NOT EXISTS (
            SELECT 1 FROM catalogue_courses c
            WHERE c.code = a.canonical_code AND c.scheme_year = a.scheme_year
          )`,
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Conflicts (§29)                                                            */
/* -------------------------------------------------------------------------- */

async function checkConflicts(sql: Sql): Promise<Finding[]> {
  const area = 'conflicts';
  const open = (await sql<{ entity_type: string; code: string; field: string }[]>`
    SELECT entity_type, code, field FROM catalogue_conflicts WHERE status = 'open' ORDER BY code
  `) as unknown as { entity_type: string; code: string; field: string }[];

  const findings: Finding[] = [
    await mustBeEmpty(
      area,
      'conflicts with no readings behind them',
      sql`SELECT c.code AS what FROM catalogue_conflicts c
          WHERE NOT EXISTS (
            SELECT 1 FROM catalogue_conflict_readings r WHERE r.conflict_id = c.id
          )`,
    ),
    await mustBeEmpty(
      area,
      'conflict readings pointing at a document that is gone',
      sql`SELECT r.value AS what FROM catalogue_conflict_readings r
          WHERE NOT EXISTS (SELECT 1 FROM source_document_versions v WHERE v.id = r.version_id)`,
    ),
    await mustBeEmpty(
      area,
      'resolved conflicts that do not say who resolved them or why',
      sql`SELECT code AS what FROM catalogue_conflicts
          WHERE status <> 'open' AND (resolution IS NULL OR resolved_at IS NULL)`,
    ),
  ];

  /*
   * An open conflict is a WARNING and never a failure. Two of VTU's own
   * documents disagreeing about a course code is not a defect in this
   * pipeline, and making it fail would mean the only way to go green is to
   * pick a side without evidence — which is what §16 exists to prevent.
   */
  if (open.length === 0) findings.push(pass(area, 'no open source conflicts'));
  else {
    findings.push(
      warn(
        area,
        `${String(open.length)} open source conflicts, recorded and not resolved`,
        open.slice(0, 5).map((row) => `${row.entity_type} ${row.code} (${row.field})`),
      ),
    );
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Semester totals (§30)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The catalogue's arithmetic against the figure the scheme prints for itself.
 *
 * This is the document marking our work. A parser that misreads every row in
 * the same way produces a catalogue that is perfectly self-consistent and
 * completely wrong; the only external check available is that VTU prints the
 * answer at the foot of each semester's table.
 *
 * WHAT IS SUMMED. Each table row once, plus each OR pair once. An elective
 * slot's options are NOT added: they inherit the slot's credits, and the slot's
 * own row is already counted, so adding them would count the same three credits
 * five times.
 *
 * WHERE IT IS NOT COMPARABLE. A stream-wide first-year document prints one
 * total per CYCLE GROUP — physics-cycle and chemistry-cycle both being
 * "semester 1", each worth 20 — while the catalogue holds one semester 1 per
 * stream containing both. Two printed totals for one stored semester is not a
 * mismatch, it is a comparison that does not apply, and §30 says nothing may be
 * silently repaired to make it look like one.
 */
async function checkSemesterTotals(sql: Sql, schemeYear: string | null): Promise<Finding[]> {
  const area = 'semester totals';
  const documents = (await sql<{ sha256: string; url: string }[]>`
    SELECT v.sha256, min(r.url) AS url
    FROM source_document_versions v
    JOIN source_document_references r ON r.version_id = v.id
    JOIN document_applicability a ON a.version_id = v.id
    WHERE ${schemeYear === null ? sql`TRUE` : sql`a.scheme_year = ${schemeYear}`}
    GROUP BY v.sha256
  `) as unknown as { sha256: string; url: string }[];

  const findings: Finding[] = [];
  let compared = 0;
  let notComparable = 0;
  const mismatches: string[] = [];

  for (const document of documents) {
    const pages = await cachedPages(document.sha256);
    if (pages === null) continue;

    const totals = semesterTotalsOf(pages);
    if (totals.length === 0) continue;

    const parsed = parseScheme(pages);
    if (parsed.courses.length === 0) continue;
    const groups = optionGroupsOf(parsed.courses);

    const bySemester = new Map<number, number[]>();
    for (const total of totals) {
      const seen = bySemester.get(total.semester);
      if (seen === undefined) bySemester.set(total.semester, [total.credits]);
      else seen.push(total.credits);
    }

    for (const [semester, printed] of bySemester) {
      if (printed.length !== 1) {
        notComparable += 1;
        continue;
      }
      const tableRows = parsed.courses
        .filter(
          (course) =>
            course.semester === semester &&
            course.viaElectiveSlot === null &&
            course.viaAlternativeTo === null,
        )
        .reduce((sum, course) => sum + course.credits, 0);
      const pairs = groups
        .filter((group) => group.semester === semester && group.kind === 'alternative')
        .reduce((sum, group) => sum + (group.credits ?? 0), 0);
      const computed = tableRows + pairs;

      compared += 1;
      if (computed !== printed[0]) {
        mismatches.push(
          `${document.url.split('/').pop() ?? ''} sem ${String(semester)}: ` +
            `printed ${String(printed[0])}, catalogue ${String(computed)}`,
        );
      }
    }
  }

  if (compared === 0)
    findings.push(skip(area, 'no document states a total this can be compared to'));
  else if (mismatches.length === 0) {
    findings.push(pass(area, `${String(compared)} printed semester totals, all matching`));
  } else {
    findings.push(
      fail(area, `${String(mismatches.length)} of ${String(compared)} totals disagree`, mismatches),
    );
  }
  if (notComparable > 0) {
    findings.push(
      skip(
        area,
        `${String(notComparable)} semesters print more than one total ` +
          '(a first-year document states one per cycle group)',
      ),
    );
  }
  return findings;
}

/** A document's text from the extraction cache; null when it is not cached. */
async function cachedPages(sha256: string): Promise<SchemePage[] | null> {
  try {
    const text = await readFile(resolve(CACHE_ROOT, `${sha256}.${EXTRACTOR_VERSION}.json`), 'utf8');
    const cached = JSON.parse(text) as { status: string; pages: SchemePage[] };
    return cached.status === 'text' ? cached.pages : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Running every rule                                                         */
/* -------------------------------------------------------------------------- */

export interface ValidationResult {
  readonly findings: readonly Finding[];
  readonly failures: number;
  readonly warnings: number;
  readonly skipped: number;
  readonly passed: boolean;
}

/** Every rule, in the order the report prints them. */
export async function validateCatalogue(
  sql: Sql,
  options: { readonly schemeYear?: string | null } = {},
): Promise<ValidationResult> {
  const schemeYear = options.schemeYear ?? null;
  const findings = [
    ...(await checkDocuments(sql)),
    ...(await checkApplicability(sql)),
    ...(await checkCourses(sql, schemeYear)),
    ...(await checkSyllabi(sql)),
    ...(await checkOptions(sql)),
    ...(await checkAliases(sql)),
    ...(await checkConflicts(sql)),
    ...(await checkSemesterTotals(sql, schemeYear)),
  ];
  const failures = findings.filter((finding) => finding.severity === 'fail').length;
  return {
    findings,
    failures,
    warnings: findings.filter((finding) => finding.severity === 'warn').length,
    skipped: findings.filter((finding) => finding.severity === 'skip').length,
    passed: failures === 0,
  };
}
