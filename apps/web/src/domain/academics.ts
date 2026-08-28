/**
 * Longitudinal academic analytics across the eight-semester degree.
 *
 * Authority: docs/18 §18.9 · docs/08 §8.13 · M6 §5–§9, §13
 *
 * ---------------------------------------------------------------------------
 * NO ACADEMIC ARITHMETIC IS INVENTED HERE
 * ---------------------------------------------------------------------------
 * Every SGPA, CGPA and percentage comes from `@gradtools/academic-rules`,
 * resolved against an explicit rule set. This module ORGANISES those results
 * across semesters — it never computes one. A second implementation of SGPA
 * living in the web app is exactly the drift the repository boundary exists to
 * prevent (M6 §4, §5).
 *
 * NO AI, and nothing qualitative. Every classification below is a rule you can
 * read, apply by hand, and disagree with. Where the data cannot support an
 * answer, the answer is "not enough history yet" rather than a guess (M6 §9).
 */

import {
  calculateCGPA,
  calculatePercentage,
  calculateSGPA,
  getRuleSet,
  getActiveRuleSetForScheme,
  isOk,
  resolveGrade,
  type CourseGrade,
  type RuleSet,
  type SemesterSummary,
} from '@gradtools/academic-rules';
import type { BacklogRecord, SemesterRecord, SemesterResult, SemesterStatus } from './types.js';

/* -------------------------------------------------------------------------- */
/* Rule-set resolution                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The rule set a saved semester must be graded under.
 *
 * A semester entered from M6 onward pins its `ruleSetId`, and that pin wins.
 * Records saved earlier have none, so they fall back to the scheme's active set
 * — and the caller is told, because "graded under the rules of its own time"
 * and "graded under whatever is current" are different claims (M6 §6).
 */
export interface ResolvedRuleSet {
  readonly ruleSet: RuleSet | undefined;
  /** True when the record pinned its own rule set. */
  readonly pinned: boolean;
}

export function ruleSetForResult(result: SemesterResult): ResolvedRuleSet {
  if (result.ruleSetId !== null) {
    const pinned = getRuleSet(result.ruleSetId);
    if (pinned !== undefined) return { ruleSet: pinned, pinned: true };
  }
  return { ruleSet: getActiveRuleSetForScheme(result.schemeId), pinned: false };
}

function coursesOf(result: SemesterResult): CourseGrade[] {
  return result.subjects.map((subject) => ({
    credits: subject.credits,
    gradeLetter: subject.gradeLetter,
    subjectCode: subject.subjectCode,
  }));
}

/* -------------------------------------------------------------------------- */
/* Per-semester view                                                          */
/* -------------------------------------------------------------------------- */

export interface SemesterView {
  readonly number: number;
  readonly status: SemesterStatus;
  readonly result: SemesterResult | null;
  /** From academic-rules. Null when it could not be computed. */
  readonly sgpaComputed: number | null;
  /** What the grade card says, if the student entered it. */
  readonly sgpaAsserted: number | null;
  /** True when both exist and disagree beyond rounding. */
  readonly sgpaDisagrees: boolean;
  readonly credits: number;
  readonly subjectCount: number;
  readonly ruleSetId: string | null;
  readonly ruleSetPinned: boolean;
}

/** Rounding on a VTU grade card is two decimals; below that is not a conflict. */
const SGPA_TOLERANCE = 0.005;

/**
 * All eight semesters, whether or not the student has reached them.
 *
 * The degree has eight semesters and the view says so from day one: a student
 * in their third year should see the four behind them, the one they are in, and
 * the three ahead. Building the list from what happens to be saved would make
 * the shape of the degree depend on how much has been typed in (M6 §2).
 */
