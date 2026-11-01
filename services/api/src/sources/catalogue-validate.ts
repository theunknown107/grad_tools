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
    /*
     * A PROGRAMME FRAGMENT IS NOT A PROGRAMME (§5).
     *
     * The listing numbers some of its rows `21a` and `29a`, and a reader that
     * skipped serials by testing for digits alone took those for programme
     * names — `21a` then carried a duplicate of the entire Computer Science
     * scheme under a programme nobody offers. The discovery parser reads the
     * table's header now and cannot produce one, and this is the assertion
     * that says so of the DATA rather than of the parser.
     */
    await mustBeEmpty(
      area,
      'programme names that are really a row number',
      sql`SELECT DISTINCT programme_name AS what FROM document_applicability
          WHERE programme_name ~ '^[0-9]+[A-Za-z]?$'`,
    ),
    /*
     * And a course whose scope is nobody's is not publishable: a row with
     * neither a programme nor a stream claims to apply to every student at the
     * university, which is what a genuinely common document claims. The two
     * must not arrive at the same place by different routes (§3).
     */
    await mustBeEmpty(
      area,
      'programme names that are really a course code',
      sql`SELECT DISTINCT programme_name AS what FROM document_applicability
          WHERE programme_name ~ '^1?B[A-Z]{2,7}[0-9]{3}'`,
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

/**
 * What the catalogue actually HOLDS for one semester of one document.
 *
 * ---------------------------------------------------------------------------
 * IDENTITIES, NOT READINGS
 * ---------------------------------------------------------------------------
 *
 * A scheme prints the same course in more than one of its tables — the AI &
 * Data Science document lists Biology for Engineers under four headings — and
 * `parseScheme` returns a reading for each, exactly as it should. `vtu:sync`
 * then writes ONE row per identity.
 *
 * Summing the readings compared a number that is stored nowhere against the
 * document's own printed total, and reported a disagreement for a document
 * that agrees: the AI & DS fourth semester came out nine credits over on
 * duplicate readings alone. The first reading is kept, which is the one
 * `vtu:sync` writes; a second reading that DISAGREES is a conflict, and the
 * conflict rules are where that is reported rather than here, by inflating a
 * total.
 *
 * An option of an elective slot is not counted — the slot's own row carries
 * the credits for whichever option is taken — and an "A OR B" pair is counted
 * once, through its group.
 *
 * A group only STANDS IN for a row nothing else counts. Where one of its
 * members is itself a row of the table — which is what a code cell naming two
 * codes produces, one printed row under the first of them — the row is already
 * in the sum and the group must not add it again.
 *
 * Exported because a check nobody can run against a made-up table is a check
 * nobody has seen fail.
 */
export function creditsStoredFor(
  courses: readonly {
    readonly code: string;
    readonly semester: number;
    readonly credits: number;
    readonly viaElectiveSlot: string | null;
    readonly viaAlternativeTo: string | null;
  }[],
  groups: readonly {
    readonly semester: number;
    readonly kind: string;
    readonly credits: number | null;
    readonly members: readonly { readonly code: string }[];
  }[],
  semester: number,
): number {
  const byCode = new Map<string, number>();
  for (const course of courses) {
    if (course.semester !== semester) continue;
    if (course.viaElectiveSlot !== null || course.viaAlternativeTo !== null) continue;
    if (!byCode.has(course.code)) byCode.set(course.code, course.credits);
  }
  const rows = [...byCode.values()].reduce((sum, credits) => sum + credits, 0);
  const pairs = groups
    .filter(
      (group) =>
        group.semester === semester &&
        group.kind === 'alternative' &&
        !group.members.some((member) => byCode.has(member.code)),
    )
    .reduce((sum, group) => sum + (group.credits ?? 0), 0);
  return rows + pairs;
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
  /*
   * HOW EVERY CREDIT WAS ESTABLISHED, REPORTED RATHER THAN AVERAGED (§12).
   *
   * `table` is a figure the course's own row prints. `slot` is one borrowed
   * from the elective slot the course is an option for, and `alternative` one
   * shared with the partner on an "A OR B" row. They are not equally strong
   * evidence, and a catalogue where half the credits are borrowed is a
   * different object from one where they are printed — so the split is
   * reported on every run instead of being discoverable only by query.
   *
   * These are the three the store already writes. No parallel taxonomy is
   * introduced beside them (§13).
   */
  const basis = (await sql`
    SELECT credit_basis::text AS what, count(*)::text AS n
    FROM catalogue_courses
    WHERE ${schemeYear === null ? sql`TRUE` : sql`scheme_year = ${schemeYear}`}
    GROUP BY 1 ORDER BY 2 DESC
  `) as unknown as { what: string; n: string }[];

  /*
   * A SCHEME THE CATALOGUE DOES NOT HOLD IS A FAILURE, NOT A CLEAN RUN.
   *
   * Every check below is written to be quiet when it has nothing to look at,
   * which is right for an OPTIONAL part of a catalogue and wrong for the whole
   * of one. Asked to validate a scheme year with no courses in it, this
   * reported no failures — and `passed` is `failures === 0`, so the terminal
   * printed VALIDATION PASSED for a scheme that had never been ingested.
   *
   * That verdict is load-bearing: the publish rules gate on it, so a scheme
   * nobody has any data for could be read as one that is ready to ship. An
   * empty result is evidence that the ingestion did not happen, and saying so
   * is the whole job of this file.
   *
   * Only when a scheme was ASKED for. With no filter this is a catalogue-wide
   * run, and an empty catalogue is already reported by the count above.
   */
  if (schemeYear !== null && total === 0) {
    return [
      fail(
        area,
        `no courses are stored for the ${schemeYear} scheme, so there is nothing to validate ` +
          '— an empty result is not a passing one',
      ),
    ];
  }
  const borrowed = basis
    .filter((row) => row.what !== 'table')
    .reduce((sum, row) => sum + Number(row.n), 0);

  return [
    pass(area, `${String(total)} courses`),
    pass(
      area,
      `credit provenance: ${basis.map((row) => `${row.n} ${row.what}`).join(', ')}`,
    ),
    total === 0
      ? skip(area, 'no courses to weigh')
      : borrowed * 2 > total
        ? warn(
            area,
            `${String(borrowed)} of ${String(total)} credits are borrowed rather than printed ` +
              'on the course\u2019s own row',
          )
        : pass(area, 'most credits are printed on the course\u2019s own row'),
    await mustBeEmpty(
      area,
      'courses with no title',
      sql`SELECT code AS what FROM catalogue_courses WHERE trim(title) = ''`,
    ),
    /*
     * A borrowed credit has to name a slot THIS catalogue holds (§14). Where
     * it names one that is not here, the figure cannot be checked against its
     * source and is not evidence of anything.
     */
    await mustBeEmpty(
      area,
      'borrowed credits naming a slot the catalogue does not hold',
      sql`SELECT c.code AS what FROM catalogue_courses c
          WHERE c.credit_basis <> 'table' AND c.related_code IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM catalogue_courses s
              WHERE s.scheme_year = c.scheme_year AND s.code = c.related_code
            )`,
    ),
    /*
     * And where a course prints its OWN credits and also borrows a different
     * figure, the two disagree and neither is chosen here (§15).
     */
    await mustBeEmpty(
      area,
      'courses whose borrowed credit contradicts the slot it came from',
      sql`SELECT c.code || ' ' || c.credits || ' vs ' || s.credits AS what
          FROM catalogue_courses c
          JOIN catalogue_courses s
            ON s.scheme_year = c.scheme_year AND s.code = c.related_code
           AND coalesce(s.programme_name, '') = coalesce(c.programme_name, '')
           AND coalesce(s.stream_id, '') = coalesce(c.stream_id, '')
           AND s.semester = c.semester
          WHERE c.credit_basis = 'slot' AND c.credits <> s.credits`,
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

/**
 * "…and only this scheme", as a clause any of these queries can drop in.
 *
 * `vtu:validate --scheme 2025` named the scheme and only two of the eight
 * checks below listened. The rest counted and reported every row in the table,
 * so a 2025 validation failed on a 2022 alias and two 2022 conflicts — rows
 * that have nothing to do with the catalogue being validated and that no 2025
 * run can do anything about.
 *
 * That is worse than a noisy report. §5's whole point is that adding a scheme
 * must not disturb the one beside it, and a validator that mixes them cannot
 * be the thing that proves it: a clean 2025 result would have been evidence
 * about 2022 as well, and a failing one names a document the run never read.
 *
 * `prefix` is the table alias where the query uses one — `ofScheme(sql, year,
 * 'a.')` — because these queries join tables that each carry the column.
 */
function ofScheme(sql: Sql, schemeYear: string | null, prefix = ''): ReturnType<Sql> {
  return schemeYear === null
    ? sql`TRUE`
    : sql`${sql.unsafe(`${prefix}scheme_year`)} = ${schemeYear}`;
}

async function checkSyllabi(sql: Sql, schemeYear: string | null): Promise<Finding[]> {
  const area = 'syllabus';
  const only = ofScheme(sql, schemeYear);
  const syllabi = await scalar(
    sql`SELECT count(*)::text AS n FROM catalogue_syllabi WHERE ${only}`,
  );
  /* Modules and topics carry no scheme year of their own; their syllabus does. */
  const inScheme = sql`EXISTS (
    SELECT 1 FROM catalogue_syllabi s
    WHERE s.id = m.syllabus_id AND ${ofScheme(sql, schemeYear, 's.')}
  )`;
  const modules = await scalar(
    sql`SELECT count(*)::text AS n FROM catalogue_modules m WHERE ${inScheme}`,
  );
  const topics = await scalar(
    sql`SELECT count(*)::text AS n FROM catalogue_topics t
        JOIN catalogue_modules m ON m.id = t.module_id
        WHERE ${inScheme}`,
  );

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
            SELECT 'module ' || m.id::text AS what FROM catalogue_modules m
            WHERE (m.source_page IS NULL OR trim(m.parser_version) = ''
               OR trim(m.extraction_method) = '') AND ${inScheme}
            UNION ALL
            SELECT 'topic ' || t.id::text FROM catalogue_topics t
            JOIN catalogue_modules m ON m.id = t.module_id
            WHERE (t.source_page IS NULL OR trim(t.parser_version) = ''
               OR trim(t.extraction_method) = '') AND ${inScheme}
          ) found`,
    ),
    await mustBeEmpty(
      area,
      'modules whose provenance points at a document that is gone',
      sql`SELECT m.id::text AS what FROM catalogue_modules m
          WHERE NOT EXISTS (SELECT 1 FROM source_document_versions v WHERE v.id = m.version_id)
            AND ${inScheme}`,
    ),
    await mustBeEmpty(
      area,
      'topics numbered from zero or below',
      sql`SELECT t.id::text AS what FROM catalogue_topics t
          JOIN catalogue_modules m ON m.id = t.module_id
          WHERE t.position < 1 AND ${inScheme}`,
    ),
    await mustBeEmpty(
      area,
      'duplicate syllabus identities',
      sql`SELECT code AS what FROM catalogue_syllabi
          WHERE ${only}
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
    WHERE ${ofScheme(sql, schemeYear, 's.')} AND NOT EXISTS (
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

async function checkOptions(sql: Sql, schemeYear: string | null): Promise<Finding[]> {
  const area = 'options';
  const only = ofScheme(sql, schemeYear);
  const groupInScheme = sql`EXISTS (
    SELECT 1 FROM catalogue_option_groups g
    WHERE g.id = m.group_id AND ${ofScheme(sql, schemeYear, 'g.')}
  )`;
  const groups = await scalar(
    sql`SELECT count(*)::text AS n FROM catalogue_option_groups WHERE ${only}`,
  );
  const members = await scalar(
    sql`SELECT count(*)::text AS n FROM catalogue_option_members m WHERE ${groupInScheme}`,
  );
  return [
    pass(area, `${String(groups)} groups, ${String(members)} memberships`),
    await mustBeEmpty(
      area,
      'option groups offering no choice at all',
      sql`SELECT g.slot_code AS what FROM catalogue_option_groups g
          WHERE (SELECT count(*) FROM catalogue_option_members m WHERE m.group_id = g.id) < 2
            AND ${ofScheme(sql, schemeYear, 'g.')}`,
    ),
    /* A slot is not one of its own options; storing it says otherwise. */
    await mustBeEmpty(
      area,
      'groups listing their own slot as an option',
      sql`SELECT g.slot_code AS what FROM catalogue_option_groups g
          JOIN catalogue_option_members m ON m.group_id = g.id
          WHERE g.kind = 'elective_slot' AND m.code = g.slot_code
            AND ${ofScheme(sql, schemeYear, 'g.')}`,
    ),
    await mustBeEmpty(
      area,
      'duplicate option group identities',
      sql`SELECT slot_code AS what FROM catalogue_option_groups
          WHERE ${only}
          GROUP BY scheme_year, coalesce(programme_name, ''), coalesce(stream_id, ''),
                   semester, slot_code
          HAVING count(*) > 1`,
    ),
    /*
     * §27: no course belongs to incompatible groups. Two groups in ONE
     * DOCUMENT and semester both offering a course would mean the scheme
     * prints it as an option for two different slots at once, which no scheme
     * does.
     *
     * SCOPED TO THE DOCUMENT, which is what that sentence always meant and
     * what the query did not do. VTU names one slot differently across its own
     * documents: the sixth-semester Open Elective is `BXX654x` in `6ecesch`,
     * `BEC654x` in `5ecesch` and `BTE654x` in `6etsch`, and `BEC654A` is
     * rightly an option in all three. Comparing across a programme's documents
     * reported that as a contradiction; it is the same choice, named by each
     * document in its own way, and a course identity may have more than one
     * offering.
     */
    await mustBeEmpty(
      area,
      'courses offered by two different slots of one document',
      sql`SELECT m.code || ' sem ' || g.semester AS what
          FROM catalogue_option_members m
          JOIN catalogue_option_groups g ON g.id = m.group_id
          WHERE ${ofScheme(sql, schemeYear, 'g.')}
          GROUP BY m.code, g.version_id, g.semester
          HAVING count(DISTINCT g.slot_code) > 1`,
    ),
    await mustBeEmpty(
      area,
      'option groups whose source document is missing',
      sql`SELECT g.slot_code AS what FROM catalogue_option_groups g
          WHERE NOT EXISTS (SELECT 1 FROM source_document_versions v WHERE v.id = g.version_id)
            AND ${ofScheme(sql, schemeYear, 'g.')}`,
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Aliases (§28)                                                              */
/* -------------------------------------------------------------------------- */

async function checkAliases(sql: Sql, schemeYear: string | null): Promise<Finding[]> {
  const area = 'aliases';
  const only = ofScheme(sql, schemeYear);
  const total = await scalar(
    sql`SELECT count(*)::text AS n FROM catalogue_aliases WHERE ${only}`,
  );
  return [
    pass(area, `${String(total)} aliases`),
    await mustBeEmpty(
      area,
      'aliases from a code to itself',
      sql`SELECT variant_code AS what FROM catalogue_aliases
          WHERE variant_code = canonical_code AND ${only}`,
    ),
    await mustBeEmpty(
      area,
      'codes aliased to two different canonical codes',
      sql`SELECT variant_code AS what FROM catalogue_aliases
          WHERE ${only}
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
            ON b.variant_code = a.canonical_code AND b.scheme_year = a.scheme_year
          WHERE ${ofScheme(sql, schemeYear, 'a.')}`,
    ),
    await mustBeEmpty(
      area,
      'aliases with no evidence recorded',
      sql`SELECT variant_code AS what FROM catalogue_aliases
          WHERE length(trim(reason)) < 20 AND ${only}`,
    ),
    await mustBeEmpty(
      area,
      'aliases whose canonical code names nothing in the catalogue',
      sql`SELECT a.variant_code AS what FROM catalogue_aliases a
          WHERE ${ofScheme(sql, schemeYear, 'a.')} AND NOT EXISTS (
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

async function checkConflicts(sql: Sql, schemeYear: string | null): Promise<Finding[]> {
  const area = 'conflicts';
  const open = (await sql<{ entity_type: string; code: string; field: string }[]>`
    SELECT entity_type, code, field FROM catalogue_conflicts
    WHERE status = 'open' AND ${ofScheme(sql, schemeYear)} ORDER BY code
  `) as unknown as { entity_type: string; code: string; field: string }[];

  const findings: Finding[] = [
    await mustBeEmpty(
      area,
      'conflicts with no readings behind them',
      sql`SELECT c.code AS what FROM catalogue_conflicts c
          WHERE ${ofScheme(sql, schemeYear, 'c.')} AND NOT EXISTS (
            SELECT 1 FROM catalogue_conflict_readings r WHERE r.conflict_id = c.id
          )`,
    ),
    await mustBeEmpty(
      area,
      'conflict readings pointing at a document that is gone',
      sql`SELECT r.value AS what FROM catalogue_conflict_readings r
          JOIN catalogue_conflicts c ON c.id = r.conflict_id
          WHERE ${ofScheme(sql, schemeYear, 'c.')}
            AND NOT EXISTS (SELECT 1 FROM source_document_versions v WHERE v.id = r.version_id)`,
    ),
    await mustBeEmpty(
      area,
      'resolved conflicts that do not say who resolved them or why',
      sql`SELECT code AS what FROM catalogue_conflicts
          WHERE status <> 'open' AND (resolution IS NULL OR resolved_at IS NULL)
            AND ${ofScheme(sql, schemeYear)}`,
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

    /*
     * A BLANK TEMPLATE HAS NOTHING TO TOTAL.
     *
     * VTU publishes an empty scheme for boards to fill in — "B.E. in the title
     * of the program", with placeholder codes `BXX301`…`BXXL305` and an EMPTY
     * Course Title column — and it still prints the totals a real scheme would
     * carry: 20, 20, 22, 18, 16.
     *
     * The reader refuses those rows, correctly, because a row that names no
     * course is not one. Comparing what is left against the template's totals
     * measures nothing: five of the fifteen disagreements were this one
     * document, reporting a reading defect where the reading is right.
     *
     * So a document whose rows were refused FOR PRINTING NO TITLE is not
     * comparable. A skip, not a pass — it is counted and named in the report,
     * and the refusals themselves are already recorded against each code.
     */
    const titleless = parsed.rejected.filter((row) =>
      /prints no course title/i.test(row.reason),
    ).length;
    if (titleless > 0) {
      notComparable += [...new Set(totals.map((total) => total.semester))].length;
      continue;
    }

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
      const computed = creditsStoredFor(parsed.courses, groups, semester);

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
    ...(await checkSyllabi(sql, schemeYear)),
    ...(await checkOptions(sql, schemeYear)),
    ...(await checkAliases(sql, schemeYear)),
    ...(await checkConflicts(sql, schemeYear)),
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
