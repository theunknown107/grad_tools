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
 * `credits` and `has_see` were NOT NULL when this report was first written, so
 * every row carried a value and a naive count reported total coverage of
 * everything. That was a lie about an unverified row: `has_see` defaulted to
 * `true`, and a default is not a fact.
 *
 * Migration 0011 made both nullable and dropped that default, so the columns
 * can now answer honestly and this report counts what is actually there. A
 * value is KNOWN when it is non-null; a row is verified when its
 * `verification` says so, which is also what publication requires — so only
 * verified rows reach a student, though a verified row may still carry an
 * unknown field (OQ-052).
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
  readonly credits_known: number;
  readonly see_true: number;
  readonly see_false: number;
  readonly see_unknown: number;
  readonly ltp_known: number;
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
           count(*) filter (where credits is not null)::int           as credits_known,
           count(*) filter (where has_see)::int                       as see_true,
           count(*) filter (where has_see = false)::int               as see_false,
           count(*) filter (where has_see is null)::int               as see_unknown,
           count(*) filter (where scheme_lecture_hours is not null)::int as ltp_known
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
    console.log(
      '  sem  subjects  credits+  credits?  SEE=true  SEE=false     SEE=?  LTP+  LTP?  published',
    );
    const cell = (value: number, width: number) => String(value).padStart(width);
    for (let semester = 1; semester <= 8; semester += 1) {
      const row = rows.find(
        (candidate) =>
          `${candidate.scheme_id}/${candidate.branch_id}` === pair &&
          candidate.semester === semester,
      );
      /*
       * EVERY SEMESTER IS PRINTED, including the ones with no subjects at all.
       * A table of what exists reads as complete; a table with seven zero rows
       * in it does not, and the zero rows are the finding.
       */
      const counts =
        row === undefined
          ? {
              subjects: 0,
              creditsKnown: 0,
              seeTrue: 0,
              seeFalse: 0,
              seeUnknown: 0,
              ltpKnown: 0,
              published: 0,
            }
          : {
              subjects: row.subjects,
              creditsKnown: row.credits_known,
              seeTrue: row.see_true,
              seeFalse: row.see_false,
              seeUnknown: row.see_unknown,
              ltpKnown: row.ltp_known,
              published: row.published,
            };

      /*
       * LTP+ counts SCHEME hours, which is the only workload fact any source
       * here states. A college's delivered hours are a different fact with no
       * column, and this count must never be read as covering them.
       */
      console.log(
        `  ${String(semester).padStart(3)}  ${cell(counts.subjects, 8)}  ${cell(counts.creditsKnown, 8)}  ` +
          `${cell(counts.subjects - counts.creditsKnown, 8)}  ${cell(counts.seeTrue, 8)}  ` +
          `${cell(counts.seeFalse, 9)}  ${cell(counts.seeUnknown, 8)}  ${cell(counts.ltpKnown, 4)}  ` +
          `${cell(counts.subjects - counts.ltpKnown, 4)}  ${cell(counts.published, 9)}`,
      );
    }
    console.log('');
  }

  /* ---- What the workload columns do and do not cover --------------------- */
  const [taught] = await sql<{ n: number }[]>`select count(*)::int as n from subjects`;
  console.log('Workload hours:');
  console.log('  scheme L/T/P  : stored, where a scheme of teaching states it.');
  console.log(
    `  taught L/T/P  : NO COLUMN, so unknown for all ${String(taught?.n ?? 0)} subjects.`,
  );
  console.log('    A real college timetable prints BOTH, and they DIFFER — one course is');
  console.log('    delivered 3+0+2 against a scheme of 2+0+2. They are two facts about two');
  console.log('    different things, and the scheme column must not be read as covering both.');

  /* ---- The gap that matters most to the marks engine --------------------- */
  const [see] = await sql<{ known: number; unknown: number }[]>`
    select count(*) filter (where has_see is not null)::int as known,
           count(*) filter (where has_see is null)::int     as unknown
      from subjects where publication = 'published'`;
  console.log('\nSEE applicability, as a student experiences it:');
  console.log(`  published subjects with has_see established : ${String(see?.known ?? 0)}`);
  console.log(`  published subjects with has_see UNKNOWN     : ${String(see?.unknown ?? 0)}`);
  if ((see?.known ?? 0) === 0) {
    console.log('    The catalogue answers this for NO subject, so a student supplies it per row.');
    console.log('    That is a smaller product than an asserted default, and a truthful one: a');
    console.log('    wrongly asserted "has a SEE" reports a backlog in a course that was passed.');
  }

  /* ---- Where the facts came from (M10A.2 section 9) ---------------------- */
  const sources = await sql<
    { source_url: string; verified_by: string | null; verification: string; n: number }[]
  >`
    select source_url, verified_by, verification::text as verification, count(*)::int as n
      from subjects group by 1, 2, 3 order by 4 desc`;
  console.log('\nProvenance of every subject row:');
  for (const row of sources) {
    console.log(
      `  ${String(row.n).padStart(3)}  ${row.verification.padEnd(10)}  ${row.source_url}`,
    );
    console.log(`       verified by: ${row.verified_by ?? '(nobody)'}`);
  }
  console.log('\n  Verified-per-fact is claimed ONLY where a clause was read for that field.');
  console.log("  Credits were checked against the document's own printed total; SEE");
  console.log('  applicability never was, which is why it is now NULL rather than true.');

  await sql.end();
};

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