export function buildSemesterViews(
  semesters: readonly SemesterRecord[],
  results: readonly SemesterResult[],
): SemesterView[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((number) => {
    const record = semesters.find((candidate) => candidate.number === number);
    const result = results.find((candidate) => candidate.semester === number) ?? null;

    let sgpaComputed: number | null = null;
    let ruleSetId: string | null = null;
    let pinned = false;

    if (result !== null) {
      const resolved = ruleSetForResult(result);
      pinned = resolved.pinned;
      ruleSetId = resolved.ruleSet?.id ?? null;
      if (resolved.ruleSet !== undefined) {
        const outcome = calculateSGPA(coursesOf(result), resolved.ruleSet);
        if (isOk(outcome)) sgpaComputed = outcome.value;
      }
    }

    const asserted = result?.sgpaAsserted ?? null;

    return {
      number,
      /*
       * A saved result means the semester is completed even when no status was
       * recorded — a student typing in history should not also have to set a
       * status for every year behind them.
       */
      status: record?.status ?? (result !== null ? 'completed' : 'planned'),
      result,
      sgpaComputed,
      sgpaAsserted: asserted,
      sgpaDisagrees:
        sgpaComputed !== null &&
        asserted !== null &&
        Math.abs(sgpaComputed - asserted) > SGPA_TOLERANCE,
      credits: result?.subjects.reduce((total, subject) => total + subject.credits, 0) ?? 0,
      subjectCount: result?.subjects.length ?? 0,
      ruleSetId,
      ruleSetPinned: pinned,
    };
  });
}

/** The semester the student is in, if they have said. */
export function currentSemester(views: readonly SemesterView[]): SemesterView | null {
  return views.find((view) => view.status === 'in_progress') ?? null;
}

/* -------------------------------------------------------------------------- */
/* Cumulative standing                                                        */
/* -------------------------------------------------------------------------- */

export interface CumulativeStanding {
  readonly cgpa: number | null;
  readonly percentage: number | null;
  readonly creditsCompleted: number;
  readonly semestersCompleted: number;
  /**
   * Set when semesters were graded under DIFFERENT rule sets, which makes a
   * single CGPA a simplification worth admitting to (M6 §6).
   */
  readonly mixedRuleSets: boolean;
  readonly reason: string | null;
}

/**
 * CGPA and percentage across every completed semester.
 *
 * The percentage comes from the rule set's own formula, never from arithmetic
 * here. VTU's 2022 regulation is `CGPA × 10`; the older `(CGPA − 0.75) × 10`
 * that third-party calculators still publish is not in any rule set and cannot
 * be reached from this module (M6 §7).
 */
