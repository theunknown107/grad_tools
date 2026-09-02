/**
 * The VTU 2022 CSE scheme, as admitted from the official document.
 *
 * Authority: docs/09 §9.22 · docs/22 §22.46 · M10A.4 §11, §12, §15, §18, §20, §30
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE ACTUALLY GUARDING
 * ---------------------------------------------------------------------------
 *
 * Not "did the rows load". Rows loading is the easy part and proves nothing
 * about whether they are TRUE. What is worth guarding is that each row can
 * still be checked against the page it came from, that re-running the seed does
 * not multiply anything, that a later scheme's codes cannot appear in a 2022
 * catalogue, and that the credits add up to the number the document itself
 * prints — which is the cheapest available evidence that the table was read
 * correctly rather than plausibly.
 *
 * REAL POSTGRESQL, REAL MIGRATIONS, REAL SEED.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { listSubjects } from '../src/db/queries.js';
import {
  SCHEME_DOCUMENT_SHA256,
  SCHEME_DOCUMENT_URL,
  SCHEME_ROWS,
  SEMESTER_CREDIT_TOTALS,
} from '../src/db/scheme-2022-cse.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

describeDb('the 2022 CSE scheme, as ingested', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  /* ---------------------------------------------------------------------- */
  /* The extraction check                                                   */
  /* ---------------------------------------------------------------------- */

  it('adds up to the total the document itself prints', () => {
    /*
     * THE CHEAPEST EVIDENCE THAT THE TABLE WAS READ CORRECTLY.
     *
     * A student takes the core rows plus ONE course from each OR-group, so the
     * seeded rows cannot simply be summed — they include every alternative.
     * One student's path through semester I is:
     *
     *   core                            4 + 4 + 3   = 11
     *   one ESC-I elective                          =  3
     *   one ETC-I or PLC-I elective                 =  3
     *   one AEC, one HSMC, one AEC/SDC  1 + 1 + 1   =  3
     *                                                 --
     *                                                 20
     *
     * and the document's own TOTAL row prints 20. A misread credit anywhere in
     * the core or the group rows breaks this.
     */
    for (const semester of [1, 2]) {
      const rows = SCHEME_ROWS.filter((row) => row.semester === semester);
      const core = rows
        .filter((row) => row.category === 'core')
        .reduce((total, row) => total + row.credits, 0);
      const mandatory = rows.filter((row) => row.category === 'mandatory');
      const electives = rows.filter((row) => row.category === 'elective');

      // Three one-credit choices, and two three-credit elective choices.
      const studentPath = core + 3 + 3 + 3;
      expect(studentPath).toBe(SEMESTER_CREDIT_TOTALS[semester]);

      // Every elective in a group carries the group's credit value.
      expect(new Set(electives.map((row) => row.credits))).toEqual(new Set([3]));
      expect(new Set(mandatory.map((row) => row.credits))).toEqual(new Set([1]));
    }
  });

  it('never lets a later-scheme code into the 2022 catalogue', async () => {
    /*
     * `1BMATC101` contains `BMATS101`-shaped text and belongs to a different
     * scheme. Nothing here may carry the later family — if one ever appears, a
     * source from the wrong document has been admitted (OQ-053).
     */
    const rows = await sql<{ code: string }[]>`
      SELECT code FROM subjects WHERE scheme_id = 'vtu-2022' AND code LIKE '1B%'
    `;
    expect(rows).toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* Provenance                                                             */
  /* ---------------------------------------------------------------------- */

  it('can point at the page every fact was read from', async () => {
    // A URL names a location and a location is re-used across revisions. The
    // hash names the bytes; the page names where in them to look (§11, §18).
    /*
     * Scoped to the SEEDED codes rather than counting the table. Test files
     * share one database and run in parallel, so a sibling file's temporary
     * fixture row is legitimately present while this runs — and a bare count
     * would fail for a reason that has nothing to do with provenance.
     */
    const codes = SCHEME_ROWS.map((row) => row.code);
    const rows = await sql<
      { code: string; sha: string | null; page: number | null; url: string }[]
    >`
      SELECT code, source_document_sha256 AS sha, source_page AS page, source_url AS url
        FROM subjects
       WHERE scheme_id = 'vtu-2022' AND branch_id = 'cse' AND code = ANY(${codes})
    `;
    expect(rows.length).toBe(SCHEME_ROWS.length);
    for (const row of rows) {
      expect(row.sha).toBe(SCHEME_DOCUMENT_SHA256);
      expect(row.url).toBe(SCHEME_DOCUMENT_URL);
      expect(row.page).not.toBeNull();
      expect(row.page).toBeGreaterThan(0);
    }
  });

  it('records the scheme hours, and claims nothing about taught hours', async () => {
    /*
     * A real timetable prints BOTH, and they differ — 3+0+2 delivered against a
     * scheme of 2+0+2. The column name carries the distinction so a later
     * "as taught" value cannot be written into the same field (§15).
     */
    const [row] = await sql<{ l: number; t: number; p: number }[]>`
      SELECT scheme_lecture_hours AS l, scheme_tutorial_hours AS t, scheme_practical_hours AS p
        FROM subjects WHERE code = 'BMATS101'
    `;
    expect([row?.l, row?.t, row?.p]).toEqual([2, 2, 2]);

    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'subjects' AND column_name LIKE '%hours%'
    `;
    // Only scheme hours exist. Nothing here can be mistaken for delivered ones.
    expect(columns.every((column) => column.column_name.startsWith('scheme_'))).toBe(true);
  });

  /* ---------------------------------------------------------------------- */
  /* Idempotency                                                            */
  /* ---------------------------------------------------------------------- */

  it('seeds the same source twice without duplicating anything', async () => {
    // Counted over the seeded codes only, for the same parallel-execution
    // reason as above: the question is whether re-seeding MULTIPLIES rows.
    const codes = SCHEME_ROWS.map((row) => row.code);
    const count = async () =>
      (
        await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM subjects
           WHERE scheme_id = 'vtu-2022' AND code = ANY(${codes})`
      )[0]?.n;

    const before = await count();
    await seed(sql);
    const after = await count();

    expect(after).toBe(before);
    expect(after).toBe(SCHEME_ROWS.length);
  });

  it('keeps one row per (scheme, branch, code)', async () => {
    // The identity M10A.1 established, enforced by the database rather than by
    // the seed remembering to check.
    const duplicates = await sql<{ code: string }[]>`
      SELECT code FROM subjects
       GROUP BY scheme_id, branch_id, code HAVING count(*) > 1
    `;
    expect(duplicates).toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* What reached a student                                                 */
  /* ---------------------------------------------------------------------- */

  it('publishes both semesters with credits and SEE applicability known', async () => {
    for (const semester of [1, 2]) {
      const subjects = await listSubjects(sql, { scheme: 'vtu-2022', branch: 'cse', semester });
      expect(subjects.length).toBeGreaterThan(0);
      for (const subject of subjects) {
        expect(subject.credits).not.toBeNull();
        expect(subject.hasSee).toBe(true);
        expect(subject.schemeLectureHours).not.toBeNull();
        expect(subject.sourcePage).not.toBeNull();
      }
    }
  });

  it('carries the two electives a real result card names', async () => {
    /*
     * REAL-REFERENCE CHECK. The supplied semester-1 card and timetable carry
     * BESCK104B and BETCK105I, and until this milestone neither was in the
     * catalogue — they lived behind the `BESCK104x` group placeholder, which is
     * not a course code. Pages 3 and 6 expand those groups, so the concrete
     * alternatives are now present with the document's own titles.
     */
    const subjects = await listSubjects(sql, { scheme: 'vtu-2022', branch: 'cse', semester: 1 });
    const byCode = new Map(subjects.map((subject) => [subject.code, subject]));

    expect(byCode.get('BESCK104B')?.title).toBe('Introduction to Electrical Engineering');
    expect(byCode.get('BETCK105I')?.title).toBe('Introduction to Cyber Security');
    expect(byCode.get('BESCK104B')?.credits).toBe(3);
  });

  it('does not seed a group placeholder as if it were a course', async () => {
    // `BESCK104x` is a family, not a code. Seeding it would create a course
    // that does not exist and that no student can be enrolled in.
    const rows = await sql<{ code: string }[]>`
      SELECT code FROM subjects WHERE code LIKE '%x' OR code LIKE '%X'
    `;
    expect(rows).toEqual([]);
  });
});
