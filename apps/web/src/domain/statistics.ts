/**
 * One derived academic state, for every screen that shows a figure.
 *
 * Authority: Phase 7C §1, §2, §4, §5, §6, §7, §8, §9, §10, §18, §28, §30
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The dashboard, the results page, the degree page and the analytics page each
 * built their own reading of the same records — four `buildSemesterViews`
 * calls, three separate `semesterSgpa` loops, and no two screens agreeing on
 * what "completed" counted. That is four chances for the same student's CGPA
 * to be right in one place and wrong in another, and it is why this module
 * exists rather than a fifth helper (§18).
 *
 * Nothing here computes an academic rule. Grades come from `resolveSubjectGrade`,
 * outcomes and percentages from `evaluateResultSubject`, SGPA and CGPA from
 * `@gradtools/academic-rules` through the existing `sgpaReading` and
 * `cumulativeStanding`. This assembles those answers, counts them, and attaches
 * a status and a provenance to each.
 *
 * ---------------------------------------------------------------------------
 * A METRIC IS NEVER JUST A NUMBER (§1)
 * ---------------------------------------------------------------------------
 *
 * `0`, `null`, unknown, unresolved and not-applicable are five different
 * things, and the product has already shipped bugs from collapsing them. A
 * backlog count of zero is good news; a backlog count that could not be
 * determined is a warning. Rendered as "0" they are the same pixel.
 *
 * So every figure below is a `Metric`: a value, a status, where it came from,
 * and — when there is no value — why not.
 *
 * ---------------------------------------------------------------------------
 * AND ONE MISSING FIELD MUST NOT EMPTY THE SCREEN (§4)
 * ---------------------------------------------------------------------------
 *
 * The reported bug was an all-or-none dependency: one course without credits
 * made the SGPA null, which made the CGPA null, which made the trend null,
 * which made the analytics page say "no figures yet". Every metric here is
 * therefore computed from its OWN inputs. A semester whose SGPA cannot be
 * calculated still reports its course count, its resolved credits, its grade
 * distribution and its pass count, because none of those needed the SGPA.
 */

import type { RuleSet, SpecialGrade } from '@gradtools/academic-rules';
import {
  buildSemesterViews,
  cumulativeStanding,
  ruleSetForResult,
  sgpaReading,
  summariseBacklogs,
  type SemesterView,
} from './academics.js';
import { evaluateResultSubject, resolveSubjectGrade } from './results.js';
import { resolveCourseKind } from './exams.js';
import type { BacklogRecord, ResultSubject, SemesterRecord, SemesterResult } from './types.js';

/* -------------------------------------------------------------------------- */
/* A metric                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What is known about one figure.
 *
 *   resolved        the value is complete and may be shown as a number
 *   partial         some inputs are known, but not enough for THIS figure
 *   unavailable     nothing established it; the data simply is not there
 *   not_applicable  the figure has no meaning for this record
 *   error           something that should have worked did not — a pinned rule
 *                   set this build does not have is the case that exists
 *
 * `partial` and `unavailable` are deliberately separate. "Eight of your nine
 * courses are graded" is a sentence a student can act on; "no data" is not.
 */
export type MetricStatus = 'resolved' | 'partial' | 'unavailable' | 'not_applicable' | 'error';

export interface Metric<T> {
  /** Non-null exactly when `status` is `resolved`. */
  readonly value: T | null;
  readonly status: MetricStatus;
  /** What this figure was derived from. Shown, not just logged (§28). */
  readonly source: string | null;
  /** Why there is no value. Null exactly when there is one. */
  readonly reason: string | null;
}

function resolved<T>(value: T, source: string): Metric<T> {
  return { value, status: 'resolved', source, reason: null };
}

function unresolved<T>(status: Exclude<MetricStatus, 'resolved'>, reason: string): Metric<T> {
  return { value: null, status, source: null, reason };
}

/* -------------------------------------------------------------------------- */
/* Provenance (§28)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Where each kind of figure comes from, in the words a screen shows.
 *
 * Named constants rather than inline strings so that a figure cannot be
 * described one way on the dashboard and another way on the degree page — and
 * so that "the scheme said so" can never be written next to something the
 * student typed (§28, and §14 before it).
 */
