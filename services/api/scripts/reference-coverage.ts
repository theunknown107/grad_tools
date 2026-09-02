/**
 * What the subject catalogue actually knows, per scheme, branch and semester.
 *
 * Authority: docs/22 §22.42 · docs/32 OQ-051, OQ-034 · M10A.1 §8, §17
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A REPORT AND NOT A SEED
 * ---------------------------------------------------------------------------
 *
 * OQ-049 closed with the note that credits and SEE applicability are
 * "reference-backed" — which is true of the model and says nothing about how
 * much reference data exists. The temptation at that point is to fill the gap:
 * type in the remaining semesters from a syllabus PDF, or default the missing
 * values to something plausible. Both would put fabricated academic facts
 * behind a UI that presents them as verified.
 *
 * So this counts what is there and prints the holes. It writes nothing.
 *
 *   DATABASE_URL=... pnpm --filter @gradtools/api reference:coverage
 *
 * ---------------------------------------------------------------------------
 * WHAT "KNOWN" MEANS HERE
 * ---------------------------------------------------------------------------
 *
 * `credits` and `has_see` are NOT NULL in the reference schema, so every row
 * carries a value and a naive count would report 100% coverage of everything.
 * That would be a lie about an unverified row: `has_see` defaults to `true`,
 * and a default is not a fact.
 *
 * A value is therefore counted as VERIFIED only when its row is
 * `verification = 'verified'`, which is also what `publication = 'published'`
 * requires — so only verified values ever reach a student. Anything else is
 * reported separately.
 */

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (url === undefined || url === '') {
  console.error('DATABASE_URL is required (point it at the reference database).');
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => undefined });

interface Row {
  readonly scheme_id: string;
  readonly branch_id: string;
  readonly semester: number;
  readonly subjects: number;
  readonly verified: number;
  readonly published: number;
  readonly see_true: number;
  readonly see_false: number;
}

const run = async (): Promise<void> => {
  const [schemes] = await sql<{ n: number }[]>`select count(*)::int as n from schemes`;
  const [branches] = await sql<{ n: number }[]>`select count(*)::int as n from branches`;

  const rows = (await sql`
    select scheme_id,
           branch_id,
           semester,
           count(*)::int                                              as subjects,
           count(*) filter (where verification = 'verified')::int     as verified,
           count(*) filter (where publication  = 'published')::int    as published,
           count(*) filter (where has_see)::int                       as see_true,
           count(*) filter (where not has_see)::int                   as see_false
      from subjects
     group by scheme_id, branch_id, semester
     order by scheme_id, branch_id, semester
  `) as unknown as Row[];

  console.log(`schemes  : ${String(schemes?.n ?? 0)}`);
  console.log(`branches : ${String(branches?.n ?? 0)}`);
  console.log(
    `subjects : ${String(rows.reduce((total, row) => total + row.subjects, 0))} across ${String(rows.length)} (scheme, branch, semester) group(s)\n`,
  );

  /*
   * EVERY SEMESTER IS LISTED, not only the ones with rows. A table of what
   * exists reads as complete; a table with six empty lines in it does not, and
   * the empty lines are the finding.
   */
  const pairs = [...new Set(rows.map((row) => `${row.scheme_id}/${row.branch_id}`))];
  if (pairs.length === 0) console.log('No subjects at all.');

  for (const pair of pairs) {
    console.log(`${pair}`);
    console.log('  sem  subjects  verified  published  SEE=true  SEE=false  credits');
    for (let semester = 1; semester <= 8; semester += 1) {
      const row = rows.find(
        (candidate) =>
          `${candidate.scheme_id}/${candidate.branch_id}` === pair &&
          candidate.semester === semester,
      );
      if (row === undefined) {
        console.log(
          `  ${String(semester).padStart(3)}         0         0          0         0          0  UNKNOWN`,
        );
        continue;
      }
      /*
       * Credits are counted as verified when the ROW is: the column is NOT
       * NULL, so its presence proves nothing on its own.
       */
      console.log(
        `  ${String(semester).padStart(3)}  ${String(row.subjects).padStart(8)}  ${String(row.verified).padStart(8)}  ${String(row.published).padStart(9)}  ${String(row.see_true).padStart(8)}  ${String(row.see_false).padStart(9)}  ${String(row.verified)} verified`,
      );
    }
    console.log('');
  }

  /* ---- The two fields that have no column at all ------------------------- */
  console.log('Fields with no storage in the reference schema:');
  console.log('  L / T / P (lecture, tutorial, practical hours) : UNKNOWN for every subject.');
  console.log('    A real college timetable prints BOTH the hours as taught and the hours as per');
  console.log(
    '    the VTU scheme, and they DIFFER — so this is two facts, not one, and neither is',
  );
  console.log('    stored. Adding a single L/T/P column would silently pick one of them.');

  /* ---- The gap that matters most to the marks engine --------------------- */
  const [cieOnly] = await sql<{ n: number }[]>`
    select count(*)::int as n from subjects where publication = 'published' and not has_see`;
  console.log('\nSEE applicability, as a student experiences it:');
  console.log(`  published subjects with has_see = false : ${String(cieOnly?.n ?? 0)}`);
  if ((cieOnly?.n ?? 0) === 0) {
    console.log('    NONE. The catalogue can currently only ever answer "this course has a SEE".');
    console.log('    A real card carries a CIE-only Physical Education row, so the one value that');
    console.log(
      '    most needs reference backing (DEC-037) has to be answered by the student today.',
    );
  }

  await sql.end();
};

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
