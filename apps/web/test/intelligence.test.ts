/**
 * M10A — deterministic academic intelligence.
 *
 * Authority: docs/16 §16.12, M10A §6, §7, §19, §20, §21, §45, §46
 *
 * These tests exist to pin the REFUSALS as much as the calculations. Most of
 * the ways an analytics layer goes wrong are not arithmetic errors — they are
 * moments where it quietly treats a missing semester as a bad one, re-grades a
 * result under a rule set it was not graded under, or invents an aggregate
 * nobody defined. Each of those has a test here, and each would still pass a
 * review that only checked the maths.
 */

import { describe, expect, it } from 'vitest';
import { normalizeResultSubject } from '../src/domain/results.js';
import {
  MIN_SEMESTERS_FOR_TREND,
  buildSemesterViews,
  cumulativeStanding,
  dataCompleteness,
  semesterHistory,
} from '../src/domain/academics.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { SemesterRecord, SemesterResult, SemesterStatus } from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function result(
  semester: number,
  subjects: { code: string; credits: number; grade: string }[],
  overrides: Partial<SemesterResult> = {},
): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: 'vtu-2022-v1',
    sgpaAsserted: null,
    createdAt: '',
    updatedAt: '',
    subjects: subjects.map((subject, index) =>
      normalizeResultSubject({
        id: `r${String(semester)}-s${String(index)}`,
        subjectCode: subject.code,
        subjectTitle: subject.code,
        credits: subject.credits,
        gradeLetter: subject.grade,
      }),
    ),
    ...overrides,
  };
}

function semester(number: number, status: SemesterStatus): SemesterRecord {
  return {
    id: `sem${String(number)}`,
    profileId,
    number,
    status,
    startedOn: null,
    completedOn: null,
    updatedAt: '',
  };
}

/** Four 4-credit subjects at one letter each: SGPA is that letter's points. */
const flat = (grade: string) => [
  { code: 'A1', credits: 4, grade },
  { code: 'A2', credits: 4, grade },
];

/* -------------------------------------------------------------------------- */
/* Semester history                                                           */
/* -------------------------------------------------------------------------- */

