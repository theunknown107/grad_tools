/**
 * Regression guards for the findings a real VTU grade card produced.
 *
 * Authority: docs/16 §16.11 · docs/32 OQ-024
 *
 * WHAT CHANGED, AND WHY IT MATTERS FOR HOW YOU READ THIS FILE
 *
 * This file once ran against a real VTU provisional result committed to a
 * PUBLIC repository — a real student's marks, subject by subject. That fixture
 * has been replaced with a synthetic one (docs/12). The assertions are
 * unchanged; their epistemic status is not, and pretending otherwise would be
 * the dishonest way to do this.
 *
 *   BEFORE  a real document was the evidence, and these tests CHECKED our
 *           reading of the regulation against something VTU actually issued.
 *   NOW     the findings are settled and recorded in docs/16 §16.11, and these
 *           tests PIN them so a refactor cannot silently reverse them.
 *
 * Invented data cannot corroborate a claim about what VTU prints. Every test
 * below is therefore a regression guard, not evidence. The corroboration
 * happened once, privately, against the real artifact.
 *
 * SCOPE. The shape being modelled carries subject codes, internal marks,
 * external marks, totals and per-subject result status — and NO credits, NO
 * letter grades, NO grade points, NO SGPA and NO CGPA. So nothing here touches
 * the SGPA or CGPA formulas or the grade-band table.
 */

import { describe, expect, it } from 'vitest';
import { validateCourseMarks } from '../src/marks.js';
import { vtu2022RuleSet } from '../src/rulesets/vtu-2022.js';
import { isOk } from '../src/result.js';
import { NO_SEE_SUBJECT_CODE, SYNTHETIC_GRADE_CARD } from './fixtures/synthetic-grade-card.js';

const rs = vtu2022RuleSet;
const seeWeight = rs.courseMax - rs.cieMax;

/** Rows assessed by CIE + SEE, i.e. everything except the no-SEE course. */
const seeRows = SYNTHETIC_GRADE_CARD.rows.filter((row) => row.subjectCode !== NO_SEE_SUBJECT_CODE);
/**
 * Resolved eagerly and thrown on rather than defaulted: if the no-SEE row ever
 * disappears from the fixture, these tests must fail loudly instead of quietly
 * re-testing an unrelated row.
 */
const noSeeRow = SYNTHETIC_GRADE_CARD.rows.find((row) => row.subjectCode === NO_SEE_SUBJECT_CODE);
if (noSeeRow === undefined) throw new Error(`Fixture is missing ${NO_SEE_SUBJECT_CODE}.`);

describe('synthetic grade card — provenance', () => {
  it('is labelled synthetic and contains no identifying field', () => {
    // If this ever reads REAL_VTU_GRADE_CARD again, a real record has been
    // committed to a public repository. That is the failure this pins.
    expect(SYNTHETIC_GRADE_CARD.source).toBe('SYNTHETIC_GRADE_CARD');
    expect(SYNTHETIC_GRADE_CARD.semester).toBe(4);

    // The fixture must never grow a personal field. Asserting the exact key set
    // makes an accidental addition fail here rather than reach a commit.
    for (const row of SYNTHETIC_GRADE_CARD.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'external',
        'internal',
        'result',
        'subjectCode',
        'subjectName',
        'total',
      ]);
    }

    // `subjectName` legitimately contains the word "name", so this targets the
    // identifying FIELDS, not a substring.
    //
    // Deliberately NOT written as a list of forbidden values: spelling a real
    // name or USN here to assert its absence would commit exactly the data this
    // fixture exists to keep out of the repository.
    const keys = new Set(SYNTHETIC_GRADE_CARD.rows.flatMap((row) => Object.keys(row)));
    for (const identifying of ['studentName', 'usn', 'seatNumber', 'dob', 'email', 'phone']) {
      expect(keys.has(identifying)).toBe(false);
    }

    // A USN is 10 characters, digits and letters, e.g. 1AB22CS001. No field may
    // hold anything of that shape.
    const usnShaped = /\b\d[A-Z]{2}\d{2}[A-Z]{2}\d{3}\b/i;
    for (const row of SYNTHETIC_GRADE_CARD.rows) {
      for (const value of Object.values(row)) {
        expect(usnShaped.test(String(value))).toBe(false);
      }
    }
  });

  it('records no credits, grades, SGPA or CGPA, because none are printed', () => {
    const serialised = JSON.stringify(SYNTHETIC_GRADE_CARD).toLowerCase();
    for (const absent of ['credit', 'sgpa', 'cgpa', 'gradepoint', 'gradeletter']) {
      expect(serialised).not.toContain(absent);
    }
  });
});

describe('synthetic grade card — arithmetic', () => {
  it.each(SYNTHETIC_GRADE_CARD.rows)(
    '$subjectCode: total equals internal + external',
    ({ internal, external, total }) => {
      expect(internal + external).toBe(total);
    },
  );

  it('every row validates against the 2022 rule set', () => {
    for (const row of SYNTHETIC_GRADE_CARD.rows) {
      const hasSee = row.subjectCode !== NO_SEE_SUBJECT_CODE;
      const result = validateCourseMarks(row, rs, { hasSee });
      expect({ code: row.subjectCode, ok: isOk(result) }).toEqual({
        code: row.subjectCode,
        ok: true,
      });
    }
  });
});