export const SOURCE = {
  results: 'Your imported result records',
  resultsAndRules: 'Result records and the 2022 rule set',
  resultsCreditsRules: 'Result records, course credits and the 2022 rule set',
  schemeCredits: 'Course credits from the scheme',
  backlogRecords: 'Your backlog records',
  semesterRecords: 'Your semester records',
} as const;

/* -------------------------------------------------------------------------- */
/* Counting courses                                                           */
/* -------------------------------------------------------------------------- */

/**
 * How one course ended, in the categories a student would recognise.
 *
 * Deliberately NOT "passed or failed". The regulations define seven grades
 * that are neither — an audit, a non-credit pass, an absence, an attendance
 * bar — and collapsing them into "failed" would tell a student they must re-sit
 * a course they audited (§8).
 */
export type CourseOutcome =
  | 'passed'
  | 'failed'
  | 'absent'
  | 'attendance_shortage'
  | 'audit'
  | 'non_credit_passed'
  | 'non_credit_not_passed'
  | 'incomplete'
  | 'withdrawn'
  | 'unresolved';

export const OUTCOME_LABEL: Readonly<Record<CourseOutcome, string>> = {
  passed: 'Passed',
  failed: 'Failed',
  absent: 'Absent',
  attendance_shortage: 'Attendance shortage',
  audit: 'Audit',
  non_credit_passed: 'Non-credit passed',
  non_credit_not_passed: 'Non-credit not passed',
  incomplete: 'Incomplete',
  withdrawn: 'Withdrawn',
  unresolved: 'Requires review',
};

/** Which outcome each special grade means. Read from the rule set's own letters. */
const SPECIAL_OUTCOME: Readonly<Record<string, CourseOutcome>> = {
  DX: 'attendance_shortage',
  AU: 'audit',
  AB: 'absent',
  PP: 'non_credit_passed',
  NP: 'non_credit_not_passed',
  IC: 'incomplete',
  W: 'withdrawn',
};

export type OutcomeCounts = Readonly<Record<CourseOutcome, number>>;

const NO_OUTCOMES: OutcomeCounts = {
  passed: 0,
  failed: 0,
  absent: 0,
  attendance_shortage: 0,
  audit: 0,
  non_credit_passed: 0,
  non_credit_not_passed: 0,
  incomplete: 0,
  withdrawn: 0,
  unresolved: 0,
};

/**
 * How one course row ended.
 *
 * A SPECIAL GRADE SETTLES IT BEFORE THE MARKS DO. `AB` means the student was
 * absent whatever the marks column happens to hold, and `DX` means they were
 * barred from the exam — reading either as a fail would be the regulation's
 * word for something else. Only when no special grade applies do the three
 * passing heads decide, and where they cannot the answer is `unresolved`
 * rather than a guess in either direction.
 */
function outcomeOf(subject: ResultSubject, ruleSet: RuleSet | undefined): CourseOutcome {
  const grade = resolveSubjectGrade(subject, ruleSet);
  const special = grade === null ? undefined : SPECIAL_OUTCOME[grade.letter.toUpperCase()];
  if (special !== undefined) return special;

  const evaluation = evaluateResultSubject(subject, ruleSet);
  if (evaluation.outcome === null) return 'unresolved';
  return evaluation.outcome.passed ? 'passed' : 'failed';
}

/* -------------------------------------------------------------------------- */
/* Grade distribution (§7)                                                    */
/* -------------------------------------------------------------------------- */

export interface GradeDistribution {
  /** Ordinary letters, in the rule set's own order, best first. */
  readonly bands: readonly { readonly letter: string; readonly count: number }[];
  /** The non-standard grades, each with the regulation's own wording. */
  readonly specials: readonly {
    readonly letter: string;
    readonly meaning: string;
    readonly count: number;
  }[];
  /**
   * Courses carrying no resolvable grade.
   *
   * COUNTED SEPARATELY AND NEVER AS A LETTER (§7). Adding them to F would
   * invent failures; adding them to P would invent passes; leaving them out
   * entirely would make the columns not add up to the courses on screen.
   */
  readonly unresolved: number;
  readonly total: number;
}

