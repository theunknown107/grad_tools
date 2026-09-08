/**
 * The one derived academic state, and what it refuses to make up.
 *
 * Authority: Phase 7C §1, §4, §5, §6, §7, §8, §9, §10, §12, §13, §31
 *
 * ---------------------------------------------------------------------------
 * THE ASSERTIONS THAT MATTER ARE THE ONES ABOUT PARTIAL DATA
 * ---------------------------------------------------------------------------
 *
 * The reported bug was an all-or-none dependency: one course without credits
 * emptied the SGPA, the CGPA, the trend, the statistics and the dashboard
 * together. Most of what follows is therefore a test that some OTHER figure
 * survives when one figure cannot be computed — which is a property no single
 * screen can be trusted to keep on its own.
 */

import { describe, expect, it } from 'vitest';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { academicStatistics } from '../src/domain/statistics.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { BacklogRecord, SemesterRecord, SemesterResult } from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

/** One course row, as a provisional card prints one: marks, and no grade. */
function course(
  code: string,
  credits: number | null,
  marks: { internal: number; external: number; gradeLetter?: string | null; hasSee?: boolean },
) {
  return normalizeResultSubject({
    id: `s-${code}`,
    subjectCode: code,
    subjectTitle: code,
    internal: marks.internal,
    external: marks.external,
    total: marks.internal + marks.external,
    resultStatus: 'P',
    credits,
    gradeLetter: marks.gradeLetter ?? null,
    hasSee: marks.hasSee ?? true,
    provenance: 'catalogue',
  });
}

