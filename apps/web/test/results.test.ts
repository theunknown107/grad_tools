/**
 * The result model: what a card can say, and what may be concluded from it.
 *
 * Authority: docs/22 §22.39 (OQ-049) · docs/32 OQ-049, DEC-037
 *
 * ---------------------------------------------------------------------------
 * THE CASES THAT MATTER ARE THE ONES WHERE A GUESS WOULD LOOK RIGHT
 * ---------------------------------------------------------------------------
 *
 * Two marks rows in this file are IDENTICAL — internal high, external zero —
 * and have opposite correct answers depending on whether the course has a
 * semester-end examination. No arithmetic separates them. A model that fills in
 * `hasSee` from the marks passes every plausible-looking test and tells a real
 * student they have a backlog in a course the university passed them in.
 *
 * Marks here are invented. The SHAPES come from real result cards; the values
 * do not, and no real student's marks appear in this repository.
 */

import { describe, expect, it } from 'vitest';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import {
  evaluateResultSubject,
  normalizeResultSubject,
  semesterBacklogs,
  semesterSgpa,
  sgpaInputs,
  validateResultSubject,
} from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { ResultSubject, SemesterResult } from '../src/domain/types.js';

const ruleSet = vtu2022RuleSet;
const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function subject(overrides: Partial<ResultSubject> = {}): ResultSubject {
  return normalizeResultSubject({
    id: 's1',
    subjectCode: 'BCS301',
    subjectTitle: 'Mathematics',
    ...overrides,
  });
}