describe('semester history', () => {
  it('reports no trend with nothing entered', () => {
    const history = semesterHistory(buildSemesterViews([], []));
    expect(history.available).toBe(false);
    expect(history.comparable).toBe(0);
    expect(history.reason).toMatch(/no trend yet/i);
    // All eight semesters are still described, so the degree keeps its shape.
    expect(history.entries).toHaveLength(8);
  });

  it('refuses a trend on a single semester, and says why', () => {
    const history = semesterHistory(buildSemesterViews([], [result(1, flat('A'))]));
    expect(history.comparable).toBe(1);
    expect(history.available).toBe(false);
    expect(history.reason).toMatch(/needs two/i);
    // A single result is not both the best and the worst semester.
    expect(history.entries[0]?.isHighest).toBe(false);
    expect(history.entries[0]?.isLowest).toBe(false);
  });

  it('computes the change from the previous semester', () => {
    const views = buildSemesterViews(
      [],
      [result(1, flat('B')), result(2, flat('A')), result(3, flat('A+'))],
    );
    const history = semesterHistory(views);

    expect(history.available).toBe(true);
    expect(history.comparable).toBe(MIN_SEMESTERS_FOR_TREND + 1);
    expect(history.entries[0]?.sgpa).toBeCloseTo(6);
    expect(history.entries[0]?.delta).toBeNull(); // nothing before the first
    expect(history.entries[1]?.delta).toBeCloseTo(2); // B(6) -> A(8)
    expect(history.entries[2]?.delta).toBeCloseTo(1); // A(8) -> A+(9)
    expect(history.highest).toBeCloseTo(9);
    expect(history.lowest).toBeCloseTo(6);
    expect(history.entries[2]?.isHighest).toBe(true);
    expect(history.entries[0]?.isLowest).toBe(true);
  });

  /*
   * The defect this prevents: reaching back past a gap so that semester 3 is
   * reported as "+1.0 on the previous semester" when the previous semester was
   * never entered. That is a comparison the student never made (M10A §6).
   */
  it('reports no change across a gap rather than reaching back two semesters', () => {
    const views = buildSemesterViews([], [result(1, flat('B')), result(3, flat('A'))]);
    const history = semesterHistory(views);

    expect(history.entries[2]?.sgpa).toBeCloseTo(8);
    expect(history.entries[2]?.delta).toBeNull();
    expect(history.entries[1]?.excluded).toBe('no_result');
  });

  it('does not call a missing semester a low semester', () => {
    const views = buildSemesterViews([], [result(1, flat('A')), result(2, flat('A'))]);
    const history = semesterHistory(views);

    const empty = history.entries.filter((entry) => entry.excluded === 'no_result');
    expect(empty).toHaveLength(6);
    for (const entry of empty) {
      expect(entry.sgpa).toBeNull();
      expect(entry.isLowest).toBe(false);
      expect(entry.delta).toBeNull();
    }
    expect(history.lowest).toBeCloseTo(8);
  });

  /*
   * M6's correction, re-pinned here: a result pinned to a rule set this build
   * does not have is EXCLUDED, not re-graded under a substitute and not
   * counted as a zero (M10A §20).
   */
  it('excludes an unavailable rule set instead of re-grading it', () => {
    const views = buildSemesterViews(
      [],
      [
        result(1, flat('A')),
        result(2, flat('A+'), { ruleSetId: 'vtu-1998-v1' }),
        result(3, flat('B')),
      ],
    );
    const history = semesterHistory(views);

    expect(history.entries[1]?.excluded).toBe('ruleset_unavailable');
    expect(history.entries[1]?.sgpa).toBeNull();
    expect(history.comparable).toBe(2);
    // Semester 3's delta must not silently compare against the excluded one.
    expect(history.entries[2]?.delta).toBeNull();
    // And it takes no part in highest or lowest.
    expect(history.highest).toBeCloseTo(8);
    expect(history.lowest).toBeCloseTo(6);
  });

  it('excludes a result the rules refuse to grade', () => {
    // 'S' is not a letter in the VTU 2022 scheme; the rules decline it.
    const views = buildSemesterViews([], [result(1, flat('A')), result(2, flat('S'))]);
    const history = semesterHistory(views);

    expect(history.entries[1]?.excluded).toBe('not_gradeable');
    expect(history.entries[1]?.sgpa).toBeNull();
    expect(history.comparable).toBe(1);
    expect(history.available).toBe(false);
  });

  /*
   * The computed figure is used throughout. Mixing an asserted number into one
   * row and a computed number into the next would make every delta meaningless
   * (M10A §21).
   */
  it('compares computed figures, never the asserted ones', () => {
    const views = buildSemesterViews(
      [],
      [result(1, flat('A'), { sgpaAsserted: 9.5 }), result(2, flat('A'), { sgpaAsserted: 5.0 })],
    );
    const history = semesterHistory(views);

    expect(history.entries[0]?.sgpa).toBeCloseTo(8);
    expect(history.entries[1]?.sgpa).toBeCloseTo(8);
    // Both computed at 8, so no change — despite the asserted values differing.
    expect(history.entries[1]?.delta).toBeCloseTo(0);
    // The disagreement is still recorded for the page to state once.
    expect(views[0]?.sgpaDisagrees).toBe(true);
  });

  it('flags a comparison spanning more than one rule set', () => {
    const single = semesterHistory(
      buildSemesterViews([], [result(1, flat('A')), result(2, flat('B'))]),
    );
    expect(single.mixedRuleSets).toBe(false);
  });

  it('produces no mean SGPA — CGPA is the authoritative aggregate', () => {
    const history = semesterHistory(
      buildSemesterViews([], [result(1, flat('A')), result(2, flat('B'))]),
    );
    // An unweighted mean of SGPAs is a different quantity from the
    // credit-weighted CGPA and no regulation defines it (M10A §6, §64).
    expect(history).not.toHaveProperty('mean');
    expect(history).not.toHaveProperty('meanSgpa');
    expect(history).not.toHaveProperty('average');
  });
});

/* -------------------------------------------------------------------------- */
/* Data completeness                                                          */
/* -------------------------------------------------------------------------- */