function result(
  semester: number,
  subjects: readonly ReturnType<typeof course>[],
  overrides: Partial<SemesterResult> = {},
): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: [...subjects],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function semesterRecord(number: number, status: SemesterRecord['status']): SemesterRecord {
  return {
    id: `sem${String(number)}`,
    profileId,
    number,
    status,
    startedOn: null,
    completedOn: null,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const stats = (input: {
  semesters?: SemesterRecord[];
  results?: SemesterResult[];
  backlogs?: BacklogRecord[];
}) =>
  academicStatistics({
    semesters: input.semesters ?? [],
    results: input.results ?? [],
    backlogs: input.backlogs ?? [],
  });

/** Four graded courses: 80, 74, 66, 91 percent. */
const GOOD = [
  course('BCS401', 4, { internal: 44, external: 36 }),
  course('BCS402', 4, { internal: 40, external: 34 }),
  course('BCS403', 3, { internal: 36, external: 30 }),
  course('BCS404', 1, { internal: 47, external: 44 }),
];

/* -------------------------------------------------------------------------- */

describe('with nothing entered at all', () => {
  it('reports every figure as unavailable rather than as zero', () => {
    /*
     * §1. A student with no records and a student whose records are all
     * unresolved must not read the same, and neither may read as "you scored
     * nothing" — which is what a screenful of zeroes says.
     */
    const state = stats({});

    expect(state.hasAnyResult).toBe(false);
    expect(state.cgpa).toMatchObject({ value: null, status: 'unavailable' });
    expect(state.creditsEarned).toMatchObject({ value: null, status: 'unavailable' });
    expect(state.latestSgpa.value).toBeNull();
    expect(state.grades.total).toBe(0);
    expect(state.outcomes.passed).toBe(0);
  });

  it('still counts the semesters the student has marked completed', () => {
    // §4: a count that depends on semester records must not wait on results.
    const state = stats({ semesters: [semesterRecord(1, 'completed')] });
    expect(state.semestersCompleted).toMatchObject({ value: 1, status: 'resolved' });
  });

  it('leaves the whole trend as gaps, not as a line at zero', () => {
    const state = stats({});
    expect(state.trend).toHaveLength(8);
    expect(state.trend.every((point) => point.sgpa === null)).toBe(true);
  });
});

describe('one fully resolved semester', () => {
  const state = stats({ results: [result(4, GOOD)] });
  const fourth = state.semesters.find((entry) => entry.number === 4);

  it('calculates its SGPA and says what it came from', () => {
    expect(fourth?.sgpa.status).toBe('resolved');
    expect(fourth?.sgpa.value).toBeGreaterThan(0);
    expect(fourth?.sgpa.source).toMatch(/rule set/i);
  });

  it('counts credits attempted and earned separately', () => {
    // All four passed, so the two agree — and they are still separate figures.
    expect(fourth?.creditsAttempted).toMatchObject({ value: 12, status: 'resolved' });
    expect(fourth?.creditsEarned).toMatchObject({ value: 12, status: 'resolved' });
    expect(fourth?.creditsUnresolved).toBe(0);
  });

  it('averages each course’s own percentage, not its raw marks', () => {
    /*
     * §10. The mean of 80, 74, 66 and 91 is 77.75. Averaging raw totals would
     * give the same answer only because these courses share a maximum — the
     * point is that the figure comes from the rule set's normalised
     * percentage, so a course marked out of anything else cannot skew it.
     */
    expect(fourth?.averagePercentage.value).toBeCloseTo(77.75, 2);
    expect(fourth?.averagePercentage.status).toBe('resolved');
  });

  it('refuses to rank a single semester against itself', () => {
    // §12: strongest and weakest would be the same semester — true, and
    // useless, and read as a comparison.
    expect(state.strongestSemester.status).toBe('partial');
    expect(state.strongestSemester.reason).toMatch(/only one semester/i);
  });

  it('gives a CGPA from the one semester it has', () => {
    expect(state.cgpa.status).toBe('resolved');
    expect(state.cgpa.value).toBeCloseTo(fourth?.sgpa.value ?? 0, 5);
  });
});

describe('a semester one course short — the reported bug', () => {
  /*
   * ONE MISSING CREDIT FIGURE USED TO EMPTY FIVE SCREENS. SGPA is
   * credit-weighted across the whole semester, so it genuinely cannot be
   * calculated here — and that is the ONLY figure that may go missing.
   */
  const partial = [...GOOD.slice(0, 3), course('BCS405', null, { internal: 40, external: 38 })];
  const state = stats({ results: [result(4, partial)] });
  const fourth = state.semesters.find((entry) => entry.number === 4);

  it('cannot calculate the SGPA, and says which course stopped it', () => {
    expect(fourth?.sgpa).toMatchObject({ value: null, status: 'partial' });
    expect(fourth?.sgpa.reason).toMatch(/BCS405/);
  });

  it('still reports the credits it does know, marked partial', () => {
    expect(fourth?.creditsAttempted.value).toBe(11);
    expect(fourth?.creditsAttempted.status).toBe('partial');
    expect(fourth?.creditsAttempted.reason).toMatch(/1 of 4 courses have no credit figure/);
  });

  it('still counts every grade, including the one without credits', () => {
    // §7: a grade does not need credits. Four courses, four grades.
    expect(fourth?.grades.total).toBe(4);
    expect(fourth?.grades.unresolved).toBe(0);
  });

  it('still counts every pass', () => {
    expect(fourth?.outcomes.passed).toBe(4);
    expect(fourth?.outcomes.failed).toBe(0);
  });

  it('still averages the marks', () => {
    expect(fourth?.averagePercentage.value).not.toBeNull();
  });

  it('does not let the missing SGPA empty the degree-level counts', () => {
    // The whole point of §4, asserted at the top level.
    expect(state.hasAnyResult).toBe(true);
    expect(state.outcomes.passed).toBe(4);
    expect(state.grades.total).toBe(4);
    expect(state.creditsEarned.value).toBe(11);
    expect(state.averagePercentage.value).not.toBeNull();
  });

  it('reports the CGPA as partial with a reason, never as zero', () => {
    expect(state.cgpa).toMatchObject({ value: null, status: 'partial' });
    expect(state.cgpa.reason).not.toBeNull();
  });
});

describe('four semesters, one of them unresolvable', () => {
  const state = stats({
    results: [
      result(1, GOOD),
      result(2, GOOD),
      result(3, [...GOOD.slice(0, 3), course('BCS305', null, { internal: 40, external: 38 })]),
      result(4, GOOD),
    ],
  });

  it('leaves a gap in the trend rather than drawing through it', () => {
    // §13: no interpolation. The third semester is a hole, not a guess.
    const points = state.trend.filter((point) => point.semester <= 4);
    expect(points.map((point) => point.sgpa === null)).toEqual([false, false, true, false]);
    expect(points[2]?.status).toBe('partial');
  });

  it('refuses to call the average of three semesters a CGPA', () => {
    /*
     * THE DEFECT THIS TEST USED TO ASSERT. It read "gives a CGPA from the
     * three semesters that resolved" — which is the right arithmetic over the
     * wrong set. A CGPA covers every completed semester; averaging the ones
     * that happen to have resolved produces a number that looks official and
     * answers a question nobody asked.
     *
     * On the real record it was worse: three of four semesters unresolved
     * meant "CGPA 7.47" was semester 4's own SGPA wearing the word CGPA.
     */
    expect(state.cgpa).toMatchObject({ value: null, status: 'partial' });
    expect(state.cgpa.reason).toMatch(/Semester 3 does not/);
    expect(state.semestersGraded.value).toBe(3);
  });

  it('still offers the figure it CAN compute, under its own name', () => {
    /* The information is not lost — it is just not allowed to be the CGPA. */
    expect(state.provisionalCgpa.value).toBeGreaterThan(0);
    expect(state.provisionalCgpa.status).toBe('partial');
    expect(state.provisionalCgpa.reason).toMatch(/3 of 4 completed semesters/);
    expect(state.provisionalCgpa.reason).toMatch(/Not your CGPA/);
  });

  it('names which semesters the CGPA is waiting on', () => {
    expect(state.cgpaBasis).toEqual({ counted: 3, pending: [3] });
  });

  it('marks the short semester partially resolved rather than hiding it', () => {
    const third = state.semesters.find((entry) => entry.number === 3);
    expect(third?.completeness).toBe('partially_resolved');
    expect(third?.cgpaContribution).toBe('pending_resolution');
    /* And it still reports everything that did resolve. */
    expect(third?.resolvedCourses).toBe(3);
    expect(third?.unresolvedCourses).toBe(1);
  });

  it('ranks only the semesters that have an SGPA', () => {
    // §12: the unresolved semester takes no part in the comparison.
    expect(state.strongestSemester.status).toBe('resolved');
    expect(state.strongestSemester.value?.semester).not.toBe(3);
    expect(state.weakestSemester.value?.semester).not.toBe(3);
  });

  it('names the semester that needs work in the data-quality notes', () => {
    expect(state.dataQuality.notes.join(' ')).toMatch(/semester 3/i);
    expect(state.dataQuality.coursesImported).toBe(16);
  });

  it('reports the latest SGPA from the most recent graded semester', () => {
    expect(state.latestSgpa.value?.semester).toBe(4);
  });
});

describe('grades that are not pass or fail', () => {
  it('counts each special grade as what the regulation calls it', () => {
    /*
     * §8. Collapsing these into "failed" would tell a student to re-sit a
     * course they audited and a course they passed as non-credit.
     */
    const state = stats({
      results: [
        result(4, [
          course('BCS401', 4, { internal: 44, external: 36 }),
          course('BAUD402', 0, { internal: 40, external: 0, gradeLetter: 'AU', hasSee: false }),
          course('BNCM403', 0, { internal: 60, external: 0, gradeLetter: 'PP', hasSee: false }),
          course('BABS404', 4, { internal: 20, external: 0, gradeLetter: 'AB' }),
          course('BATT405', 4, { internal: 10, external: 0, gradeLetter: 'DX' }),
        ]),
      ],
    });

    expect(state.outcomes.passed).toBe(1);
    expect(state.outcomes.audit).toBe(1);
    expect(state.outcomes.non_credit_passed).toBe(1);
    expect(state.outcomes.absent).toBe(1);
    expect(state.outcomes.attendance_shortage).toBe(1);
    // And none of them became a failure.
    expect(state.outcomes.failed).toBe(0);
  });

  it('lists special grades apart from the ordinary bands', () => {
    const state = stats({
      results: [
        result(4, [
          course('BCS401', 4, { internal: 44, external: 36 }),
          course('BNCM403', 0, { internal: 60, external: 0, gradeLetter: 'PP', hasSee: false }),
        ]),
      ],
    });

    const pp = state.grades.specials.find((entry) => entry.letter === 'PP');
    expect(pp?.count).toBe(1);
    expect(pp?.meaning).toMatch(/non-credit/i);
    // The A+ band holds the graded course and nothing else.
    expect(state.grades.bands.find((band) => band.letter === 'A+')?.count).toBe(1);
  });

  it('does not count a non-credit course as ordinary credit', () => {
    // §9. A zero-credit course adds nothing to either total, and is not
    // presented as a course attempted for credit that earned none.
    const state = stats({
      results: [
        result(4, [
          course('BCS401', 4, { internal: 44, external: 36 }),
          course('BNCM403', 0, { internal: 60, external: 0, gradeLetter: 'PP', hasSee: false }),
        ]),
      ],
    });
    expect(state.creditsAttempted.value).toBe(4);
    expect(state.creditsEarned.value).toBe(4);
  });
});

describe('a course that cannot be read either way', () => {
  /*
   * An external of 0 with `hasSee` unknown is the case DEC-037 exists for: it
   * reads identically as "this course has no final exam" and "sat it and
   * scored nothing", and those have opposite outcomes.
   */
  const ambiguous = normalizeResultSubject({
    id: 'amb',
    subjectCode: 'BCS406',
    subjectTitle: 'BCS406',
    internal: 40,
    external: 0,
    total: 40,
    resultStatus: 'P',
    credits: 4,
    gradeLetter: null,
    hasSee: null,
    provenance: 'manual',
  });

  const state = stats({ results: [result(4, [...GOOD, ambiguous])] });

  it('counts it as unresolved rather than as a pass or a failure', () => {
    expect(state.outcomes.unresolved).toBe(1);
    expect(state.outcomes.passed).toBe(4);
    expect(state.outcomes.failed).toBe(0);
  });

  it('counts it in no grade band at all', () => {
    // §7: never invented as an F, never invented as a P.
    expect(state.grades.unresolved).toBe(1);
    const counted =
      state.grades.bands.reduce((sum, band) => sum + band.count, 0) +
      state.grades.specials.reduce((sum, entry) => sum + entry.count, 0);
    expect(counted).toBe(4);
    expect(counted + state.grades.unresolved).toBe(state.grades.total);
  });

  it('warns that the backlog count may be understated rather than reporting a clean zero', () => {
    /*
     * §1, and the most consequential instance of it. Zero backlogs is the best
     * news the page carries; an undetermined count shown as zero is the worst
     * thing it could get wrong. The screens render this as "0+".
     */
    expect(state.backlogsFromResults.value).toBe(0);
    expect(state.backlogsFromResults.status).toBe('partial');
    expect(state.backlogsUndetermined).toBe(1);
    expect(state.backlogsFromResults.reason).toMatch(/at least/i);
  });

  it('keeps the recorded backlogs apart from the derived ones', () => {
    /*
     * TWO QUESTIONS, TWO FIGURES. What the student has written down as carried
     * is not what their result rows imply, and a student may well have one
     * without the other. Blending them produced a number neither source
     * supports — and it was how the results page lost its "+" convention.
     */
    expect(state.backlogs).toMatchObject({ value: 0, status: 'resolved' });
    expect(state.backlogs.source).toMatch(/backlog records/i);
    expect(state.backlogsFromResults.source).toMatch(/rule set/i);
  });

  it('surfaces it as a course needing review', () => {
    expect(state.dataQuality.coursesNeedingReview).toBe(1);
  });
});

describe('a genuine zero is not an absence', () => {
  it('reports zero backlogs as resolved when nothing is ambiguous', () => {
    const state = stats({ results: [result(4, GOOD)] });
    expect(state.backlogs).toMatchObject({ value: 0, status: 'resolved' });
    expect(state.backlogsFromResults).toMatchObject({ value: 0, status: 'resolved' });
    expect(state.backlogsUndetermined).toBe(0);
  });

  it('counts a real failure as a derived backlog', () => {
    const failed = [
      course('BCS401', 4, { internal: 12, external: 30 }),
      course('BCS402', 4, { internal: 44, external: 36 }),
    ];
    const state = stats({ results: [result(4, failed)] });
    expect(state.backlogsFromResults).toMatchObject({ value: 1, status: 'resolved' });
  });

  it('reports zero credits earned as a real figure when every course failed', () => {
    const failed = [
      course('BCS401', 4, { internal: 12, external: 30 }),
      course('BCS402', 4, { internal: 11, external: 28 }),
    ];
    const state = stats({ results: [result(4, failed)] });

    expect(state.creditsAttempted.value).toBe(8);
    expect(state.creditsEarned.value).toBe(0);
    expect(state.outcomes.failed).toBe(2);
  });
});

describe('a rule set this build does not have', () => {
  it('is an error, not a gap in the student’s data', () => {
    /*
     * §1's fifth state. The student has done nothing wrong and there is
     * nothing for them to fill in — the build is missing a regulation.
     */
    const state = stats({
      results: [result(4, GOOD, { ruleSetId: 'vtu-2029-imaginary' })],
    });
    const fourth = state.semesters.find((entry) => entry.number === 4);

    expect(fourth?.sgpa.status).toBe('error');
    expect(fourth?.sgpa.reason).toMatch(/vtu-2029-imaginary/);
    expect(state.dataQuality.notes.join(' ')).toMatch(/does not have/i);
  });
});

describe('the credit requirement', () => {
  it('will not invent a total to subtract from', () => {
    // M6 §13: no universal VTU credit requirement exists in verified data, and
    // a fabricated denominator under a real numerator is worse than no figure.
    const state = stats({ results: [result(4, GOOD)] });
    expect(state.creditsRemaining).toMatchObject({ value: null, status: 'unavailable' });
    expect(state.creditsRemaining.reason).toMatch(/not recorded/i);
  });

  it('subtracts from one when a verified source supplies it', () => {
    const state = academicStatistics({
      semesters: [],
      results: [result(4, GOOD)],
      backlogs: [],
      totalCreditsRequired: 160,
    });
    expect(state.creditsRemaining).toMatchObject({ value: 148, status: 'resolved' });
  });
});

describe('a semester the student is still sitting', () => {
  it('is not a gap in the data', () => {
    const state = stats({ semesters: [semesterRecord(5, 'in_progress')] });
    const fifth = state.semesters.find((entry) => entry.number === 5);

    expect(fifth?.sgpa.status).toBe('not_applicable');
    expect(fifth?.creditsAttempted.reason).toMatch(/still in progress/i);
    expect(state.dataQuality.notes).toHaveLength(0);
  });
});

describe('the same semester imported twice', () => {
  it('is counted once, from the first record', () => {
    /*
     * `buildSemesterViews` matches a semester by number and reads the first
     * match, so a duplicate cannot double a credit total. Asserted here
     * because the statistics are what a duplicate would visibly corrupt.
     */
    const state = stats({ results: [result(4, GOOD), { ...result(4, GOOD), id: 'r4-again' }] });

    expect(state.semesters.filter((entry) => entry.hasResult)).toHaveLength(1);
    expect(state.creditsEarned.value).toBe(12);
    expect(state.grades.total).toBe(4);
  });
});

describe('when every completed semester has resolved', () => {
  it('publishes a real CGPA, weighted by credits and not an average of SGPAs', () => {
    /*
     * §2. Two semesters of different credit weight, so an unweighted mean and
     * the credit-weighted one give different answers and the test can tell
     * them apart. The engine's own formula is the authority; this asserts the
     * product feeds it the right set and reports the right thing.
     */
    const light = [course('BCS401', 4, { internal: 47, external: 44 })];
    const heavy = [
      course('BCS501', 4, { internal: 36, external: 30 }),
      course('BCS502', 4, { internal: 36, external: 30 }),
      course('BCS503', 4, { internal: 36, external: 30 }),
    ];
    const state = stats({ results: [result(4, light), result(5, heavy)] });

    expect(state.cgpa.status).toBe('resolved');
    expect(state.cgpaBasis).toEqual({ counted: 2, pending: [] });
    /* Both figures agree once nothing is pending. */
    expect(state.provisionalCgpa.value).toBeCloseTo(state.cgpa.value ?? 0, 6);

    /* 91% is O (10); 66% is B+ (7). Weighted: (4*10 + 12*7)/16 = 7.75. */
    expect(state.cgpa.value).toBeCloseTo(7.75, 2);
    /* An unweighted mean of the two SGPAs would be 8.5 — it is not that. */
    expect(state.cgpa.value).not.toBeCloseTo(8.5, 1);
  });

  it('does not wait on a semester the student has not sat', () => {
    // A future semester is not "pending resolution" — it has not happened.
    const state = stats({
      results: [result(4, GOOD)],
      semesters: [semesterRecord(5, 'in_progress')],
    });
    expect(state.cgpa.status).toBe('resolved');
    expect(state.cgpaBasis.pending).toEqual([]);
  });

  it('waits on a semester marked completed that has no result at all', () => {
    /*
     * A student who says semester 3 is behind them and has entered nothing for
     * it has a CGPA the product cannot compute. Publishing one over semester 4
     * alone would be the same masquerade by a different route.
     */
    const state = stats({
      results: [result(4, GOOD)],
      semesters: [semesterRecord(3, 'completed')],
    });
    expect(state.cgpa).toMatchObject({ value: null, status: 'partial' });
    expect(state.cgpaBasis.pending).toEqual([3]);
    expect(state.semesters.find((e) => e.number === 3)?.completeness).toBe('unresolved');
  });
});
