/**
 * Whether a source item is this student's business, and on what evidence.
 *
 * Authority: Phase 7B.3 §30–§43 · M7 §14
 *
 * ---------------------------------------------------------------------------
 * ONE ENGINE, TWO QUESTIONS — AND THEY ARE NOT THE SAME QUESTION
 * ---------------------------------------------------------------------------
 *
 * The browser already has `relevanceOf` (apps/web/src/domain/announcements),
 * and this does not duplicate it. That function answers "should this appear in
 * this student's list", and it answers leniently on purpose: a student who has
 * not filled in their branch is still SHOWN branch notices, because the cost is
 * one visibly irrelevant row they can act on.
 *
 * This answers "should we interrupt this student", and §34 and §35 require the
 * opposite posture. A notification nobody asked for cannot be un-sent, and an
 * item whose scope we cannot read must not go to everyone. So the MATCHING is
 * one set of rules — below — and the two policies differ only in what they do
 * with `unknown`.
 *
 * ---------------------------------------------------------------------------
 * AN AUDIENCE IS A CONJUNCTION
 * ---------------------------------------------------------------------------
 *
 * Every constraint the source states must match. A notice for semester 5 of one
 * branch reaches a semester-5 student of another branch not at all. Treating an
 * audience as a disjunction is how a targeted notice quietly becomes a
 * broadcast.
 *
 * NULL ON AN AXIS MEANS "NOT TARGETED ON THAT AXIS", never "unknown". The
 * publisher chose not to restrict it, so there is no restriction to enforce.
 * The difference matters: `semester: null` is university-wide on that axis,
 * while a semester the reader could not determine is `unresolved` — and those
 * two must never be spelled the same way.
 */

/** What a source item says about who it is for. Null = not targeted on that axis. */
export interface SourceAudience {
  /** "2022". Never inferred from the current date (§39). */
  readonly scheme: string | null;
  readonly programme: string | null;
  readonly branch: string | null;
  readonly department: string | null;
  readonly stream: string | null;
  readonly college: string | null;
  readonly semester: number | null;
  /** Exact codes, or documented aliases. Never a title match (§41). */
  readonly courses: readonly string[];
  /** The cycle in the source's own words: "Dec.2025/Jan.2026". */
  readonly examCycle: string | null;
  /**
   * True where the source states a scope the reader could not resolve.
   *
   * Distinct from every axis being null. "For the students concerned" is not
   * university-wide; it is a sentence nobody can act on (§35).
   */
  readonly unresolvedScope: boolean;
}

/** What the student is. Read from their own record, never assumed (§32). */
export interface StudentAudience {
  readonly scheme: string | null;
  readonly programme: string | null;
  readonly branch: string | null;
  readonly department: string | null;
  readonly stream: string | null;
  readonly college: string | null;
  readonly semester: number | null;
  readonly enrolledCourses: readonly string[];
  readonly backlogCourses: readonly string[];
}

export type Verdict = 'applicable' | 'not_applicable' | 'unresolved';

/** Every axis a source item can be targeted on. */
export type Dimension =
  | 'scheme'
  | 'programme'
  | 'branch'
  | 'department'
  | 'stream'
  | 'college'
  | 'semester'
  | 'course'
  | 'exam_cycle';

export interface Applicability {
  readonly verdict: Verdict;
  /** The axes that actually matched, for the explanation the student reads. */
  readonly matched: readonly Dimension[];
  /** Why, in words. Never a score. */
  readonly reason: string;
}

/** Compares two names the way a person would: case and spacing do not matter. */
function sameName(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** One axis, resolved three ways rather than two. */
type AxisResult = 'match' | 'miss' | 'not_targeted' | 'unknown';

function axis(target: string | null, held: string | null): AxisResult {
  if (target === null) return 'not_targeted';
  /*
   * THE SOURCE SAYS, AND THE STUDENT HAS NOT. That is not a match and it is
   * not a miss: it is a fact nobody recorded. For a notification it resolves
   * to "do not interrupt" rather than "interrupt anyway" (§34).
   */
  if (held === null) return 'unknown';
  return sameName(target, held) ? 'match' : 'miss';
}

const LABEL: Readonly<Record<Dimension, string>> = {
  scheme: 'scheme',
  programme: 'programme',
  branch: 'branch',
  department: 'department',
  stream: 'stream',
  college: 'college',
  semester: 'semester',
  course: 'course',
  exam_cycle: 'examination cycle',
};

/**
 * Whether this item is for this student.
 *
 * Returns `unresolved` rather than guessing in exactly two situations: the
 * source states a scope nobody could read, or it targets an axis the student's
 * own record is silent about. Neither is a reason to interrupt them, and
 * neither is a reason to decide they are excluded.
 */
export function applicabilityOf(source: SourceAudience, student: StudentAudience): Applicability {
  if (source.unresolvedScope) {
    return {
      verdict: 'unresolved',
      matched: [],
      reason:
        'This notice states a scope that could not be read, so who it is for is not established.',
    };
  }

  const axes: readonly (readonly [Dimension, AxisResult])[] = [
    ['scheme', axis(source.scheme, student.scheme)],
    ['programme', axis(source.programme, student.programme)],
    ['branch', axis(source.branch, student.branch)],
    ['department', axis(source.department, student.department)],
    ['stream', axis(source.stream, student.stream)],
    ['college', axis(source.college, student.college)],
    [
      'semester',
      source.semester === null
        ? 'not_targeted'
        : student.semester === null
          ? 'unknown'
          : source.semester === student.semester
            ? 'match'
            : 'miss',
    ],
  ];

  /* One miss on any stated axis settles it: an audience is a conjunction. */
  const missed = axes.find(([, result]) => result === 'miss');
  if (missed !== undefined) {
    return {
      verdict: 'not_applicable',
      matched: [],
      reason: `This notice is for a different ${LABEL[missed[0]]}.`,
    };
  }

  /*
   * COURSES ARE A DISJUNCTION, and deliberately so: a notice naming five
   * course codes is for anyone sitting ANY of them, which is the opposite of
   * how the other axes read. Enrolment and backlog both count — a backlog
   * paper is still the student's paper (§42).
   */
  const held = new Set(
    [...student.enrolledCourses, ...student.backlogCourses].map((code) => code.toUpperCase()),
  );
  const courseTargeted = source.courses.length > 0;
  const courseMatch = source.courses.some((code) => held.has(code.toUpperCase()));
  if (courseTargeted && !courseMatch) {
    return {
      verdict: 'not_applicable',
      matched: [],
      reason: 'This notice names courses none of which are yours.',
    };
  }

  const unknown = axes.filter(([, result]) => result === 'unknown');
  if (unknown.length > 0) {
    return {
      verdict: 'unresolved',
      matched: [],
      reason:
        `This notice is for a particular ${unknown.map(([name]) => LABEL[name]).join(' and ')}, ` +
        'and your profile does not say which is yours.',
    };
  }

  const matched: Dimension[] = axes
    .filter(([, result]) => result === 'match')
    .map(([name]) => name);
  if (courseMatch) matched.push('course');

  if (matched.length === 0) {
    /*
     * Nothing was targeted at all, so nothing had to match. That is a genuine
     * university-wide notice and it applies to everybody (§36).
     */
    return {
      verdict: 'applicable',
      matched: [],
      reason: 'This notice is for all students.',
    };
  }

  return {
    verdict: 'applicable',
    matched,
    reason: `Applies to your ${matched.map((name) => LABEL[name]).join(' · ')}.`,
  };
}