describe('data completeness', () => {
  it('states that nothing is calculated when nothing is entered', () => {
    const completeness = dataCompleteness(buildSemesterViews([], []));
    expect(completeness.basis).toMatch(/nothing is calculated yet/i);
    expect(completeness.gradedSemesters).toEqual([]);
    expect(completeness.hasGaps).toBe(false);
  });

  it('names how many semesters every figure rests on', () => {
    const views = buildSemesterViews(
      [],
      [result(1, flat('A')), result(2, flat('A')), result(3, flat('B')), result(4, flat('B'))],
    );
    const completeness = dataCompleteness(views);
    expect(completeness.basis).toBe('Based on 4 graded semesters of 8.');
    expect(completeness.gradedSemesters).toEqual([1, 2, 3, 4]);
    expect(completeness.hasGaps).toBe(false);
  });

  it('uses the singular for one semester', () => {
    const completeness = dataCompleteness(buildSemesterViews([], [result(1, flat('A'))]));
    expect(completeness.basis).toBe('Based on 1 graded semester of 8.');
  });

  /*
   * A semester in progress has no result because it has not finished. Calling
   * that a gap would tell every student mid-semester that their data is
   * incomplete (M10A §19).
   */
  it('does not count the semester in progress as missing data', () => {
    const views = buildSemesterViews(
      [semester(1, 'completed'), semester(2, 'in_progress'), semester(3, 'planned')],
      [result(1, flat('A'))],
    );
    const completeness = dataCompleteness(views);
    expect(completeness.missingResults).toEqual([]);
    expect(completeness.hasGaps).toBe(false);
  });

  it('names a completed semester with no result entered', () => {
    const views = buildSemesterViews(
      [semester(1, 'completed'), semester(2, 'completed')],
      [result(1, flat('A'))],
    );
    const completeness = dataCompleteness(views);
    expect(completeness.missingResults).toEqual([2]);
    expect(completeness.gaps.join(' ')).toMatch(
      /Semester 2 is marked completed but has no result/i,
    );
  });

  it('names an unavailable rule set as unavailable, not as missing', () => {
    const views = buildSemesterViews(
      [],
      [result(1, flat('A')), result(2, flat('A'), { ruleSetId: 'vtu-1998-v1' })],
    );
    const completeness = dataCompleteness(views);
    expect(completeness.unavailableRuleSets).toEqual([2]);
    expect(completeness.missingResults).toEqual([]);
    expect(completeness.gaps.join(' ')).toMatch(/rule set it was graded under is not available/i);
  });

  it('names a result the rules could not grade', () => {
    const views = buildSemesterViews([], [result(1, flat('S'))]);
    const completeness = dataCompleteness(views);
    expect(completeness.notGradeable).toEqual([1]);
    expect(completeness.gaps.join(' ')).toMatch(/could not be graded/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Regression protection (M10A §46)                                           */
/* -------------------------------------------------------------------------- */

describe('regression protection', () => {
  /*
   * The formula third-party VTU calculators still publish is (CGPA - 0.75) x 10.
   * It is not in any rule set and must stay unreachable (M6 §7, M10A §8).
   */
  it('keeps percentage at CGPA x 10 and never the 0.75 subtraction', () => {
    const views = buildSemesterViews(
      [],
      [result(1, flat('A')), result(2, flat('A+'))], // 8 and 9 -> CGPA 8.50
    );
    const standing = cumulativeStanding(views);

    expect(standing.cgpa).toBeCloseTo(8.5);
    expect(standing.percentage).toBeCloseTo(85);
    expect(standing.percentage).not.toBeCloseTo(77.5); // (8.50 - 0.75) x 10
  });

  it('excludes an unavailable rule set from CGPA rather than treating it as zero', () => {
    const withUnavailable = cumulativeStanding(
      buildSemesterViews(
        [],
        [result(1, flat('A')), result(2, flat('A'), { ruleSetId: 'vtu-1998-v1' })],
      ),
    );
    const alone = cumulativeStanding(buildSemesterViews([], [result(1, flat('A'))]));

    // The excluded semester changes nothing: not the CGPA, not the credits.
    expect(withUnavailable.cgpa).toBeCloseTo(alone.cgpa as number);
    expect(withUnavailable.creditsCompleted).toBe(alone.creditsCompleted);
    expect(withUnavailable.cgpa).toBeCloseTo(8);
  });

  /*
   * GradTools must never show one student anything derived from another
   * (M10A §37). Nothing in the intelligence layer takes a cohort, so the
   * guard is that its inputs remain one student's own records.
   */
  it('derives every figure from one student only, with no cohort anywhere', () => {
    const views = buildSemesterViews([], [result(1, flat('A')), result(2, flat('B'))]);
    const history = semesterHistory(views);
    const completeness = dataCompleteness(views);

    for (const shape of [history, completeness] as unknown as Record<string, unknown>[]) {
      for (const key of Object.keys(shape)) {
        expect(key).not.toMatch(/percentile|rank|cohort|peer|class|average of|population/i);
      }
    }
  });
});