function emptyDistribution(ruleSet: RuleSet | undefined): GradeDistribution {
  return {
    bands: (ruleSet?.gradeBands ?? []).map((band) => ({ letter: band.letter, count: 0 })),
    specials: (ruleSet?.specialGrades ?? []).map((special: SpecialGrade) => ({
      letter: special.letter,
      meaning: special.meaning,
      count: 0,
    })),
    unresolved: 0,
    total: 0,
  };
}

function distributionOf(
  subjects: readonly ResultSubject[],
  ruleSet: RuleSet | undefined,
): GradeDistribution {
  const bands = new Map<string, number>();
  const specials = new Map<string, number>();
  let unresolved = 0;

  for (const band of ruleSet?.gradeBands ?? []) bands.set(band.letter, 0);
  for (const special of ruleSet?.specialGrades ?? []) specials.set(special.letter, 0);

  for (const subject of subjects) {
    const grade = resolveSubjectGrade(subject, ruleSet);
    if (grade === null) {
      unresolved += 1;
      continue;
    }
    const letter = grade.letter.toUpperCase();
    if (bands.has(letter)) bands.set(letter, (bands.get(letter) ?? 0) + 1);
    else if (specials.has(letter)) specials.set(letter, (specials.get(letter) ?? 0) + 1);
    /*
     * A letter the rule set does not define is not silently dropped and not
     * silently added to a band it resembles. It is unresolved: this build
     * cannot say what it means.
     */ else unresolved += 1;
  }

  return {
    bands: [...bands.entries()].map(([letter, count]) => ({ letter, count })),
    specials: (ruleSet?.specialGrades ?? []).map((special) => ({
      letter: special.letter,
      meaning: special.meaning,
      count: specials.get(special.letter) ?? 0,
    })),
    unresolved,
    total: subjects.length,
  };
}

/* -------------------------------------------------------------------------- */
/* One semester                                                               */
/* -------------------------------------------------------------------------- */

export interface SemesterStatistics {
  readonly number: number;
  readonly view: SemesterView;
  readonly hasResult: boolean;

  readonly courseCount: number;
  /** Courses whose grade AND credits are both known. */
  readonly resolvedCourses: number;
  readonly unresolvedCourses: number;

  /** Credits of every course that counts towards a GPA at all. */
  readonly creditsAttempted: Metric<number>;
  /** Credits of those that passed. Zero is a real answer here. */
  readonly creditsEarned: Metric<number>;
  /** How many courses have no credit figure. Not a credit total — a count. */
  readonly creditsUnresolved: number;

  readonly sgpa: Metric<number>;
  readonly grades: GradeDistribution;
  readonly outcomes: OutcomeCounts;
  /** Mean of each course's own percentage, so different maxima cannot skew it. */
  readonly averagePercentage: Metric<number>;
}

/**
 * Everything one semester's record supports, each figure on its own inputs.
 *
 * The SGPA is the only metric here with an all-or-none rule, and it has one
 * for a reason the regulation gives: it is credit-weighted across the whole
 * semester, so grading six of nine courses produces a real-looking number that
 * is not the student's SGPA. Every OTHER figure on this object is computed
 * from the courses that do resolve, and reports the ones that do not
 * alongside — which is the difference between a page that goes blank and a
 * page that says what is missing (§4).
 */
