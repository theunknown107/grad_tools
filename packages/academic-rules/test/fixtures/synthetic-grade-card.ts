/**
 * SYNTHETIC grade-card fixture.
 *
 * Authority: docs/32 OQ-024 · docs/16 §16.11
 *
 * ---------------------------------------------------------------------------
 * EVERY NUMBER BELOW IS INVENTED. THIS IS NOT A REAL STUDENT'S RESULT.
 * ---------------------------------------------------------------------------
 *
 * This fixture replaces one that carried a real VTU provisional result — the
 * project owner's own semester-4 record, subject by subject — in a PUBLIC
 * repository. The engineering finding that record produced is worth keeping.
 * The record is not. See docs/12 for the privacy boundary this enforces:
 *
 *   a real artifact may be used for PRIVATE validation
 *   only synthetic data may be committed for PUBLIC tests
 *
 * So the rows here are constructed, not transcribed. They are shaped to
 * reproduce the STRUCTURE that the real artifact exhibited — nine rows, a
 * decisive row that settles the printed SEE scale, a CIE-only course, and
 * totals landing on the grade-band edges — without reproducing any of its
 * values.
 *
 * WHAT THIS FIXTURE CAN AND CANNOT DO
 *
 * It PINS the conclusions already drawn from the real document, so a later
 * refactor cannot silently reverse them. It does NOT independently corroborate
 * them: invented data cannot be evidence about what VTU prints. The
 * corroboration happened once, privately, against the real artifact, and is
 * recorded in docs/16 §16.11 as a historical finding rather than re-derived
 * here. Any test below that reads like proof is a REGRESSION GUARD.
 *
 * CONSTRUCTION RULES (why these particular numbers)
 *
 *   - total = internal + external on every row.
 *   - Eight rows are ordinary CIE + SEE and satisfy all three heads of
 *     22OB 6.3, so each is a pass: internal >= 20, external >= 18, total >= 40.
 *   - `BXXX401` is the decisive row for the printed-scale question. Its
 *     external of 21 is below the 35-mark SEE minimum when misread as a raw
 *     mark out of 100, and comfortably above it (42%) when read correctly as a
 *     contribution out of 50. A pass is only consistent with the second
 *     reading.
 *   - `BXXX459` is the CIE-only course (22OB 6.1(3)): its internal of 72
 *     exceeds the ordinary CIE maximum of 50 and its external is 0 — a
 *     combination impossible under the ordinary structure, which is the whole
 *     point of modelling it separately.
 *   - Totals include 59, 79 and 80. Those are edges of the rule set's own
 *     grade bands (top of B, top of A, bottom of A+ — see the band table in
 *     `rulesets/vtu-2022.ts`), chosen deliberately here. They are properties
 *     of the regulation, not values carried over from anybody's card.
 *
 * Subject codes and names are deliberately generic (`BXXXnnn`) so that no
 * real course list is reproduced either.
 */

/** One row of the synthetic card. */
export interface GradeCardRowFixture {
  readonly subjectCode: string;
  readonly subjectName: string;
  readonly internal: number;
  readonly external: number;
  readonly total: number;
  readonly result: string;
}

export const SYNTHETIC_GRADE_CARD = {
  source: 'SYNTHETIC_GRADE_CARD',
  artifactType: 'Synthetic result, shaped like a VTU provisional result (UG)',
  semester: 4,
  rows: [
    {
      subjectCode: 'BXXX401',
      subjectName: 'CORE COURSE ONE',
      internal: 38,
      external: 21,
      total: 59,
      result: 'P',
    },
    {
      subjectCode: 'BXXX402',
      subjectName: 'CORE COURSE TWO',
      internal: 40,
      external: 23,
      total: 63,
      result: 'P',
    },
    {
      subjectCode: 'BXXX403',
      subjectName: 'CORE COURSE THREE',
      internal: 46,
      external: 20,
      total: 66,
      result: 'P',
    },
    {
      subjectCode: 'BXXL404',
      subjectName: 'LABORATORY COURSE',
      internal: 41,
      external: 30,
      total: 71,
      result: 'P',
    },
    {
      subjectCode: 'BXXX405',
      subjectName: 'INTEGRATED COURSE',
      internal: 45,
      external: 34,
      total: 79,
      result: 'P',
    },
    {
      subjectCode: 'BXXX406',
      subjectName: 'HUMANITIES COURSE',
      internal: 46,
      external: 34,
      total: 80,
      result: 'P',
    },
    {
      subjectCode: 'BXXX407B',
      subjectName: 'PROFESSIONAL ELECTIVE',
      internal: 47,
      external: 41,
      total: 88,
      result: 'P',
    },
    {
      subjectCode: 'BXXX408D',
      subjectName: 'OPEN ELECTIVE',
      internal: 44,
      external: 48,
      total: 92,
      result: 'P',
    },
    {
      subjectCode: 'BXXX459',
      subjectName: 'MANDATORY NON-SEE COURSE',
      internal: 72,
      external: 0,
      total: 72,
      result: 'P',
    },
  ] satisfies readonly GradeCardRowFixture[],
} as const;

/**
 * The one row that is not assessed by CIE + SEE.
 *
 * Its internal exceeds the CIE maximum of 50 while its external is 0, and it
 * still passes — the shape 22OB 6.1(3) describes for a course assessed on CIE
 * alone over the full course maximum.
 *
 * The tests identify it STRUCTURALLY — internal above `cieMax`, zero external,
 * a pass — rather than by matching this constant, so they assert the
 * regulation's rule rather than this fixture's contents.
 */
export const NO_SEE_SUBJECT_CODE = 'BXXX459';
