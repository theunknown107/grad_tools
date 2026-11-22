/**
 * The printable academic summary, assembled from what the app already knows.
 *
 * Authority: docs/53 (result statement) · OQ-049 (missing is not zero) · 22OB 6.6–6.8
 *
 * NOTHING HERE CALCULATES. Every figure is read from the same sources the
 * results and academics screens use: SGPA, CGPA, percentage and credits from
 * `academicStatistics`, grades and pass/fail from `evaluateResultSubject`,
 * credits from `creditsOf`. A second calculation path would be a second answer
 * waiting to disagree with the first.
 *
 * NOTHING HERE INVENTS. A field the record does not hold is absent from the
 * statement, not printed as a blank or a zero, and a figure that could not be
 * worked out carries the reason it could not.
 */

import { calculateClass, getRuleSet, type RuleSet } from '@gradtools/academic-rules';
import type { AcademicStatistics, Metric } from './statistics.js';
import { hasNoBacklogs } from './statistics.js';
import { ruleSetForResult } from './academics.js';
import { creditsOf, evaluateResultSubject, markMaxima, type SubjectLookup } from './results.js';
import type { BacklogRecord, StudentProfile } from './types.js';

/** The exact words every statement carries, on screen and on paper. */
export const STATEMENT_DISCLAIMER =
  'GradTools-generated academic summary — not an official VTU marks card or transcript.';

export interface StatementStudent {
  readonly name?: string;
  readonly usn?: string;
  readonly college?: string;
  readonly programme?: string;
  readonly branch?: string;
  readonly scheme?: string;
}

/** A mark as printed, with its scale only where the scale is actually known. */
export interface StatementMark {
  readonly value: number;
  readonly outOf: number | null;
}

export interface StatementRow {
  readonly code: string | null;
  readonly title: string;
  readonly internal: StatementMark | null;
  readonly external: StatementMark | null;
  readonly total: StatementMark | null;
  readonly credits: number | null;
  readonly grade: { readonly letter: string; readonly points: number | null } | null;
  /** Where the grade came from: the card itself, or the rule set from the marks. */
  readonly gradeFrom: 'card' | 'rules' | null;
  /** The status letter the card printed, verbatim. */
  readonly printedStatus: string | null;
  /** What the rules make of the row. `null` is "not determined", never "passed". */
  readonly passed: boolean | null;
  /** Why the row could not be evaluated, when it could not. */
  readonly note: string | null;
}

export interface StatementSemester {
  readonly number: number;
  readonly rows: readonly StatementRow[];
  readonly sgpa: Metric<number>;
  /** The SGPA the student typed from their grade card, kept apart from the computed one. */
  readonly sgpaPrinted: number | null;
  readonly creditsAttempted: Metric<number>;
  readonly creditsEarned: Metric<number>;
  readonly ruleSetId: string | null;
}

export interface StatementCumulative {
  /** Only when it is really the CGPA (`academicStatistics`). */
  readonly cgpa: Metric<number>;
  /** Over the semesters that have resolved, with how many that covers. */
  readonly provisionalCgpa: Metric<number>;
  readonly basis: { readonly counted: number; readonly pending: readonly number[] };
  readonly percentage: Metric<number>;
  /**
   * The class awarded — only for a COMPLETED degree with no backlog, because
   * 22OB 6.8 awards a class on completion. Otherwise null, with `classNote`.
   */
  readonly classAwarded: string | null;
  readonly classNote: string | null;
}

export interface Statement {
  readonly generatedAt: string;
  readonly student: StatementStudent;
  readonly semesters: readonly StatementSemester[];
  /** Present only on the combined statement. */
  readonly cumulative: StatementCumulative | null;
  /** Backlogs the student recorded, as recorded. Never summed with result rows. */
  readonly recordedBacklogs: readonly BacklogRecord[];
  readonly ruleSets: readonly { readonly id: string; readonly sourceUrl: string }[];
}

const SCHEME_LABEL: Readonly<Record<string, string>> = {
  'vtu-2022': 'VTU 2022 scheme',
  'vtu-2025': 'VTU 2025 scheme',
};

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

function studentOf(profile: StudentProfile | null): StatementStudent {
  if (profile === null) return {};
  const scheme = SCHEME_LABEL[profile.schemeId] ?? present(profile.schemeId);
  return Object.fromEntries(
    Object.entries({
      name: present(profile.displayName),
      usn: present(profile.usn),
      college: present(profile.collegeName),
      programme: present(profile.programme),
      branch: present(profile.branch),
      scheme,
    }).filter(([, value]) => value !== undefined),
  ) as StatementStudent;
}