function semesterStatistics(view: SemesterView): SemesterStatistics {
  const result = view.result;

  if (result === null) {
    return {
      number: view.number,
      view,
      hasResult: false,
      courseCount: 0,
      resolvedCourses: 0,
      unresolvedCourses: 0,
      creditsAttempted: unresolved(
        'unavailable',
        view.status === 'in_progress'
          ? 'This semester is still in progress.'
          : 'No result has been entered for this semester.',
      ),
      creditsEarned: unresolved('unavailable', 'No result has been entered for this semester.'),
      creditsUnresolved: 0,
      sgpa: sgpaMetric(view),
      grades: emptyDistribution(undefined),
      outcomes: NO_OUTCOMES,
      averagePercentage: unresolved('unavailable', 'No marks have been entered.'),
    };
  }

  const { ruleSet } = ruleSetForResult(result);
  const outcomes: Record<CourseOutcome, number> = { ...NO_OUTCOMES };

  let creditsAttempted = 0;
  let creditsEarned = 0;
  let creditsUnresolved = 0;
  let resolvedCourses = 0;
  const percentages: number[] = [];

  for (const subject of result.subjects) {
    const outcome = outcomeOf(subject, ruleSet);
    outcomes[outcome] += 1;

    const grade = resolveSubjectGrade(subject, ruleSet);
    if (grade !== null && subject.credits !== null) resolvedCourses += 1;
    if (subject.credits === null) creditsUnresolved += 1;

    /*
     * A NON-CREDIT OR AUDIT COURSE IS NOT ORDINARY CREDIT (§9). It is excluded
     * from both totals rather than added as a zero — the zero would be
     * arithmetically harmless and would still make the course look like one
     * that was attempted for credit and earned none.
     */
    const kind = resolveCourseKind(subject, null, ruleSet);
    if (kind.countsTowardGpa !== false && subject.credits !== null) {
      creditsAttempted += subject.credits;
      if (outcome === 'passed') creditsEarned += subject.credits;
    }

    const evaluation = evaluateResultSubject(subject, ruleSet);
    if (evaluation.outcome !== null) percentages.push(evaluation.outcome.marks.percentage);
  }

  const courseCount = result.subjects.length;
  const unresolvedCourses = courseCount - resolvedCourses;

  return {
    number: view.number,
    view,
    hasResult: true,
    courseCount,
    resolvedCourses,
    unresolvedCourses,
    /*
     * Credits are reported from the courses that HAVE them, and the courses
     * that do not are counted beside the figure rather than folded into it. A
     * total that silently omitted three courses would be indistinguishable
     * from a smaller semester.
     */
    creditsAttempted:
      creditsUnresolved === 0
        ? resolved(creditsAttempted, SOURCE.schemeCredits)
        : {
            value: creditsAttempted,
            status: 'partial',
            source: SOURCE.schemeCredits,
            reason: `${String(creditsUnresolved)} of ${String(courseCount)} courses have no credit figure, so this total is only of the rest.`,
          },
    creditsEarned:
      creditsUnresolved === 0 && outcomes.unresolved === 0
        ? resolved(creditsEarned, SOURCE.resultsCreditsRules)
        : {
            value: creditsEarned,
            status: 'partial',
            source: SOURCE.resultsCreditsRules,
            reason:
              outcomes.unresolved > 0
                ? `${String(outcomes.unresolved)} course${outcomes.unresolved === 1 ? '' : 's'} could not be read as passed or failed, so credits earned may be higher.`
                : `${String(creditsUnresolved)} course${creditsUnresolved === 1 ? '' : 's'} have no credit figure.`,
          },
    creditsUnresolved,
    sgpa: sgpaMetric(view),
    grades: distributionOf(result.subjects, ruleSet),
    outcomes,
    /*
     * §10: the mean of each course's OWN percentage, never of raw marks. A
     * course marked out of 100 and one marked out of 50 cannot be averaged
     * together as printed, and the rule set has already normalised each row.
     */
    averagePercentage:
      percentages.length === 0
        ? unresolved('unavailable', 'No course in this semester has a complete set of marks.')
        : percentages.length === courseCount
          ? resolved(mean(percentages), SOURCE.resultsAndRules)
          : {
              value: mean(percentages),
              status: 'partial',
              source: SOURCE.resultsAndRules,
              reason: `Across ${String(percentages.length)} of ${String(courseCount)} courses; the rest have incomplete marks.`,
            },
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * A semester's SGPA, with the reason when it has none.
 *
 * `sgpaReading` already produces the sentence; this attaches the status that
 * separates "some of your courses still need review" from "you have not
 * entered this semester" (§5).
 */
function sgpaMetric(view: SemesterView): Metric<number> {
  const reading = sgpaReading(view);
  if (reading.value !== null) return resolved(reading.value, SOURCE.resultsCreditsRules);
  if (view.result === null) {
    return unresolved('not_applicable', reading.reason ?? 'No result for this semester.');
  }
  if (view.ruleSetResolution === 'unavailable') {
    return unresolved('error', reading.reason ?? 'The rule set is unavailable.');
  }
  return unresolved('partial', reading.reason ?? 'Some courses still need review.');
}

/* -------------------------------------------------------------------------- */
/* The whole degree                                                           */
/* -------------------------------------------------------------------------- */

/** One point on the trend. A semester with no SGPA is a deliberate gap (§13). */
export interface TrendPoint {
  readonly semester: number;
  readonly sgpa: number | null;
  readonly status: MetricStatus;
}

export interface DataQuality {
  readonly coursesImported: number;
  readonly creditsResolved: number;
  readonly coursesNeedingReview: number;
  /** One line per issue, naming what and where. Empty when there is nothing. */
  readonly notes: readonly string[];
}

export interface AcademicStatistics {
  readonly semesters: readonly SemesterStatistics[];
  readonly views: readonly SemesterView[];

  readonly semestersCompleted: Metric<number>;
  readonly semestersGraded: Metric<number>;
  readonly latestSgpa: Metric<{ readonly semester: number; readonly sgpa: number }>;
  readonly cgpa: Metric<number>;
  readonly percentage: Metric<number>;

  readonly creditsAttempted: Metric<number>;
  readonly creditsEarned: Metric<number>;
  readonly creditsRemaining: Metric<number>;
  readonly creditsUnresolved: number;

  readonly grades: GradeDistribution;
  readonly outcomes: OutcomeCounts;
  readonly backlogs: Metric<number>;
  readonly averagePercentage: Metric<number>;

  readonly trend: readonly TrendPoint[];
  readonly strongestSemester: Metric<{ readonly semester: number; readonly sgpa: number }>;
  readonly weakestSemester: Metric<{ readonly semester: number; readonly sgpa: number }>;

  readonly dataQuality: DataQuality;
  /** True once anything at all has been imported — the empty-state test (§17). */
  readonly hasAnyResult: boolean;
}

/**
 * Every figure the student's records support, computed once.
 *
 * The order matters only in that each block depends on the semester
 * statistics above it and on nothing else. There is no point at which a
 * failure to resolve one figure prevents the next from being computed, and
 * that is the property §4 asks for — not an optimisation but the difference
 * between a page that explains itself and a page that goes blank.
 */
export function academicStatistics(input: {
  readonly semesters: readonly SemesterRecord[];
  readonly results: readonly SemesterResult[];
  readonly backlogs: readonly BacklogRecord[];
  /** The degree's credit requirement, from the rule set. Null when unknown. */
  readonly totalCreditsRequired?: number | null;
}): AcademicStatistics {
  const views = buildSemesterViews(input.semesters, input.results);
  const stats = views.map(semesterStatistics);
  const withResults = stats.filter((entry) => entry.hasResult);
  const standing = cumulativeStanding(views);

  /* ---- Totals, each from the semesters that support it ------------------ */

  const creditsUnresolved = withResults.reduce((sum, entry) => sum + entry.creditsUnresolved, 0);
  const creditsAttempted = sumMetric(
    withResults.map((entry) => entry.creditsAttempted),
    SOURCE.schemeCredits,
    `${String(creditsUnresolved)} course${creditsUnresolved === 1 ? '' : 's'} across your semesters have no credit figure yet.`,
  );
  const creditsEarned = sumMetric(
    withResults.map((entry) => entry.creditsEarned),
    SOURCE.resultsCreditsRules,
    'Some courses could not be read as passed or failed, so the true figure may be higher.',
  );

  /* ---- Grades and outcomes, pooled across every semester ----------------- */

  const grades = mergeDistributions(withResults.map((entry) => entry.grades));
  const outcomes = mergeOutcomes(withResults.map((entry) => entry.outcomes));

  /* ---- The trend, with gaps rather than interpolation (§13) -------------- */

  const trend: TrendPoint[] = stats.map((entry) => ({
    semester: entry.number,
    sgpa: entry.sgpa.value,
    status: entry.sgpa.status,
  }));

  const graded = stats.filter((entry) => entry.sgpa.value !== null);
  const ranked = [...graded].sort((a, b) => (a.sgpa.value ?? 0) - (b.sgpa.value ?? 0));

  /*
   * A RANKING NEEDS TWO THINGS TO RANK (§12). With one graded semester the
   * strongest and the weakest are the same semester, which is true and
   * useless, and printing it invites reading it as a comparison.
   */
  const rankingReason =
    graded.length === 0
      ? 'No semester has a calculated SGPA yet.'
      : 'Only one semester has a calculated SGPA, so there is nothing to compare it with.';
  const best = ranked[ranked.length - 1];
  const worst = ranked[0];

  const percentageOfCourses = withResults
    .map((entry) => entry.averagePercentage)
    .filter((metric) => metric.value !== null);

  const backlogSummary = summariseBacklogs(input.backlogs);
  const required = input.totalCreditsRequired ?? null;

  return {
    semesters: stats,
    views,

    semestersCompleted: resolved(
      views.filter((view) => view.status === 'completed').length,
      SOURCE.semesterRecords,
    ),
    semestersGraded: resolved(graded.length, SOURCE.resultsCreditsRules),

    latestSgpa:
      graded.length === 0
        ? unresolved('partial', 'No semester has a calculated SGPA yet.')
        : resolved(
            {
              semester: (graded[graded.length - 1] as SemesterStatistics).number,
              sgpa: (graded[graded.length - 1] as SemesterStatistics).sgpa.value as number,
            },
            SOURCE.resultsCreditsRules,
          ),

    cgpa:
      standing.cgpa !== null
        ? resolved(standing.cgpa, SOURCE.resultsCreditsRules)
        : unresolved(
            withResults.length === 0 ? 'unavailable' : 'partial',
            standing.reason ?? 'No semester has a calculated SGPA to average.',
          ),
    percentage:
      standing.percentage !== null
        ? resolved(standing.percentage, SOURCE.resultsCreditsRules)
        : standing.cgpa === null
          ? unresolved(
              withResults.length === 0 ? 'unavailable' : 'partial',
              standing.reason ?? 'A percentage follows the CGPA.',
            )
          : unresolved('not_applicable', 'This rule set defines no percentage conversion.'),

    creditsAttempted,
    creditsEarned,
    creditsRemaining:
      required === null
        ? unresolved('unavailable', 'The credit requirement for this programme is not recorded.')
        : creditsEarned.value === null
          ? unresolved('partial', 'Credits earned are not fully resolved yet.')
          : {
              value: Math.max(0, required - creditsEarned.value),
              status: creditsEarned.status === 'resolved' ? 'resolved' : 'partial',
              source: SOURCE.resultsCreditsRules,
              reason:
                creditsEarned.status === 'resolved'
                  ? null
                  : 'Follows credits earned, which is not fully resolved.',
            },
    creditsUnresolved,

    grades,
    outcomes,

    /*
     * A BACKLOG COUNT THAT COULD NOT BE DETERMINED IS NOT ZERO (§1). Zero
     * backlogs is the best news the page carries; an undetermined count
     * rendered as zero is the worst thing it could get wrong.
     */
    backlogs:
      backlogSummary.outstanding === 0 && outcomes.unresolved > 0
        ? {
            value: backlogSummary.outstanding,
            status: 'partial',
            source: SOURCE.backlogRecords,
            reason: `${String(outcomes.unresolved)} course${outcomes.unresolved === 1 ? '' : 's'} could not be read as passed or failed, so there may be more.`,
          }
        : resolved(backlogSummary.outstanding, SOURCE.backlogRecords),

    averagePercentage:
      percentageOfCourses.length === 0
        ? unresolved('unavailable', 'No semester has a complete set of marks yet.')
        : {
            value: mean(percentageOfCourses.map((metric) => metric.value as number)),
            status: percentageOfCourses.every((metric) => metric.status === 'resolved')
              ? 'resolved'
              : 'partial',
            source: SOURCE.resultsAndRules,
            reason: percentageOfCourses.every((metric) => metric.status === 'resolved')
              ? null
              : 'Some courses have incomplete marks and are left out.',
          },

    trend,
    strongestSemester:
      graded.length < 2 || best === undefined
        ? unresolved('partial', rankingReason)
        : resolved(
            { semester: best.number, sgpa: best.sgpa.value as number },
            SOURCE.resultsCreditsRules,
          ),
    weakestSemester:
      graded.length < 2 || worst === undefined
        ? unresolved('partial', rankingReason)
        : resolved(
            { semester: worst.number, sgpa: worst.sgpa.value as number },
            SOURCE.resultsCreditsRules,
          ),

    dataQuality: dataQualityOf(stats, grades, creditsUnresolved),
    hasAnyResult: withResults.length > 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Adds figures that may each be partial.
 *
 * The sum of partial parts is partial: it is a real total of what is known,
 * and it is not the answer. Saying so is the whole point — a figure that
 * silently omitted three courses is indistinguishable from a smaller degree.
 */
function sumMetric(
  parts: readonly Metric<number>[],
  source: string,
  partialReason: string,
): Metric<number> {
  const usable = parts.filter((part) => part.value !== null);
  if (usable.length === 0) {
    return unresolved('unavailable', 'No semester has a result with credits yet.');
  }
  const total = usable.reduce((sum, part) => sum + (part.value ?? 0), 0);
  return parts.every((part) => part.status === 'resolved')
    ? resolved(total, source)
    : { value: total, status: 'partial', source, reason: partialReason };
}

function mergeDistributions(parts: readonly GradeDistribution[]): GradeDistribution {
  const bands = new Map<string, number>();
  const specials = new Map<string, { meaning: string; count: number }>();
  let unresolvedCount = 0;
  let total = 0;

  for (const part of parts) {
    for (const band of part.bands)
      bands.set(band.letter, (bands.get(band.letter) ?? 0) + band.count);
    for (const special of part.specials) {
      const existing = specials.get(special.letter);
      specials.set(special.letter, {
        meaning: special.meaning,
        count: (existing?.count ?? 0) + special.count,
      });
    }
    unresolvedCount += part.unresolved;
    total += part.total;
  }

  return {
    bands: [...bands.entries()].map(([letter, count]) => ({ letter, count })),
    specials: [...specials.entries()].map(([letter, entry]) => ({
      letter,
      meaning: entry.meaning,
      count: entry.count,
    })),
    unresolved: unresolvedCount,
    total,
  };
}

function mergeOutcomes(parts: readonly OutcomeCounts[]): OutcomeCounts {
  const merged: Record<CourseOutcome, number> = { ...NO_OUTCOMES };
  for (const part of parts) {
    for (const key of Object.keys(merged) as CourseOutcome[]) merged[key] += part[key];
  }
  return merged;
}

/**
 * What the analysis rests on, said plainly (§29).
 *
 * Written as reassurance first and warnings second, because a student whose
 * data is 34 courses good and 1 course short should not be shown a screen that
 * reads like a failure.
 */
function dataQualityOf(
  stats: readonly SemesterStatistics[],
  grades: GradeDistribution,
  creditsUnresolved: number,
): DataQuality {
  const withResults = stats.filter((entry) => entry.hasResult);
  const coursesImported = withResults.reduce((sum, entry) => sum + entry.courseCount, 0);
  const notes: string[] = [];

  const ungraded = withResults.filter((entry) => entry.sgpa.status === 'partial');
  if (ungraded.length > 0) {
    notes.push(
      `SGPA is not calculated for semester${ungraded.length === 1 ? '' : 's'} ${ungraded
        .map((entry) => String(entry.number))
        .join(', ')} — every course in a semester needs a grade and credits.`,
    );
  }

  const brokenRuleSet = withResults.filter((entry) => entry.sgpa.status === 'error');
  if (brokenRuleSet.length > 0) {
    notes.push(
      `Semester${brokenRuleSet.length === 1 ? '' : 's'} ${brokenRuleSet
        .map((entry) => String(entry.number))
        .join(
          ', ',
        )} ${brokenRuleSet.length === 1 ? 'was' : 'were'} graded under a rule set this version does not have.`,
    );
  }

  return {
    coursesImported,
    creditsResolved: coursesImported - creditsUnresolved,
    coursesNeedingReview: grades.unresolved,
    notes,
  };
}
