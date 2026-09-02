/**
 * Longitudinal academic analytics.
 *
 * Authority: docs/18 §18.9 · M6 §5–§9, §13, §23
 *
 * SYNTHETIC STUDENTS ONLY. No real academic record appears in this repository,
 * in any form, ever (M6 §18). The subject codes below are shaped like VTU codes
 * and belong to nobody.
 *
 * These tests pin the RULES, not the arithmetic: SGPA, CGPA and percentage all
 * come from `@gradtools/academic-rules`, and a test that re-derived them here
 * would be testing a second implementation into existence.
 */

import { describe, expect, it } from 'vitest';
import { normalizeResultSubject } from '../src/domain/results.js';
import { getActiveRuleSetForScheme, VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import {
  analyseStrengths,
  buildSemesterViews,
  cumulativeStanding,
  currentSemester,
  graduationProgress,
  MIN_SUBJECTS_FOR_STRENGTH,
  ruleSetForResult,
  subjectPerformance,
  summariseBacklogs,
  STRENGTH_THRESHOLD,
} from '../src/domain/academics.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  BacklogRecord,
  SemesterRecord,
  SemesterResult,
  SemesterStatus,
} from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function result(
  semester: number,
  subjects: readonly [string, number, string][],
  overrides: Partial<SemesterResult> = {},
): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    // Through the real reader, so a fixture cannot describe a shape storage
    // could never hold — and so adding a field does not mean editing four
    // test files (OQ-049).
    subjects: subjects.map(([code, credits, gradeLetter], index) =>
      normalizeResultSubject({
        id: `${String(semester)}-${String(index)}`,
        subjectCode: code,
        subjectTitle: code,
        credits,
        gradeLetter,
      }),
    ),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function semester(number: number, status: SemesterStatus): SemesterRecord {
  return {
    id: `s${String(number)}`,
    profileId,
    number,
    status,
    startedOn: null,
    completedOn: null,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/* -------------------------------------------------------------------------- */
/* The eight-semester shape                                                   */
/* -------------------------------------------------------------------------- */

describe('the eight-semester degree', () => {
  it('always has eight semesters, however little has been entered', () => {
    const views = buildSemesterViews([], []);
    expect(views.map((v) => v.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(views.every((v) => v.status === 'planned')).toBe(true);
  });

  /*
   * THE PILOT SHAPE (M6 §2, §3): four semesters behind, one running, three
   * ahead. A student joining in their third year is the normal case, not an
   * edge case.
   */
  it('supports a student who starts part-way through the degree', () => {
    const views = buildSemesterViews(
      [
        semester(1, 'completed'),
        semester(2, 'completed'),
        semester(3, 'completed'),
        semester(4, 'completed'),
        semester(5, 'in_progress'),
      ],
      [
        result(1, [['BMATS101', 4, 'A']]),
        result(2, [['BMATS201', 4, 'B']]),
        result(3, [['BCS301', 4, 'A']]),
        result(4, [['BCS401', 4, 'O']]),
      ],
    );

    expect(views.map((v) => v.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'in_progress',
      'planned',
      'planned',
      'planned',
    ]);
    expect(currentSemester(views)?.number).toBe(5);
  });

  /* Typing in four years of history should not also mean setting four statuses. */
  it('treats a semester with a saved result as completed', () => {
    const views = buildSemesterViews([], [result(3, [['BCS301', 4, 'A']])]);
    expect(views[2]?.status).toBe('completed');
    expect(views[2]?.subjectCount).toBe(1);
  });

  it('reports no current semester until one is marked in progress', () => {
    expect(currentSemester(buildSemesterViews([], []))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Rule-set pinning                                                           */
/* -------------------------------------------------------------------------- */

describe('rule-set pinning', () => {
  /* A. A pin that resolves is authoritative. */
  it('grades a semester under the rule set it was entered with', () => {
    const resolved = ruleSetForResult(result(1, [['BMATS101', 4, 'A']]));
    expect(resolved.resolution).toBe('pinned');
    expect(resolved.ruleSet?.id).toBe(VTU_2022_RULE_SET_ID);
  });

  /*
   * C. Records saved before M6 have no pin. They fall back to the scheme's
   * active rule set, and the caller is told - "graded under the rules of its own
   * time" and "graded under whatever is current" are different claims (M6 6).
   */
  it('falls back for a record saved before pinning existed, and says so', () => {
    const resolved = ruleSetForResult(result(1, [['BMATS101', 4, 'A']], { ruleSetId: null }));
    expect(resolved.resolution).toBe('fallback');
    expect(resolved.ruleSet?.id).toBe(VTU_2022_RULE_SET_ID);
  });

  /*
   * B. THE UNSAFE CASE. A record pins a rule set this build does not have. The
   * scheme is perfectly valid and its active rule set is right there - and it
   * must NOT be used. Falling back would re-grade a completed semester under a
   * regulation it was never sat under, produce a plausible SGPA, and give no
   * sign that anything had happened.
   */
  it('never falls back to the current rules when a pinned rule set is missing', () => {
    const resolved = ruleSetForResult(
      // Valid scheme, so the active rule set IS resolvable. It still must not win.
      result(1, [['BMATS101', 4, 'A']], { ruleSetId: 'vtu-2029-imaginary' }),
    );

    expect(resolved.resolution).toBe('unavailable');
    expect(resolved.ruleSet).toBeUndefined();
    expect(resolved.missingRuleSetId).toBe('vtu-2029-imaginary');
    // The fallback the scheme would have offered, proving it was available.
    expect(getActiveRuleSetForScheme('vtu-2022')?.id).toBe(VTU_2022_RULE_SET_ID);
  });

  it('computes nothing for a semester whose pinned rule set is missing', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BMATS101', 4, 'O']], { ruleSetId: 'vtu-2029-imaginary' })],
    );

    expect(views[0]?.sgpaComputed).toBeNull();
    expect(views[0]?.ruleSetResolution).toBe('unavailable');
    expect(views[0]?.missingRuleSetId).toBe('vtu-2029-imaginary');
  });

  /* An ungradeable semester must not silently enter the cumulative figures. */
  it('leaves an ungradeable semester out of CGPA rather than guessing at it', () => {
    const views = buildSemesterViews(
      [],
      [
        result(1, [['BMATS101', 4, 'O']]),
        result(2, [['BMATS201', 4, 'P']], { ruleSetId: 'vtu-2029-imaginary' }),
      ],
    );
    const standing = cumulativeStanding(views);

    expect(standing.semestersCompleted).toBe(1);
    expect(standing.cgpa).toBe(10);
  });

  /* A subject from an ungradeable semester has no grade point to compare. */
  it('gives a subject from an ungradeable semester no grade point', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BMATS101', 4, 'O']], { ruleSetId: 'vtu-2029-imaginary' })],
    );
    expect(subjectPerformance(views)[0]?.gradePoint).toBeNull();
  });

  it('reports the resolution on every semester view', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BMATS101', 4, 'A']]), result(2, [['BMATS201', 4, 'A']], { ruleSetId: null })],
    );
    expect(views[0]?.ruleSetResolution).toBe('pinned');
    expect(views[1]?.ruleSetResolution).toBe('fallback');
  });
});

/* -------------------------------------------------------------------------- */
/* SGPA, CGPA, percentage                                                     */
/* -------------------------------------------------------------------------- */

describe('SGPA', () => {
  it('computes a semester SGPA from the rules package', () => {
    // All 'O' (10 points) — the one case whose answer is obvious by hand.
    const views = buildSemesterViews(
      [],
      [
        result(1, [
          ['BMATS101', 4, 'O'],
          ['BPHYS102', 4, 'O'],
        ]),
      ],
    );
    expect(views[0]?.sgpaComputed).toBe(10);
    expect(views[0]?.credits).toBe(8);
  });

  /*
   * ASSERTED vs COMPUTED. Both are kept and the disagreement is flagged;
   * neither silently wins, because a mismatch means either a typo or a rule we
   * have wrong, and both are worth seeing.
   */
  it('flags a grade card that disagrees with the computed value', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BMATS101', 4, 'O']], { sgpaAsserted: 9.1 })],
    );
    expect(views[0]?.sgpaComputed).toBe(10);
    expect(views[0]?.sgpaAsserted).toBe(9.1);
    expect(views[0]?.sgpaDisagrees).toBe(true);
  });

  it('does not call rounding a disagreement', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BMATS101', 4, 'O']], { sgpaAsserted: 10.001 })],
    );
    expect(views[0]?.sgpaDisagrees).toBe(false);
  });
});