function result(subjects: readonly ResultSubject[]): SemesterResult {
  return {
    id: 'r1',
    profileId,
    semester: 4,
    schemeId: 'vtu-2022',
    ruleSetId: ruleSet.id,
    sgpaAsserted: null,
    subjects,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/* -------------------------------------------------------------------------- */

describe('reading a stored row', () => {
  it('keeps a pre-OQ-049 row whole, and leaves its marks missing rather than zero', () => {
    /*
     * The migration case. A row saved when the model required credits and a
     * grade and could hold no marks. Its two real values survive; the five it
     * never had read as absent — a zero would say the student scored nothing.
     */
    const legacy = normalizeResultSubject({
      id: 'old',
      subjectCode: 'BCS301',
      subjectTitle: 'Mathematics',
      credits: 4,
      gradeLetter: 'A',
    });

    expect(legacy.credits).toBe(4);
    expect(legacy.gradeLetter).toBe('A');
    expect(legacy.internal).toBeNull();
    expect(legacy.external).toBeNull();
    expect(legacy.total).toBeNull();
    expect(legacy.resultStatus).toBeNull();
    expect(legacy.hasSee).toBeNull();
    expect(legacy.provenance).toBe('manual');
  });

  it('reads a numeric column that arrived as a string', () => {
    // `numeric` comes back from postgres.js as text, and a form input is text.
    // Rejecting either would empty every synced credit on the second device.
    const row = normalizeResultSubject({
      id: 'a',
      subjectCode: 'X',
      credits: '4.0',
      internal: '38',
    });
    expect(row.credits).toBe(4);
    expect(row.internal).toBe(38);
  });

  it('reads a date column as the calendar day it names', () => {
    const row = normalizeResultSubject({
      id: 'a',
      subjectCode: 'X',
      announcedOn: new Date('2026-07-23T00:00:00Z'),
    });
    expect(row.announcedOn).toBe('2026-07-23');
  });

  it('turns an empty field into a missing one, not a zero', () => {
    const row = normalizeResultSubject({ id: 'a', subjectCode: 'X', internal: '', credits: '' });
    expect(row.internal).toBeNull();
    expect(row.credits).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('validation', () => {
  it('accepts a row carrying only what a provisional card printed', () => {
    // No grade, no grade point, no credits, no SGPA — and it saves. This is the
    // whole of OQ-049 in one assertion.
    const issues = validateResultSubject(
      subject({ internal: 38, external: 18, total: 56, resultStatus: 'P' }),
      ruleSet,
    );
    expect(issues).toEqual([]);
  });

  it('refuses a total that does not equal internal + external', () => {
    const issues = validateResultSubject(
      subject({ internal: 38, external: 18, total: 57 }),
      ruleSet,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('total');
    expect(issues[0]?.message).toMatch(/does not match/i);
  });

  it('does not demand the other side when only one mark is present', () => {
    /*
     * MISSING IS NOT INVALID. A student typing in a card one column at a time,
     * or a card that prints only a CIE, must not be blocked — and demanding the
     * absent number is how a model teaches people to type a zero.
     */
    expect(validateResultSubject(subject({ internal: 38 }), ruleSet)).toEqual([]);
    expect(validateResultSubject(subject({ total: 56 }), ruleSet)).toEqual([]);
  });

  it('bounds the SEE contribution at 50, not at the course maximum', () => {
    const issues = validateResultSubject(subject({ hasSee: true, external: 60 }), ruleSet);
    expect(issues.map((issue) => issue.field)).toEqual(['external']);
  });

  it('allows a CIE-only course an internal above the ordinary CIE maximum', () => {
    /*
     * A real card carries a Physical Education row whose internal is far above
     * 50, because a course with no SEE is assessed on CIE over the whole 100
     * (22OB 6.1(3)). Bounding every internal at 50 would refuse a printed row.
     */
    expect(validateResultSubject(subject({ hasSee: false, internal: 96 }), ruleSet)).toEqual([]);
    expect(
      validateResultSubject(subject({ hasSee: true, internal: 96 }), ruleSet).map((i) => i.field),
    ).toEqual(['internal']);
  });

  it('rejects negative marks, an impossible credit and a malformed date', () => {
    const issues = validateResultSubject(
      subject({ internal: -1, credits: 99, announcedOn: '23-07-2026' }),
      ruleSet,
    );
    expect(issues.map((issue) => issue.field).sort()).toEqual([
      'announcedOn',
      'credits',
      'internal',
    ]);
  });

  it('requires a subject code and nothing else', () => {
    const issues = validateResultSubject(subject({ subjectCode: '  ' }), ruleSet);
    expect(issues.map((issue) => issue.field)).toEqual(['subjectCode']);
  });
});

/* -------------------------------------------------------------------------- */

describe('backlog and SEE applicability', () => {
  /*
   * The SEE minimum is 35% of the 50-mark contribution — 17.5 — so 17 fails and
   * 18 passes. The boundary is pinned in both directions because a threshold
   * that drifts by one mark misclassifies the students closest to it.
   */
  it('carries a course whose SEE contribution is 17', () => {
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 40, external: 17, total: 57 }),
      ruleSet,
    );
    expect(evaluation.backlog).toBe(true);
    expect(evaluation.outcome?.see).toBe('failed');
  });

  it('passes the same course at 18', () => {
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 40, external: 18, total: 58 }),
      ruleSet,
    );
    expect(evaluation.backlog).toBe(false);
    expect(evaluation.outcome?.see).toBe('passed');
  });

  it('does NOT carry a CIE-only course whose external is 0', () => {
    /*
     * THE REGRESSION THIS FILE EXISTS FOR. Read with a bare "external below the
     * minimum is a backlog", this row is a failure. The university printed it a
     * pass. There is no SEE to fall short of, so the head is not applicable —
     * not failed.
     */
    const evaluation = evaluateResultSubject(
      subject({ hasSee: false, internal: 96, external: 0, total: 96 }),
      ruleSet,
    );
    expect(evaluation.backlog).toBe(false);
    expect(evaluation.outcome?.see).toBe('not_applicable');
  });

  it('carries the IDENTICAL row when the course does have a SEE', () => {
    // Same three numbers, opposite answer. Only `hasSee` differs, which is why
    // it can never be inferred from the marks (DEC-037).
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 50, external: 0, total: 50 }),
      ruleSet,
    );
    expect(evaluation.backlog).toBe(true);
  });

  it('answers "not known" rather than guessing when SEE applicability is unrecorded', () => {
    const evaluation = evaluateResultSubject(
      subject({ hasSee: null, internal: 40, external: 0, total: 40 }),
      ruleSet,
    );
    expect(evaluation.backlog).toBeNull();
    expect(evaluation.unavailableReason).toMatch(/semester-end exam/i);
  });

  it('answers "not known" when a mark is missing', () => {
    const evaluation = evaluateResultSubject(subject({ hasSee: true, internal: 40 }), ruleSet);
    expect(evaluation.backlog).toBeNull();
  });

  it('reports an undetermined row separately from a passing one', () => {
    // A semester's backlog count must never quietly read as complete when a row
    // could not be checked.
    const summary = semesterBacklogs(
      result([
        subject({ id: 'a', hasSee: true, internal: 40, external: 17, total: 57 }),
        subject({ id: 'b', hasSee: null, internal: 40, external: 20, total: 60 }),
        subject({ id: 'c', hasSee: true, internal: 40, external: 30, total: 70 }),
      ]),
      ruleSet,
    );
    expect(summary).toEqual({ backlogs: 1, undetermined: 1 });
  });
});

/* -------------------------------------------------------------------------- */

describe('rule sets', () => {
  it('computes nothing at all when the rule set is unavailable', () => {
    /*
     * No substitution, in either direction (M6 §6). A pinned regulation this
     * build does not have leaves the row unevaluated rather than re-graded
     * under whatever is current.
     */
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 40, external: 30, total: 70 }),
      undefined,
    );
    expect(evaluation.backlog).toBeNull();
    expect(evaluation.outcome).toBeNull();
    expect(evaluation.computedGrade).toBeNull();
    expect(evaluation.unavailableReason).toMatch(/not available/i);
  });

  it('still reports the source grade a card printed, with no rule set to check it', () => {
    // The card said what it said. Losing that because GradTools cannot grade it
    // would discard a fact to protect a calculation.
    const evaluation = evaluateResultSubject(subject({ gradeLetter: 'A' }), undefined);
    expect(evaluation.sourceGrade).toEqual({ letter: 'A', points: null });
  });
});