/**
 * The finding that justified this whole exercise.
 *
 * docs/16 §16.5 once asserted that the raw SEE mark out of 100 "is the number a
 * student actually sees on a grade card". The real artifact showed it is not:
 * the printed external column is the SEE's contribution out of 50. That was
 * established against the real document and is recorded in docs/16 §16.11.
 *
 * `BXXX401` is constructed to make the distinction decisive. Its external is 21
 * against a printed P. Read as a raw SEE out of 100, 21% falls below the 35% SEE
 * minimum and the course would have to be a fail; read as a contribution out of
 * 50, it is 42% and passes. Only the second reading is consistent with the pass,
 * so a regression to the out-of-100 reading fails here.
 */
describe('synthetic grade card — the printed external scale', () => {
  const decisive = seeRows.find((row) => row.subjectCode === 'BXXX401');

  it('has the decisive row', () => {
    expect(decisive).toBeDefined();
  });

  it('printed externals never exceed the SEE contribution maximum of 50', () => {
    for (const row of seeRows) {
      expect(row.external).toBeLessThanOrEqual(seeWeight);
    }
  });

  it('reading the external as a raw SEE out of 100 contradicts the printed P', () => {
    const external = decisive?.external ?? 0;

    const asRawSee = (external / rs.seeMax) * 100;
    expect(asRawSee).toBeLessThan(rs.seeMinPct); // 21% — would be a fail
    expect(decisive?.result).toBe('P'); // but the row is a pass

    const asContribution = (external / seeWeight) * 100;
    expect(asContribution).toBeGreaterThanOrEqual(rs.seeMinPct); // 42% — passes
  });
});

/**
 * The three simultaneous passing thresholds (22OB 6.3). Every SEE-assessed row
 * is constructed as a pass, so every row must satisfy all three — a threshold
 * that drifted too strict would fail here. On the real artifact this same check
 * had force as evidence, because contradicting it would have contradicted a
 * document VTU issued.
 */
describe('synthetic grade card — passing standards (22OB 6.3)', () => {
  it.each(seeRows)(
    '$subjectCode: satisfies CIE, SEE and overall minimums, matching the printed P',
    ({ internal, external, total, result }) => {
      expect(result).toBe('P');
      expect((internal / rs.cieMax) * 100).toBeGreaterThanOrEqual(rs.cieMinPct);
      expect((external / seeWeight) * 100).toBeGreaterThanOrEqual(rs.seeMinPct);
      expect((total / rs.courseMax) * 100).toBeGreaterThanOrEqual(rs.overallMinPct);
    },
  );
});

/**
 * 22OB 6.1(3) — "If there is no SEE for a course, then the CIE marks alone will
 * be the basis for the determination of letter grade."
 *
 * Corroborated privately against the real artifact, which carried a Physical
 * Education row whose internal exceeded the CIE maximum of 50, whose external
 * was 0, and which was printed P. Under the ordinary CIE + SEE structure such a
 * row is doubly impossible — which is the evidence that a separate structure
 * exists and that the model needs the distinction. The synthetic row below
 * reproduces that shape; the real marks are not recorded anywhere in this
 * repository.
 */
describe('synthetic grade card — a course with no SEE (22OB 6.1(3))', () => {
  it('is impossible under the ordinary structure', () => {
    expect(noSeeRow.internal).toBeGreaterThan(rs.cieMax);
    expect(noSeeRow.external).toBe(0);
    expect(noSeeRow.result).toBe('P');

    // Zero external is below the SEE minimum, yet the course passed.
    expect(0).toBeLessThan((rs.seeMinPct / 100) * seeWeight);
  });

  it('is rejected when validated as an ordinary CIE + SEE course', () => {
    const asOrdinary = validateCourseMarks(noSeeRow, rs, { hasSee: true });
    expect(isOk(asOrdinary)).toBe(false);
  });

  it('validates once modelled as having no SEE', () => {
    const asNoSee = validateCourseMarks(noSeeRow, rs, { hasSee: false });
    expect(isOk(asNoSee)).toBe(true);
  });
});

/**
 * Which grade-band edges the totals land on — recorded, NOT asserted.
 *
 * 59, 79 and 80 are the boundaries docs/16 §16.3 calls out as the ones
 * third-party calculators get wrong (top of B, top of A, bottom of A+). The
 * fixture is deliberately built to land on them, so that the moment a real card
 * WITH letter grades can be inspected privately, it is obvious which rows to
 * compare. It still validates nothing on its own: no letter grades are printed
 * on the shape being modelled, and invented totals cannot test a band table.
 */
describe('synthetic grade card — grade bands are NOT validated by this artifact', () => {
  it('prints no letter grade on any row', () => {
    for (const row of SYNTHETIC_GRADE_CARD.rows) {
      expect(row).not.toHaveProperty('gradeLetter');
      expect(row).not.toHaveProperty('gradePoints');
    }
  });

  it('lands on the boundaries that a future artifact could validate', () => {
    const totals = SYNTHETIC_GRADE_CARD.rows.map((row) => row.total).sort((a, b) => a - b);
    expect(totals).toEqual([59, 63, 66, 71, 72, 79, 80, 88, 92]);

    // 59 is the top of B, 79 the top of A, 80 the bottom of A+.
    for (const edge of [59, 79, 80]) {
      expect(totals).toContain(edge);
    }
  });
});
