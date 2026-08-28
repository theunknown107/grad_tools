/**
 * Relevance, priority and deadlines — computed on the device.
 *
 * Authority: docs/12 §12.12 · docs/28 §28.11 · M7 §13, §14, §17, §18
 *
 * ---------------------------------------------------------------------------
 * THE STUDENT'S CONTEXT NEVER LEAVES THE DEVICE
 * ---------------------------------------------------------------------------
 * The server returns every published announcement, identical for every visitor,
 * and this decides which ones matter. That ordering is the whole privacy design:
 * a service that cannot personalise cannot learn who is asking (M7 §40).
 *
 * NO AI (M7 §42). Every rule below is a comparison you can do in your head, and
 * every one is stated in the interface that uses it.
 */

import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';

/* -------------------------------------------------------------------------- */
/* Relevance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the student's own device knows about them.
 *
 * Names, not identifiers, because that is what the profile actually stores: a
 * branch is chosen by name and a college is typed in.
 */
export interface StudentContext {
  readonly schemeId: string | null;
  readonly branchName: string | null;
  readonly collegeName: string | null;
  /** The semester marked in progress, or the profile's, or null. */
  readonly currentSemester: number | null;
}

export type Relevance =
  | 'global'
  | 'college_relevant'
  | 'branch_relevant'
  | 'semester_relevant'
  | 'scheme_relevant'
  | 'not_relevant';