describe('cumulative standing', () => {
  it('computes CGPA and percentage across completed semesters', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BMATS101', 4, 'O']]), result(2, [['BMATS201', 4, 'O']])],
    );
    const standing = cumulativeStanding(views);

    expect(standing.cgpa).toBe(10);
    // The rule set's own formula (CGPA x 10), never arithmetic in the app.
    expect(standing.percentage).toBe(100);
    expect(standing.creditsCompleted).toBe(8);
    expect(standing.semestersCompleted).toBe(2);
  });

  /*
   * REGRESSION GUARD (M6 §7). The old third-party formula (CGPA - 0.75) x 10
   * would give 92.5 here. It is in no rule set and must stay unreachable.
   */
  it('never applies the discredited (CGPA - 0.75) x 10 formula', () => {
    const views = buildSemesterViews([], [result(1, [['BMATS101', 4, 'O']])]);
    const standing = cumulativeStanding(views);

    expect(standing.percentage).toBe(100);
    expect(standing.percentage).not.toBe(92.5);
  });

  it('says why when nothing has been completed', () => {
    const standing = cumulativeStanding(buildSemesterViews([], []));
    expect(standing.cgpa).toBeNull();
    expect(standing.percentage).toBeNull();
    expect(standing.reason).toContain('No completed semester');
  });

  it('counts only semesters that actually have a result', () => {
    const views = buildSemesterViews(
      [semester(1, 'completed'), semester(2, 'in_progress')],
      [result(1, [['BMATS101', 4, 'A']])],
    );
    expect(cumulativeStanding(views).semestersCompleted).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Subject performance                                                        */
/* -------------------------------------------------------------------------- */

describe('subject performance', () => {
  it('lists each subject with its grade and semester', () => {
    const views = buildSemesterViews(
      [],
      [
        result(1, [
          ['BMATS101', 4, 'A'],
          ['BPHYS102', 4, 'B'],
        ]),
      ],
    );
    const performance = subjectPerformance(views);

    expect(performance.map((p) => p.subjectCode).sort()).toEqual(['BMATS101', 'BPHYS102']);
    expect(performance.find((p) => p.subjectCode === 'BMATS101')?.gradePoint).toBe(8);
  });

  /*
   * A SUBJECT SAT ONCE HAS NO TREND (M6 §8). Most subjects in a degree are
   * taken once, and calling that "unchanged" would dress a single point up as a
   * flat line.
   */
  it('reports no direction for a subject taken once', () => {
    const views = buildSemesterViews([], [result(1, [['BMATS101', 4, 'A']])]);
    expect(subjectPerformance(views)[0]?.trend).toBe('single_attempt');
  });

  it('reports improvement when a re-sat subject scores higher', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BMATS101', 4, 'C']]), result(3, [['BMATS101', 4, 'A']])],
    );
    const maths = subjectPerformance(views).find((p) => p.subjectCode === 'BMATS101');

    expect(maths?.trend).toBe('improved');
    expect(maths?.attempts.length).toBe(2);
    // The latest attempt is the one shown.
    expect(maths?.semester).toBe(3);
    expect(maths?.gradeLetter).toBe('A');
  });

  it('reports a decline when a re-sat subject scores lower', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['BCS301', 4, 'A']]), result(3, [['BCS301', 4, 'C']])],
    );
    expect(subjectPerformance(views)[0]?.trend).toBe('declined');
  });

  it('matches subject codes regardless of case', () => {
    const views = buildSemesterViews(
      [],
      [result(1, [['bmats101', 4, 'C']]), result(3, [['BMATS101', 4, 'A']])],
    );
    expect(subjectPerformance(views).length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Strong and weak subjects                                                   */
/* -------------------------------------------------------------------------- */

describe('strong and weak subjects', () => {
  /*
   * "NOT ENOUGH HISTORY YET" IS AN ACCEPTABLE ANSWER (M6 §9). A first-semester
   * student must not be told which subject they are weak at on the strength of
   * two grades.
   */
  it('refuses to classify without enough graded subjects, and says why', () => {
    const views = buildSemesterViews(
      [],
      [
        result(1, [
          ['BMATS101', 4, 'A'],
          ['BPHYS102', 4, 'B'],
        ]),
      ],
    );
    const analysis = analyseStrengths(subjectPerformance(views));

    expect(analysis.available).toBe(false);
    expect(analysis.subjects).toEqual([]);
    expect(analysis.reason).toContain('Not enough history yet');
    expect(analysis.reason).toContain(String(MIN_SUBJECTS_FOR_STRENGTH));
  });

  it('says something different when there is nothing at all', () => {
    const analysis = analyseStrengths(subjectPerformance(buildSemesterViews([], [])));
    expect(analysis.reason).toContain('No graded subjects yet');
  });

  /*
   * The rule: strong is a full grade point ABOVE the student's own mean, weak a
   * full grade point below. Measured against themselves, never a percentile.
   */
  it('classifies against the student own mean, a full grade point either way', () => {
    const views = buildSemesterViews(
      [],
      [
        result(1, [
          ['BCS301', 4, 'O'], // 10
          ['BCS302', 4, 'A+'], // 9
          ['BCS303', 4, 'A'], // 8
          ['BCS304', 4, 'B+'], // 7
          ['BCS305', 4, 'B'], // 6
        ]),
      ],
    );
    const analysis = analyseStrengths(subjectPerformance(views));

    expect(analysis.available).toBe(true);
    expect(analysis.meanGradePoint).toBe(8);
    expect(analysis.threshold).toBe(STRENGTH_THRESHOLD);

    const standingOf = (code: string) =>
      analysis.subjects.find((s) => s.performance.subjectCode === code)?.standing;

    expect(standingOf('BCS301')).toBe('strong');
    expect(standingOf('BCS302')).toBe('strong');
    expect(standingOf('BCS303')).toBe('typical');
    expect(standingOf('BCS304')).toBe('weak');
    expect(standingOf('BCS305')).toBe('weak');
  });

  /*
   * A PERCENTILE WOULD ALWAYS PRODUCE LOSERS. Even performance means nobody is
   * weak, and the rule has to be able to say that.
   */
  it('calls nothing strong or weak when performance is even', () => {
    const views = buildSemesterViews(
      [],
      [
        result(1, [
          ['BCS301', 4, 'A'],
          ['BCS302', 4, 'A'],
          ['BCS303', 4, 'A'],
          ['BCS304', 4, 'A'],
          ['BCS305', 4, 'A'],
        ]),
      ],
    );
    const analysis = analyseStrengths(subjectPerformance(views));

    expect(analysis.available).toBe(true);
    expect(analysis.subjects.every((s) => s.standing === 'typical')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Backlogs                                                                   */
/* -------------------------------------------------------------------------- */

describe('backlogs', () => {
  function backlog(status: BacklogRecord['status'], code: string): BacklogRecord {
    return {
      id: code,
      profileId,
      subjectCode: code,
      subjectTitle: code,
      originSemester: 2,
      status,
      attempts: status === 'active' ? 0 : 1,
      clearedInSemester: status === 'cleared' ? 4 : null,
      updatedAt: '2026-01-01T00:00:00Z',
    };
  }

  it('counts each state separately', () => {
    const summary = summariseBacklogs([
      backlog('active', 'BCS301'),
      backlog('attempted', 'BCS302'),
      backlog('cleared', 'BCS303'),
    ]);

    expect(summary.active).toBe(1);
    expect(summary.attempted).toBe(1);
    expect(summary.cleared).toBe(1);
  });

  /* Attempted is not cleared: the result is not known yet. */
  it('counts an attempted backlog as still outstanding', () => {
    const summary = summariseBacklogs([backlog('attempted', 'BCS302')]);
    expect(summary.outstanding).toBe(1);
    expect(summary.cleared).toBe(0);
  });

  it('reports nothing outstanding when everything is cleared', () => {
    expect(summariseBacklogs([backlog('cleared', 'BCS303')]).outstanding).toBe(0);
  });

  it('handles a student with no backlogs', () => {
    expect(summariseBacklogs([])).toEqual({
      active: 0,
      attempted: 0,
      cleared: 0,
      outstanding: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Graduation progress                                                        */
/* -------------------------------------------------------------------------- */

describe('graduation progress', () => {
  const views = buildSemesterViews(
    [semester(1, 'completed'), semester(2, 'completed')],
    [result(1, [['BMATS101', 4, 'A']]), result(2, [['BMATS201', 4, 'A']])],
  );

  it('counts credits and semesters actually completed', () => {
    const progress = graduationProgress(views, 160);
    expect(progress.creditsCompleted).toBe(8);
    expect(progress.creditsRequired).toBe(160);
    expect(progress.creditsRemaining).toBe(152);
    expect(progress.semestersCompleted).toBe(2);
    expect(progress.semestersTotal).toBe(8);
  });

  /*
   * NO INVENTED DENOMINATOR (M6 §13). There is no universal VTU credit total in
   * this codebase, and putting a fabricated one under a real numerator would be
   * the most quietly misleading number in the product.
   */
  it('says the total is unknown rather than assuming one', () => {
    const progress = graduationProgress(views, null);

    expect(progress.creditsCompleted).toBe(8);
    expect(progress.creditsRequired).toBeNull();
    expect(progress.creditsRemaining).toBeNull();
    expect(progress.reason).toContain('not established in verified reference data');
  });

  it('never reports a negative remainder', () => {
    expect(graduationProgress(views, 4).creditsRemaining).toBe(0);
  });

  it('counts nothing for a student who has just started', () => {
    const progress = graduationProgress(buildSemesterViews([], []), null);
    expect(progress.creditsCompleted).toBe(0);
    expect(progress.semestersCompleted).toBe(0);
  });
});
