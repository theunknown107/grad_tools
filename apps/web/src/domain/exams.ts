/**
 * What kind of course this is, and which sitting a result came from.
 *
 * Authority: Phase 7B §8 · 22OB 6.1 · DEC-037 · docs/37 (never invent)
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS FILLS
 * ---------------------------------------------------------------------------
 *
 * `ResultSubject.hasSee` is a three-valued boolean and the only thing in the
 * product that says how a course is assessed. It is not enough, for two
 * reasons:
 *
 *   - It cannot express a NON-CREDIT MANDATORY course or an AUDIT course. The
 *     regulations say both exist, both carry their own grades (PP/NP and AU),
 *     and both are excluded from CGPA — and with only a boolean available they
 *     were being graded as if they were ordinary subjects.
 *   - It was null for almost every imported subject, because the only source
 *     was a reference catalogue that is frequently empty. A null `hasSee`
 *     blocks the pass/backlog state, which blocks the grade, which blocks the
 *     SGPA. One missing reference row emptied the whole page.
 *
 * ---------------------------------------------------------------------------
 * WHAT DEC-037 ACTUALLY FORBIDS
 * ---------------------------------------------------------------------------
 *
 * DEC-037 is about ZERO, and it is exactly right: an external of 0 is equally
 * consistent with "this course has no SEE" and "this student sat the SEE and
 * scored nothing", the two have opposite outcomes, and no arithmetic separates
 * them. That case stays unknown here and always will.
 *
 * It says nothing about a POSITIVE external, because there is nothing to say: a
 * student cannot score marks in an examination that does not exist. So
 * `external > 0` resolves `hasSee` to true — not as a guess, as a fact — and
 * that single reading resolves the great majority of real subjects without
 * weakening the decision by a word. The asymmetry is the whole point, and it is
 * why this is an extension of DEC-037 rather than a reversal of it.
 *
 * ---------------------------------------------------------------------------
 * AND WHAT IS STILL REFUSED
 * ---------------------------------------------------------------------------
 *
 * An external of 0 with no other evidence stays `null`, the course kind stays
 * unknown, and the backlog state stays unknown and says so. That is the
 * message Phase 7B §8 says not to hide — it is hidden by ANSWERING it, for the
 * cases that can honestly be answered, and left standing for the ones that
 * cannot.
 */

import type { RuleSet } from '@gradtools/academic-rules';
import type { ResultSubject, SemesterResult } from './types.js';
import type { SubjectIdentity } from './subjects.js';

/* -------------------------------------------------------------------------- */
/* Course kind                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How a course is assessed, in the terms the regulations use.
 *
 *   see_bearing  CIE + SEE. The ordinary case; graded on the combined
 *                percentage, and both minima must be met to pass.
 *   cie_only     No semester-end examination. The regulations state the letter
 *                grade comes from CIE alone, so `courseMax` is the CIE max and
 *                there is no SEE minimum to fail.
 *   non_credit   Non-Credit Mandatory Course. Carries PP or NP, is worth no
 *                credits, and is NOT included in CGPA — but completion is
 *                mandatory for the degree, so it is never simply hidden.
 *   audit        Audited. Carries AU with 0 points and is excluded from both
 *                SGPA and CGPA.
 */
export const COURSE_KINDS = ['see_bearing', 'cie_only', 'non_credit', 'audit'] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];

/**
 * Where a course kind was established.
 *
 * Attribution, not a confidence score. `marks` is the narrowest of the three
 * and is the one worth naming on screen, because it is the reading a person
 * might want to overrule.
 */
export type CourseKindFrom = 'catalogue' | 'grade' | 'marks';

export interface ResolvedCourseKind {
  readonly kind: CourseKind | null;
  readonly from: CourseKindFrom | null;
  /** Three-valued, as DEC-037 requires. Null means genuinely unknown. */
  readonly hasSee: boolean | null;
  /**
   * Whether this course takes part in SGPA and CGPA.
   *
   * Null when the kind is unknown — the honest answer, and the one that keeps
   * an unresolved course out of a figure rather than silently into it.
   */
  readonly countsTowardGpa: boolean | null;
}

const UNKNOWN: ResolvedCourseKind = {
  kind: null,
  from: null,
  hasSee: null,
  countsTowardGpa: null,
};

/**
 * Grades that identify the kind of course they were awarded on.
 *
 * These are not inferences. The regulations DEFINE PP and NP as the grades of a
 * non-credit mandatory course and AU as the grade of an audited one, so a card
 * printing one of them has stated what kind of course it is. Reading it is
 * reading, not guessing.
 *
 * `DX`, `AB`, `IC` and `W` are deliberately absent: each describes what
 * happened to a STUDENT in a course, not what kind of course it is. A DX is an
 * ordinary SEE-bearing subject the student was debarred from.
 */
const KIND_BY_GRADE: Readonly<Record<string, CourseKind>> = {
  PP: 'non_credit',
  NP: 'non_credit',
  AU: 'audit',
};

function shaped(kind: CourseKind, from: CourseKindFrom): ResolvedCourseKind {
  return {
    kind,
    from,
    hasSee: kind === 'see_bearing' ? true : kind === 'cie_only' ? false : null,
    /*
     * Non-credit and audit courses are excluded from CGPA by the regulations.
     * They are excluded from SGPA too, for the arithmetic reason: both are
     * credit-weighted, and a course worth zero credits contributes nothing to
     * either sum — including it changes no figure and only invites a
     * divide-by-zero on a semester made entirely of them.
     */
    countsTowardGpa: kind === 'see_bearing' || kind === 'cie_only',
  };
}

