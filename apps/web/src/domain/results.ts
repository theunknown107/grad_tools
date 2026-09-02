/**
 * What a result card says, and what follows from it.
 *
 * Authority: docs/08 §8.19 · docs/16 §16.13 · docs/32 OQ-049, DEC-037
 *
 * ---------------------------------------------------------------------------
 * SOURCE AND COMPUTED ARE TWO DIFFERENT KINDS OF FACT
 * ---------------------------------------------------------------------------
 *
 * A `ResultSubject` holds ONLY what the student read off their card. Nothing in
 * this module writes to one. Everything derived — the total from the columns,
 * the grade from the rule set, the backlog state — comes back in a separate
 * `SubjectEvaluation`, so a screen can show both and say which is which, and so
 * no computed value can ever be persisted over the printed one (OQ-049 §3).
 *
 * ---------------------------------------------------------------------------
 * NO ARITHMETIC THAT A REGULATION OWNS HAPPENS HERE
 * ---------------------------------------------------------------------------
 *
 * Passing, backlog, grade banding and SGPA all come from
 * `@gradtools/academic-rules`. This module decides only ONE thing: whether the
 * inputs are sufficient to ask. That judgement is the whole substance of
 * OQ-049 — the old model made every field mandatory, so the question never
 * arose and a missing value was filled in by the student instead.
 */

import {
  calculateSGPA,
  evaluateCourseResult,
  gradeFromMarks,
  isOk,
  resolveGrade,
  type CourseResult,
  type RuleSet,
} from '@gradtools/academic-rules';
import type { ResultSubject, SemesterResult, SubjectProvenance } from './types.js';

/* -------------------------------------------------------------------------- */
/* Reading what is already stored                                             */
/* -------------------------------------------------------------------------- */

/**
 * A number, from wherever it came.
 *
 * STRINGS ARE NOT A LAPSE HERE. A `numeric` column comes back from postgres.js
 * as a string — `credits` has always arrived as `"4.0"` — and a form input is a
 * string too. Rejecting those would turn every synced credit and every typed
 * mark into "not available", which is precisely the silent emptying this
 * normaliser exists to prevent.
 */
function finiteOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  // A `date` column arrives as a Date. Kept as the calendar day it names, with
  // no timezone applied: an announcement date is a day printed on a page.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * A stored subject row, read defensively.
 *
 * NOTHING TYPE-CHECKS INDEXEDDB. Rows written before OQ-049 carry `credits` and
 * `gradeLetter` and none of the marks fields, and a field added later reads as
 * `undefined` rather than null. A `ResultSubject` whose `internal` is
 * `undefined` passes `!== null` and reaches arithmetic as `NaN`, which is how a
 * page goes blank on a record that looks fine in storage — the same class of
 * bug the M9.6B sweep found on `sgpaAsserted`.
 *
 * So every read goes through here and an absent field becomes null, which is
 * what it means. A legacy row keeps its grade and credits and gains marks
 * fields that are honestly empty rather than zero: a zero would say the student
 * scored nothing.
 */
export function normalizeResultSubject(raw: unknown): ResultSubject {
  const row = (raw ?? {}) as Record<string, unknown>;
  const provenance: SubjectProvenance = row.provenance === 'catalogue' ? 'catalogue' : 'manual';
  const code = typeof row.subjectCode === 'string' ? row.subjectCode : '';

  return {
    id: typeof row.id === 'string' ? row.id : '',
    subjectCode: code,
    subjectTitle: typeof row.subjectTitle === 'string' ? row.subjectTitle : code,
    internal: finiteOrNull(row.internal),
    external: finiteOrNull(row.external),
    total: finiteOrNull(row.total),
    resultStatus: textOrNull(row.resultStatus),
    announcedOn: textOrNull(row.announcedOn),
    gradeLetter: textOrNull(row.gradeLetter),
    gradePoint: finiteOrNull(row.gradePoint),
    credits: finiteOrNull(row.credits),
    hasSee: typeof row.hasSee === 'boolean' ? row.hasSee : null,
    provenance,
  };
}