/** Compares two names the way a person would: case and spacing do not matter. */
function sameName(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether an announcement is for this student, and on what grounds.
 *
 * EVERY NON-NULL CONSTRAINT MUST MATCH (M7 §14). A notice targeted at semester 5
 * of one branch reaches a semester-5 student of a different branch not at all —
 * an audience is a conjunction, and treating it as a disjunction would quietly
 * broadcast targeted notices to everyone.
 *
 * NULL ON AN AXIS MEANS "NOT TARGETED ON THAT AXIS", never "unknown". The
 * publisher chose not to restrict it, so it is not a restriction to enforce.
 *
 * WHEN THE STUDENT HAS NOT SAID, a targeted announcement is still shown. A
 * student who has not filled in their branch would otherwise silently lose every
 * branch notice and have no way to know it was happening — and the cost of the
 * other choice is one irrelevant notice, which is visibly wrong and fixable.
 */
export function relevanceOf(announcement: Announcement, context: StudentContext): Relevance {
  const { audience } = announcement;
  let grounds: Relevance = 'global';

  if (audience.schemeId !== null) {
    if (context.schemeId !== null && context.schemeId !== audience.schemeId) return 'not_relevant';
    grounds = 'scheme_relevant';
  }

  if (audience.collegeName !== null) {
    if (context.collegeName !== null && !sameName(context.collegeName, audience.collegeName)) {
      return 'not_relevant';
    }
    grounds = 'college_relevant';
  }

  if (audience.branchName !== null) {
    if (context.branchName !== null && !sameName(context.branchName, audience.branchName)) {
      return 'not_relevant';
    }
    grounds = 'branch_relevant';
  }

  if (audience.semester !== null) {
    if (context.currentSemester !== null && context.currentSemester !== audience.semester) {
      return 'not_relevant';
    }
    grounds = 'semester_relevant';
  }

  return grounds;
}

export function isRelevant(announcement: Announcement, context: StudentContext): boolean {
  return relevanceOf(announcement, context) !== 'not_relevant';
}

/** True when the announcement names any audience at all. */
export function isTargeted(announcement: Announcement): boolean {
  const { audience } = announcement;
  return (
    audience.schemeId !== null ||
    audience.branchName !== null ||
    audience.collegeName !== null ||
    audience.semester !== null
  );
}

/* -------------------------------------------------------------------------- */
/* Deadlines                                                                  */
/* -------------------------------------------------------------------------- */

export interface DeadlineInfo {
  readonly at: string;
  /** Whole days from `now` to the deadline. Negative once it has passed. */
  readonly daysLeft: number;
  readonly passed: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long is left, from a real timestamp or not at all.
 *
 * NOTHING IS DERIVED FROM WORDING (M7 §18). "Apply soon" produces no deadline
 * here, because a countdown a student plans around must come from a date the
 * publisher actually gave.
 *
 * Days are counted between calendar days rather than by dividing milliseconds,
 * so a deadline late tonight reads as "today" rather than "0.4 days".
 */
export function deadlineInfo(announcement: Announcement, now: Date): DeadlineInfo | null {
  if (announcement.deadlineAt === null) return null;
  const at = new Date(announcement.deadlineAt);
  if (Number.isNaN(at.getTime())) return null;

  const startOfDay = (date: Date) =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysLeft = Math.round((startOfDay(at) - startOfDay(now)) / MS_PER_DAY);

  return { at: announcement.deadlineAt, daysLeft, passed: at.getTime() < now.getTime() };
}

/* -------------------------------------------------------------------------- */
/* Priority                                                                   */
/* -------------------------------------------------------------------------- */

export type Priority = 'urgent' | 'important' | 'normal' | 'informational';

/**
 * Categories that carry consequences a student has to act on.
 *
 * A published rule, not a judgement: results and examination logistics change
 * what someone does next, a seminar notice does not.
 */
const IMPORTANT_CATEGORIES: ReadonlySet<AnnouncementCategory> = new Set([
  'results',
  'exam_timetable',
  'exam_registration',
  'backlog',
  'revaluation',
  'summer_semester',
]);

const INFORMATIONAL_CATEGORIES: ReadonlySet<AnnouncementCategory> = new Set([
  'holiday',
  'department_notice',
  'general',
]);

/** Inside this many days, a real deadline makes anything urgent. */
export const URGENT_WITHIN_DAYS = 2;

/**
 * How much attention an announcement deserves.
 *
 *   urgent         a real deadline within two days, and not yet passed
 *   important      results, examinations, backlogs, revaluation, summer term
 *   informational  holidays, department notices, anything general
 *   normal         everything else
 *
 * DETERMINISTIC, AND NEVER FROM A MODEL (M7 §17). Urgency comes only from a
 * date the publisher gave: an announcement with no deadline is never urgent
 * however alarming its wording, because inventing urgency is the fastest way to
 * make a student stop trusting the badge.
 *
 * A passed deadline drops back to its category's priority. It is history, and
 * shouting about it helps nobody.
 */
export function priorityOf(announcement: Announcement, now: Date): Priority {
  const deadline = deadlineInfo(announcement, now);

  if (deadline !== null && !deadline.passed && deadline.daysLeft <= URGENT_WITHIN_DAYS) {
    return 'urgent';
  }
  if (IMPORTANT_CATEGORIES.has(announcement.category)) return 'important';
  if (INFORMATIONAL_CATEGORIES.has(announcement.category)) return 'informational';
  return 'normal';
}

const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  important: 1,
  normal: 2,
  informational: 3,
};

/**
 * The student's feed: relevant first, most pressing first, newest first.
 *
 * Sorting rather than filtering by default — a student can still reach
 * everything, and a feed that silently hides notices is one a student cannot
 * trust to be complete.
 */
export function sortForStudent(
  announcements: readonly Announcement[],
  context: StudentContext,
  now: Date,
): Announcement[] {
  return [...announcements].sort((a, b) => {
    const relevance = Number(!isRelevant(a, context)) - Number(!isRelevant(b, context));
    if (relevance !== 0) return relevance;

    const priority = PRIORITY_ORDER[priorityOf(a, now)] - PRIORITY_ORDER[priorityOf(b, now)];
    if (priority !== 0) return priority;

    const aTime = a.publishedAt === null ? 0 : new Date(a.publishedAt).getTime();
    const bTime = b.publishedAt === null ? 0 : new Date(b.publishedAt).getTime();
    return bTime - aTime;
  });
}