/**
 * What kind of course this row describes.
 *
 * Sources, in order, each strictly stronger than the one after it:
 *
 *   1. THE REFERENCE CATALOGUE. `hasSee` from a verified subject row is the
 *      scheme's own answer.
 *   2. THE GRADE THE CARD PRINTED. PP, NP and AU are defined by the regulations
 *      as the grades of non-credit and audited courses.
 *   3. THE MARKS, IN ONE DIRECTION ONLY. A positive external means an SEE was
 *      sat. A zero external means nothing at all (DEC-037).
 *
 * Returns `kind: null` when none of the three can answer, and every caller must
 * handle that rather than defaulting — a defaulted `see_bearing` on a course
 * that has no SEE reports a backlog the university never gave.
 */
export function resolveCourseKind(
  subject: ResultSubject,
  identity: SubjectIdentity | null = null,
  ruleSet?: RuleSet,
): ResolvedCourseKind {
  const reference = subject.hasSee ?? identity?.hasSee ?? null;
  if (reference !== null) {
    return shaped(reference ? 'see_bearing' : 'cie_only', 'catalogue');
  }

  const printed = subject.gradeLetter?.trim().toUpperCase();
  if (printed !== undefined && printed !== '') {
    const byGrade = KIND_BY_GRADE[printed];
    if (byGrade !== undefined) return shaped(byGrade, 'grade');
  }

  /*
   * THE ONE-WAY READING. Marks in an examination are proof the examination
   * happened; the absence of marks is proof of nothing. Only the positive
   * branch exists here, and that asymmetry is deliberate.
   */
  if (subject.external !== null && subject.external > 0) {
    return shaped('see_bearing', 'marks');
  }

  /*
   * AND THE MIRROR OF IT: A CIE THAT DOES NOT FIT THE CIE SCALE.
   *
   * A SEE-bearing course is marked out of `cieMax` internally — 50 under VTU
   * 2022. An internal of 96 cannot be a mark out of 50, so a row carrying one
   * is not a SEE-bearing course; it is a course assessed entirely by CIE, out
   * of `courseMax`. That is arithmetic about the scale, not a guess about the
   * curriculum, and it is as one-directional as the rule above: an internal
   * that DOES fit the CIE scale says nothing either way, because a CIE-only
   * course can score low too.
   *
   * Found on real cards: three rows across two semesters printed an internal
   * far above the CIE maximum with an external of zero, and asking a person
   * about them was asking a question the marks had already answered. Every one
   * of them stayed unresolved when answered wrongly — the honest outcome, and
   * not a useful one.
   */
  if (
    ruleSet !== undefined &&
    subject.internal !== null &&
    subject.internal > ruleSet.cieMax &&
    (subject.external === null || subject.external === 0)
  ) {
    return shaped('cie_only', 'marks');
  }

  return UNKNOWN;
}

/**
 * The `hasSee` to evaluate this row with, or null.
 *
 * A thin wrapper, so callers that only need the boolean do not have to know
 * about course kinds — and so there is exactly one place the resolution order
 * is written down.
 */
export function hasSeeFor(
  subject: ResultSubject,
  identity: SubjectIdentity | null = null,
  ruleSet?: RuleSet,
): boolean | null {
  return resolveCourseKind(subject, identity, ruleSet).hasSee;
}

/* -------------------------------------------------------------------------- */
/* Exam sessions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One sitting of one semester's examinations.
 *
 * ---------------------------------------------------------------------------
 * DERIVED, NOT STORED — AND THAT IS THE DESIGN
 * ---------------------------------------------------------------------------
 *
 * A session is (semester, when it was announced). Both are already on every
 * saved result, so this is a reading of existing records rather than a new
 * table, a new migration, a new sync collection and a new thing for a device to
 * be offline from. If a session ever needs facts of its OWN — a timetable, a
 * hall, a fee — it becomes a stored entity then, on evidence, and this function
 * is the seam to replace.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * A backlog cleared in a later sitting and the original failure are the SAME
 * semester and the same subject; only the session tells them apart. Without it
 * a repeat attempt looks like a contradiction in the student's own record, and
 * "which of these two results is current" has no answer.
 */
export interface ExamSession {
  /** Stable within a student's own records: `sem-4@2026-07-23`. */
  readonly id: string;
  readonly semester: number;
  /** The announcement date shared by the rows, ISO `YYYY-MM-DD`, or null. */
  readonly announcedOn: string | null;
  /** For display: "Semester 4 · announced 23 Jul 2026". */
  readonly label: string;
}

/**
 * The session a saved result belongs to.
 *
 * The announcement date is taken from the SUBJECT ROWS, because that is where a
 * VTU card prints it, and only when they agree. Rows announced on different
 * days are not one sitting, and picking the earliest — or the most common —
 * would be inventing a date the card does not state.
 */
export function examSessionOf(result: SemesterResult): ExamSession {
  const dates = new Set(
    result.subjects
      .map((subject) => subject.announcedOn)
      .filter((value): value is string => value !== null && value !== ''),
  );
  const announcedOn = dates.size === 1 ? ([...dates][0] ?? null) : null;

  return {
    id: `sem-${String(result.semester)}@${announcedOn ?? 'undated'}`,
    semester: result.semester,
    announcedOn,
    label:
      announcedOn === null
        ? `Semester ${String(result.semester)}`
        : `Semester ${String(result.semester)} · announced ${announcedOn}`,
  };
}