/** The same, for a whole saved semester. Applied at the storage boundary. */
export function normalizeResult(raw: SemesterResult): SemesterResult {
  const subjects = (raw as { subjects?: readonly unknown[] }).subjects ?? [];
  return { ...raw, subjects: subjects.map(normalizeResultSubject) };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type ResultSubjectField =
  'subjectCode' | 'internal' | 'external' | 'total' | 'credits' | 'announcedOn';

export interface ResultSubjectIssue {
  readonly field: ResultSubjectField;
  readonly message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The maxima a mark is checked against.
 *
 * A course with no SEE is assessed on CIE over the WHOLE course maximum (22OB
 * 6.1(3)) — which is why a real Physical Education row can print an internal
 * well above the ordinary CIE maximum. Where `hasSee` is unknown the ceiling is
 * the permissive one: refusing a mark on a guess about the course's structure
 * would stop a student entering what their own card prints.
 */
export function markMaxima(
  hasSee: boolean | null,
  ruleSet: RuleSet,
): { readonly internal: number; readonly external: number } {
  return {
    internal: hasSee === true ? ruleSet.cieMax : ruleSet.courseMax,
    external: ruleSet.courseMax - ruleSet.cieMax,
  };
}

/**
 * Everything wrong with one entered row, or an empty list.
 *
 * MISSING IS NOT INVALID (OQ-049 §4). A row carrying only a subject code and an
 * internal mark is a legitimate partial record of a card the student has in
 * front of them, and it saves. What does NOT save is a row that contradicts
 * itself — columns that do not add up are a transcription error, every figure
 * derived from them would be wrong, and so it is refused rather than repaired
 * (OQ-049 §8).
 */
export function validateResultSubject(
  subject: ResultSubject,
  ruleSet: RuleSet,
): ResultSubjectIssue[] {
  const issues: ResultSubjectIssue[] = [];

  if (subject.subjectCode.trim() === '') {
    issues.push({ field: 'subjectCode', message: 'A subject code is required.' });
  }

  const maxima = markMaxima(subject.hasSee, ruleSet);
  const bounded = [
    ['internal', subject.internal, maxima.internal],
    ['external', subject.external, maxima.external],
    ['total', subject.total, ruleSet.courseMax],
  ] as const;

  for (const [field, value, max] of bounded) {
    if (value === null) continue;
    if (value < 0) {
      issues.push({ field, message: 'Marks cannot be negative.' });
      continue;
    }
    if (value > max) {
      issues.push({ field, message: `The maximum here is ${String(max)}.` });
    }
  }

  /*
   * The cross-field check, and the only one that can reject an otherwise
   * plausible row. It runs ONLY when all three are present: with one side
   * missing there is nothing to disagree with, and demanding the other side
   * would be demanding a number the card may not have printed.
   */
  if (subject.internal !== null && subject.external !== null && subject.total !== null) {
    const sum = subject.internal + subject.external;
    if (subject.total !== sum) {
      issues.push({
        field: 'total',
        message:
          `Total ${String(subject.total)} does not match ` +
          `${String(subject.internal)} + ${String(subject.external)} = ${String(sum)}. ` +
          'Check the card — nothing is corrected for you.',
      });
    }
  }

  if (subject.credits !== null && (subject.credits < 0 || subject.credits > 30)) {
    issues.push({ field: 'credits', message: 'Credits must be between 0 and 30.' });
  }

  if (subject.announcedOn !== null && !ISO_DATE.test(subject.announcedOn)) {
    issues.push({ field: 'announcedOn', message: 'Use the date format YYYY-MM-DD.' });
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/** A grade, and the points that go with it. */
export interface GradeReading {
  readonly letter: string;
  readonly points: number | null;
}

export interface SubjectEvaluation {
  /** `internal + external`, when both are present. Never written to the record. */
  readonly computedTotal: number | null;
  /** True when a printed total and the computed one disagree. Both stay visible. */
  readonly totalDisagrees: boolean;

  /** The full three-head outcome, when it could be asked for. */
  readonly outcome: CourseResult | null;
  /**
   * Whether this course must be carried.
   *
   * THREE-VALUED ON PURPOSE. `null` is "not known", and it is the honest answer
   * whenever `hasSee` is unknown or a mark is missing — because an external of
   * 0 reads identically as "this course has no SEE" and "sat it and scored
   * nothing", and those have opposite outcomes (DEC-037).
   */
  readonly backlog: boolean | null;
  /** Why there is no outcome. Shown to the student verbatim. Null when there is one. */
  readonly unavailableReason: string | null;

  /** What the source printed, if anything. */
  readonly sourceGrade: GradeReading | null;
  /** What the rule set makes of the marks. Never overwrites `sourceGrade` (§13, §14). */
  readonly computedGrade: GradeReading | null;
  /** Set when both exist and name different letters. */
  readonly gradeDisagrees: boolean;
}

function sourceGradeOf(subject: ResultSubject, ruleSet: RuleSet | undefined): GradeReading | null {
  if (subject.gradeLetter === null) return null;
  /*
   * The SOURCE's own grade point wins over the rule set's, and neither is
   * written over the other: a card printing both a letter and a point is
   * stating a fact, and if the rule set disagrees that is worth seeing.
   */
  if (subject.gradePoint !== null) {
    return { letter: subject.gradeLetter, points: subject.gradePoint };
  }
  if (ruleSet === undefined) return { letter: subject.gradeLetter, points: null };
  const resolved = resolveGrade(subject.gradeLetter, ruleSet);
  return { letter: subject.gradeLetter, points: isOk(resolved) ? resolved.value.points : null };
}

/**
 * Everything that follows from one printed row, and nothing that does not.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REFUSES TO ANSWER
 * ---------------------------------------------------------------------------
 *
 * **A backlog state without `hasSee`.** The most dangerous inference available
 * in this product: reading `external < 18` as a backlog tells a student they
 * have failed a course the university passed them in, every time a CIE-only
 * course appears (DEC-037, OQ-049 §10, §11).
 *
 * **A grade for a carried course.** `gradeFromMarks` bands a percentage, and a
 * course that failed a head is not graded on its percentage. Rather than
 * implement a second, unverified rule for what letter a carried course earns,
 * no computed grade is offered and the reason says so.
 *
 * **Anything at all without a rule set.** A pinned rule set this build does not
 * have stays unavailable; no substitute is reached for (M6 §6, OQ-049 §13).
 */
export function evaluateResultSubject(
  subject: ResultSubject,
  ruleSet: RuleSet | undefined,
): SubjectEvaluation {
  const computedTotal =
    subject.internal !== null && subject.external !== null
      ? subject.internal + subject.external
      : null;

  const sourceGrade = sourceGradeOf(subject, ruleSet);
  const base = {
    computedTotal,
    totalDisagrees:
      computedTotal !== null && subject.total !== null && subject.total !== computedTotal,
    outcome: null,
    backlog: null,
    sourceGrade,
    computedGrade: null,
    gradeDisagrees: false,
  } as const;

  if (ruleSet === undefined) {
    return {
      ...base,
      unavailableReason: 'The rule set this semester was graded under is not available here.',
    };
  }

  if (subject.hasSee === null) {
    return {
      ...base,
      unavailableReason:
        'Whether this course has a semester-end exam is not known, so its pass or backlog state cannot be worked out. An external of 0 means both "no SEE" and "sat the SEE and scored nothing".',
    };
  }

  const total = subject.total ?? computedTotal;
  if (subject.internal === null || subject.external === null || total === null) {
    return {
      ...base,
      unavailableReason: 'Internal and external marks are needed to work this out.',
    };
  }

  const outcome = evaluateCourseResult(
    {
      subjectCode: subject.subjectCode,
      internal: subject.internal,
      external: subject.external,
      total,
    },
    ruleSet,
    { hasSee: subject.hasSee },
  );

  if (!isOk(outcome)) return { ...base, unavailableReason: outcome.detail };

  let computedGrade: GradeReading | null = null;
  if (outcome.value.passed) {
    const band = gradeFromMarks(total, ruleSet.courseMax, ruleSet);
    if (isOk(band)) computedGrade = { letter: band.value.letter, points: band.value.points };
  }

  return {
    ...base,
    outcome: outcome.value,
    backlog: outcome.value.backlog,
    unavailableReason: null,
    computedGrade,
    gradeDisagrees:
      sourceGrade !== null && computedGrade !== null && sourceGrade.letter !== computedGrade.letter,
  };
}

/* -------------------------------------------------------------------------- */
/* What a semester can be graded on                                           */
/* -------------------------------------------------------------------------- */

export interface SgpaInputs {
  /** Every subject carrying BOTH credits and a grade letter. */
  readonly courses: readonly {
    readonly credits: number;
    readonly gradeLetter: string;
    readonly subjectCode: string;
  }[];
  /** True only when every subject in the semester qualifies. */
  readonly complete: boolean;
  /** Subjects that could not take part, and why. */
  readonly missing: readonly { readonly subjectCode: string; readonly reason: string }[];
}

/**
 * The courses an SGPA may be computed from — all of them, or none.
 *
 * A PARTIAL SGPA IS A WRONG SGPA (OQ-049 §16). SGPA is credit-weighted across
 * the whole semester, so computing it from the six subjects that happen to
 * carry grades and ignoring the three that do not produces a plausible number
 * that is not the student's SGPA, with nothing on screen to say so.
 *
 * `complete` is therefore what a caller must check, and the subjects that held
 * it back are named — so the student sees what to fill in rather than being
 * told the figure is simply unavailable.
 */
export function sgpaInputs(result: SemesterResult): SgpaInputs {
  const courses: { credits: number; gradeLetter: string; subjectCode: string }[] = [];
  const missing: { subjectCode: string; reason: string }[] = [];

  for (const subject of result.subjects) {
    const grade = subject.gradeLetter;
    const credits = subject.credits;
    if (grade !== null && credits !== null) {
      courses.push({ credits, gradeLetter: grade, subjectCode: subject.subjectCode });
      continue;
    }
    missing.push({
      subjectCode: subject.subjectCode,
      reason:
        grade === null && credits === null
          ? 'no grade or credits'
          : grade === null
            ? 'no grade'
            : 'no credits',
    });
  }

  return { courses, complete: missing.length === 0 && courses.length > 0, missing };
}

/**
 * The backlog count for a whole semester, and whether it is complete.
 *
 * A semester where one row's SEE applicability is unknown has an UNKNOWN
 * backlog count, not a smaller one. Reporting "1 backlog" while a second row
 * could not be evaluated would understate the thing a student most needs to be
 * right about.
 */
export function semesterBacklogs(
  result: SemesterResult,
  ruleSet: RuleSet | undefined,
): { readonly backlogs: number; readonly undetermined: number } {
  let backlogs = 0;
  let undetermined = 0;
  for (const subject of result.subjects) {
    const evaluation = evaluateResultSubject(subject, ruleSet);
    if (evaluation.backlog === null) undetermined += 1;
    else if (evaluation.backlog) backlogs += 1;
  }
  return { backlogs, undetermined };
}

/**
 * One semester's SGPA and known credits — the single place this pair is worked out.
 *
 * The dashboard, the results overview and the GPA page each used to map the
 * subjects into `calculateSGPA` themselves and sum the credits inline. Three
 * copies of a rule that has just become conditional is three chances to keep
 * grading an incomplete semester, so they now all call this (OQ-049 §29).
 */
export function semesterSgpa(
  result: SemesterResult,
  ruleSet: RuleSet | undefined,
): {
  readonly sgpa: number | null;
  readonly credits: number;
  readonly inputs: SgpaInputs;
} {
  const inputs = sgpaInputs(result);
  const credits = result.subjects.reduce((total, subject) => total + (subject.credits ?? 0), 0);

  if (ruleSet === undefined || !inputs.complete) return { sgpa: null, credits, inputs };
  const outcome = calculateSGPA(inputs.courses, ruleSet);
  return { sgpa: isOk(outcome) ? outcome.value : null, credits, inputs };
}