/* -------------------------------------------------------------------------- */

describe('grade and grade point', () => {
  it('never overwrites a source grade with a calculated one', () => {
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 45, external: 45, total: 90, gradeLetter: 'B' }),
      ruleSet,
    );
    expect(evaluation.sourceGrade?.letter).toBe('B');
    expect(evaluation.computedGrade?.letter).toBe('O');
    expect(evaluation.gradeDisagrees).toBe(true);
  });

  it('keeps a source grade point over the rule set’s', () => {
    const evaluation = evaluateResultSubject(
      subject({ gradeLetter: 'A', gradePoint: 8.5 }),
      ruleSet,
    );
    expect(evaluation.sourceGrade).toEqual({ letter: 'A', points: 8.5 });
  });

  it('offers no calculated grade for a carried course', () => {
    /*
     * A course that failed a head is not graded on its percentage, and this
     * codebase holds no verified rule for what letter it earns. Refusing is the
     * honest answer; banding 57% into a pass grade would be an invention.
     */
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 40, external: 17, total: 57 }),
      ruleSet,
    );
    expect(evaluation.backlog).toBe(true);
    expect(evaluation.computedGrade).toBeNull();
  });

  it('never invents credits from marks, grade or subject name', () => {
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 45, external: 45, total: 90 }),
      ruleSet,
    );
    expect(evaluation.computedGrade?.letter).toBe('O');
    // A grade was computable; credits still are not, and stay absent.
    expect(subject({ hasSee: true, internal: 45 }).credits).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('the calculated total', () => {
  it('shows a printed total and a calculated one that disagree, and repairs neither', () => {
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 38, external: 18, total: 57 }),
      ruleSet,
    );
    expect(evaluation.computedTotal).toBe(56);
    expect(evaluation.totalDisagrees).toBe(true);
  });

  it('agrees silently when the columns add up', () => {
    const evaluation = evaluateResultSubject(
      subject({ hasSee: true, internal: 38, external: 18, total: 56 }),
      ruleSet,
    );
    expect(evaluation.totalDisagrees).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('SGPA from a semester', () => {
  function graded(count: number): ResultSubject[] {
    return Array.from({ length: count }, (_, index) =>
      subject({
        id: `s${String(index)}`,
        subjectCode: `BCS40${String(index)}`,
        credits: 4,
        gradeLetter: 'A',
      }),
    );
  }

  it('grades a semester of eight subjects', () => {
    // A real first semester. The count is not a setting and is not padded.
    const { sgpa, credits } = semesterSgpa(result(graded(8)), ruleSet);
    expect(sgpa).toBeCloseTo(8, 5);
    expect(credits).toBe(32);
  });

  it('grades a semester of nine subjects', () => {
    // A real fourth semester. Nothing anywhere assumes eight.
    const { sgpa, credits } = semesterSgpa(result(graded(9)), ruleSet);
    expect(sgpa).toBeCloseTo(8, 5);
    expect(credits).toBe(36);
  });

  it('refuses to grade a semester where one subject has no grade', () => {
    /*
     * A PARTIAL SGPA IS A WRONG SGPA. Grading the eight subjects that have
     * grades and ignoring the ninth produces a credit-weighted average of part
     * of a semester, presented as the whole thing.
     */
    const subjects = [...graded(8), subject({ id: 'x', subjectCode: 'BPEK459', credits: 0 })];
    const { sgpa, inputs } = semesterSgpa(result(subjects), ruleSet);

    expect(sgpa).toBeNull();
    expect(inputs.complete).toBe(false);
    expect(inputs.missing).toEqual([{ subjectCode: 'BPEK459', reason: 'no grade' }]);
  });

  it('names what is missing, so the student can finish it', () => {
    const subjects = [
      subject({ id: 'a', subjectCode: 'BCS401', gradeLetter: 'A' }),
      subject({ id: 'b', subjectCode: 'BCS402' }),
    ];
    expect(sgpaInputs(result(subjects)).missing).toEqual([
      { subjectCode: 'BCS401', reason: 'no credits' },
      { subjectCode: 'BCS402', reason: 'no grade or credits' },
    ]);
  });

  it('grades nothing from a provisional result, and keeps its marks', () => {
    /*
     * The end-to-end shape of a card copied faithfully: marks present, grades
     * absent, no SGPA — and the marks are still there to be read.
     */
    const provisional = result([
      subject({
        id: 'a',
        subjectCode: 'BCS401',
        internal: 44,
        external: 36,
        total: 80,
        resultStatus: 'P',
        hasSee: true,
      }),
      subject({
        id: 'b',
        subjectCode: 'BPEK459',
        internal: 96,
        external: 0,
        total: 96,
        resultStatus: 'P',
        hasSee: false,
      }),
    ]);

    expect(semesterSgpa(provisional, ruleSet).sgpa).toBeNull();
    expect(semesterBacklogs(provisional, ruleSet)).toEqual({ backlogs: 0, undetermined: 0 });
    expect(provisional.subjects[1]?.internal).toBe(96);
  });
});