function mark(value: number | null, outOf: number | null): StatementMark | null {
  return value === null ? null : { value, outOf };
}

/** Courses a full degree has, by entry route. Diploma entry starts in semester 3. */
function degreeSemesters(profile: StudentProfile | null): number {
  return profile?.entryRoute === 'diploma' ? 6 : 8;
}

export function buildStatement(input: {
  readonly profile: StudentProfile | null;
  readonly statistics: AcademicStatistics;
  readonly backlogs: readonly BacklogRecord[];
  readonly identify: SubjectLookup;
  /** One semester, or every semester with a result. */
  readonly semester: number | null;
  readonly now?: Date;
}): Statement {
  const { profile, statistics, identify } = input;
  const ruleSets = new Map<string, RuleSet>();

  const semesters: StatementSemester[] = statistics.semesters
    .filter((entry) => entry.view.result !== null)
    .filter((entry) => input.semester === null || entry.number === input.semester)
    .map((entry) => {
      const result = entry.view.result!;
      const { ruleSet } = ruleSetForResult(result);
      if (ruleSet !== undefined) ruleSets.set(ruleSet.id, ruleSet);

      const rows = result.subjects.map((subject): StatementRow => {
        const evaluation = evaluateResultSubject(subject, ruleSet);
        const grade = evaluation.sourceGrade ?? evaluation.computedGrade;
        /* A scale is printed only where it is known: an unknown SEE means an unknown maximum. */
        const maxima =
          ruleSet !== undefined && subject.hasSee !== null
            ? markMaxima(subject.hasSee, ruleSet)
            : null;
        return {
          code: subject.subjectCode,
          title: subject.subjectTitle,
          internal: mark(subject.internal, maxima?.internal ?? null),
          external: mark(
            subject.external,
            subject.hasSee === true ? (maxima?.external ?? null) : null,
          ),
          total: mark(
            subject.total,
            ruleSet !== undefined && subject.hasSee !== null ? ruleSet.courseMax : null,
          ),
          credits: creditsOf(subject, identify(subject.subjectCode)),
          grade: grade === null ? null : { letter: grade.letter, points: grade.points },
          gradeFrom:
            evaluation.sourceGrade !== null
              ? 'card'
              : evaluation.computedGrade !== null
                ? 'rules'
                : null,
          printedStatus: subject.resultStatus,
          passed: evaluation.backlog === null ? null : !evaluation.backlog,
          note: evaluation.unavailableReason,
        };
      });

      return {
        number: entry.number,
        rows,
        sgpa: entry.sgpa,
        sgpaPrinted: entry.view.sgpaAsserted,
        creditsAttempted: entry.creditsAttempted,
        creditsEarned: entry.creditsEarned,
        ruleSetId: entry.view.ruleSetId,
      };
    });

  let cumulative: StatementCumulative | null = null;
  if (input.semester === null) {
    const complete =
      statistics.cgpa.status === 'resolved' &&
      statistics.cgpaBasis.counted >= degreeSemesters(profile) &&
      hasNoBacklogs(statistics);
    let classAwarded: string | null = null;
    let classNote: string | null =
      'A class is awarded on completing the degree with every course passed (22OB 6.8). It is not shown for an incomplete record.';
    if (complete && statistics.percentage.value !== null) {
      const ruleSet =
        getRuleSet(statistics.views.at(-1)?.ruleSetId ?? '') ?? [...ruleSets.values()].at(-1);
      const band =
        ruleSet === undefined ? null : calculateClass(statistics.percentage.value, ruleSet);
      if (band?.ok === true) {
        classAwarded = band.value.label;
        classNote = null;
      }
    }
    cumulative = {
      cgpa: statistics.cgpa,
      provisionalCgpa: statistics.provisionalCgpa,
      basis: statistics.cgpaBasis,
      percentage: statistics.percentage,
      classAwarded,
      classNote,
    };
  }

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    student: studentOf(profile),
    semesters,
    cumulative,
    recordedBacklogs:
      input.semester === null
        ? input.backlogs
        : input.backlogs.filter((record) => record.originSemester === input.semester),
    ruleSets: [...ruleSets.values()].map((ruleSet) => ({
      id: ruleSet.id,
      sourceUrl: ruleSet.sourceUrl,
    })),
  };
}