export function cumulativeStanding(views: readonly SemesterView[]): CumulativeStanding {
  const completed = views.filter(
    (view) => view.result !== null && view.sgpaComputed !== null && view.credits > 0,
  );

  const creditsCompleted = completed.reduce((total, view) => total + view.credits, 0);
  const ruleSetIds = new Set(completed.map((view) => view.ruleSetId).filter((id) => id !== null));

  if (completed.length === 0) {
    return {
      cgpa: null,
      percentage: null,
      creditsCompleted: 0,
      semestersCompleted: 0,
      mixedRuleSets: false,
      reason: 'No completed semester has a result yet.',
    };
  }

  /*
   * The most recent semester's rule set governs the cumulative figures. Where
   * semesters were graded under different regulations, that is flagged rather
   * than resolved: silently averaging across regulations would present a
   * number no regulation actually defines.
   */
  const last = completed[completed.length - 1];
  const ruleSet = last?.ruleSetId === null ? undefined : getRuleSet(last?.ruleSetId ?? '');
  if (ruleSet === undefined) {
    return {
      cgpa: null,
      percentage: null,
      creditsCompleted,
      semestersCompleted: completed.length,
      mixedRuleSets: ruleSetIds.size > 1,
      reason: 'No verified rule set is available for these semesters.',
    };
  }

  const summaries: SemesterSummary[] = completed.map((view) => ({
    credits: view.credits,
    sgpa: view.sgpaComputed ?? 0,
    semester: view.number,
  }));

  const cgpaOutcome = calculateCGPA(summaries, ruleSet);
  if (!isOk(cgpaOutcome)) {
    return {
      cgpa: null,
      percentage: null,
      creditsCompleted,
      semestersCompleted: completed.length,
      mixedRuleSets: ruleSetIds.size > 1,
      reason: cgpaOutcome.reason,
    };
  }

  const percentageOutcome = calculatePercentage(cgpaOutcome.value, ruleSet);

  return {
    cgpa: cgpaOutcome.value,
    percentage: isOk(percentageOutcome) ? percentageOutcome.value : null,
    creditsCompleted,
    semestersCompleted: completed.length,
    mixedRuleSets: ruleSetIds.size > 1,
    reason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Subject performance                                                        */
/* -------------------------------------------------------------------------- */

export type SubjectTrend = 'improved' | 'declined' | 'unchanged' | 'single_attempt';

export interface SubjectPerformance {
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly credits: number;
  /** The most recent grade recorded for this subject. */
  readonly gradeLetter: string;
  readonly gradePoint: number | null;
  readonly semester: number;
  /** Every semester this subject appears in, oldest first. */
  readonly attempts: readonly {
    semester: number;
    gradeLetter: string;
    gradePoint: number | null;
  }[];
  /**
   * A DIRECTION ONLY WHERE THERE IS SOMETHING TO COMPARE (M6 §8).
   *
   * A subject sat once has no trend, and `single_attempt` says so rather than
   * dressing a single point up as a flat line.
   */
  readonly trend: SubjectTrend;
}

/**
 * Grade points for a letter, from the rule set — never from a table here.
 *
 * `resolveGrade` returns a failure for a grade whose behaviour the regulation
 * does not state (`AB`, docs/32 OQ-018). Null propagates that refusal instead of
 * substituting a zero, which would quietly drag an average down.
 */
function gradePointOf(gradeLetter: string, ruleSet: RuleSet | undefined): number | null {
  if (ruleSet === undefined) return null;
  const resolved = resolveGrade(gradeLetter, ruleSet);
  return isOk(resolved) ? resolved.value.points : null;
}

/**
 * Every subject the student has a grade for, newest attempt first.
 *
 * A subject appears more than once when it was carried and re-sat, which is the
 * only place a real trend exists in a degree where most subjects are taken once.
 */
export function subjectPerformance(views: readonly SemesterView[]): SubjectPerformance[] {
  const byCode = new Map<string, SubjectPerformance>();

  for (const view of views) {
    if (view.result === null) continue;
    const { ruleSet } = ruleSetForResult(view.result);

    for (const subject of view.result.subjects) {
      const code = subject.subjectCode.toUpperCase();
      const gradePoint = gradePointOf(subject.gradeLetter, ruleSet);
      const attempt = { semester: view.number, gradeLetter: subject.gradeLetter, gradePoint };
      const existing = byCode.get(code);

      const attempts = [...(existing?.attempts ?? []), attempt].sort(
        (a, b) => a.semester - b.semester,
      );
      const latest = attempts[attempts.length - 1];
      const first = attempts[0];

      let trend: SubjectTrend = 'single_attempt';
      const latestPoint = latest?.gradePoint ?? null;
      const firstPoint = first?.gradePoint ?? null;
      if (attempts.length > 1 && latestPoint !== null && firstPoint !== null) {
        trend =
          latestPoint > firstPoint
            ? 'improved'
            : latestPoint < firstPoint
              ? 'declined'
              : 'unchanged';
      }

      byCode.set(code, {
        subjectCode: code,
        subjectTitle: subject.subjectTitle,
        credits: subject.credits,
        gradeLetter: latest?.gradeLetter ?? subject.gradeLetter,
        gradePoint: latest?.gradePoint ?? gradePoint,
        semester: latest?.semester ?? view.number,
        attempts,
        trend,
      });
    }
  }

  return [...byCode.values()].sort(
    (a, b) => b.semester - a.semester || a.subjectCode.localeCompare(b.subjectCode),
  );
}

/* -------------------------------------------------------------------------- */
/* Strong and weak subjects                                                   */
/* -------------------------------------------------------------------------- */

export type SubjectStanding = 'strong' | 'typical' | 'weak';

export interface SubjectClassification {
  readonly performance: SubjectPerformance;
  readonly standing: SubjectStanding;
}

export interface StrengthAnalysis {
  readonly available: boolean;
  /** Why not, when `available` is false. Shown to the student verbatim. */
  readonly reason: string | null;
  /** The student's own mean grade point — the baseline everything is measured against. */
  readonly meanGradePoint: number | null;
  readonly threshold: number;
  readonly subjects: readonly SubjectClassification[];
}

/**
 * The minimum graded subjects before any subject is called strong or weak.
 *
 * Below this the "average" is one or two subjects and the comparison says
 * nothing. Five is the smallest number at which a VTU semester's spread is
 * represented at all.
 */
export const MIN_SUBJECTS_FOR_STRENGTH = 5;

/**
 * How far from the student's own mean counts as strong or weak.
 *
 * One full grade point. On VTU's ten-point scale that is exactly one letter
 * band, so the rule reads as "a whole grade above or below your own average" —
 * a sentence a student can check by hand.
 */
export const STRENGTH_THRESHOLD = 1;

/**
 * Strong and weak subjects, by a rule you can apply yourself.
 *
 *   mean       = the student's own mean grade point across every graded subject
 *   strong     = grade point >= mean + 1
 *   weak       = grade point <= mean - 1
 *   typical    = everything between
 *
 * NOT A PERCENTILE (M6 §9). A percentile would call the bottom of a uniformly
 * excellent set "weak" and rank a student against nothing but themselves in a
 * way that always produces losers. Measuring distance from the student's own
 * average produces no classification at all when performance is even — which
 * is the honest answer in that case.
 *
 * With fewer than five graded subjects this refuses to classify, and says why.
 */
export function analyseStrengths(performances: readonly SubjectPerformance[]): StrengthAnalysis {
  const graded = performances.filter((entry) => entry.gradePoint !== null);

  if (graded.length < MIN_SUBJECTS_FOR_STRENGTH) {
    return {
      available: false,
      reason:
        graded.length === 0
          ? 'No graded subjects yet. Add a semester result to see subject strengths.'
          : `Not enough history yet — ${String(graded.length)} graded subject${graded.length === 1 ? '' : 's'} of ${String(MIN_SUBJECTS_FOR_STRENGTH)} needed.`,
      meanGradePoint: null,
      threshold: STRENGTH_THRESHOLD,
      subjects: [],
    };
  }

  const mean = graded.reduce((total, entry) => total + (entry.gradePoint ?? 0), 0) / graded.length;

  const subjects = graded.map((performance) => {
    const point = performance.gradePoint ?? 0;
    const standing: SubjectStanding =
      point >= mean + STRENGTH_THRESHOLD
        ? 'strong'
        : point <= mean - STRENGTH_THRESHOLD
          ? 'weak'
          : 'typical';
    return { performance, standing };
  });

  return {
    available: true,
    reason: null,
    meanGradePoint: mean,
    threshold: STRENGTH_THRESHOLD,
    subjects,
  };
}

/* -------------------------------------------------------------------------- */
/* Backlogs                                                                   */
/* -------------------------------------------------------------------------- */

export interface BacklogSummary {
  readonly active: number;
  readonly attempted: number;
  readonly cleared: number;
  readonly outstanding: number;
}

export function summariseBacklogs(records: readonly BacklogRecord[]): BacklogSummary {
  const count = (status: BacklogRecord['status']) =>
    records.filter((record) => record.status === status).length;
  const active = count('active');
  const attempted = count('attempted');
  return {
    active,
    attempted,
    cleared: count('cleared'),
    // Attempted is not cleared: the result is not known yet.
    outstanding: active + attempted,
  };
}

/* -------------------------------------------------------------------------- */
/* Graduation progress                                                        */
/* -------------------------------------------------------------------------- */

export interface GraduationProgress {
  readonly creditsCompleted: number;
  /** Null when the requirement could not be established from verified data. */
  readonly creditsRequired: number | null;
  readonly creditsRemaining: number | null;
  readonly semestersCompleted: number;
  readonly semestersTotal: number;
  /** Present whenever `creditsRequired` is null. Shown verbatim. */
  readonly reason: string | null;
}

/**
 * How far through the degree the student is.
 *
 * THE TOTAL IS NOT ASSUMED (M6 §13). There is no universal VTU credit
 * requirement in this codebase, and inventing one — 160, 170, whatever a forum
 * says — would put a fabricated denominator under a real numerator. When the
 * requirement cannot be established from verified reference data, the credits
 * completed and the semesters completed are still true and are still shown; the
 * remainder is reported as unknown.
 */
export function graduationProgress(
  views: readonly SemesterView[],
  creditsRequired: number | null,
): GraduationProgress {
  const completed = views.filter((view) => view.status === 'completed');
  const creditsCompleted = completed.reduce((total, view) => total + view.credits, 0);

  return {
    creditsCompleted,
    creditsRequired,
    creditsRemaining:
      creditsRequired === null ? null : Math.max(0, creditsRequired - creditsCompleted),
    semestersCompleted: completed.length,
    semestersTotal: 8,
    reason:
      creditsRequired === null
        ? 'The total credits for this scheme are not established in verified reference data, so credits remaining cannot be shown.'
        : null,
  };
}
