/**
 * Later sittings of a course the student did not pass first time.
 *
 * Authority: docs/53 · 22OB 4.3(7), 4.4, 6.3(9), 6.5(2), 6.9(4) · make-up
 * notification 2625 (21-08-2026)
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 *
 * Every appearance is an attempt (22OB 6.3(9)), so each is kept: a later
 * sitting never edits the original result row. This module records those
 * sittings, keeps them in order, dedupes an accidental re-entry of the same
 * one, and says the course's CURRENT standing — still to clear, or cleared,
 * and when.
 *
 * It does NOT recompute SGPA or CGPA. The regulation is not consistent about
 * how a re-pass affects them: 6.6(2)(b) divides CGPA by the credits registered,
 * while its own worked example (Annexure-I) divides by the credits earned
 * (excluding F), and 6.9(4) books a cleared course back to its own semester
 * while the Annexure books the re-pass into the semester it was sat in. Those
 * give materially different figures for any student with an F, and GradTools
 * does not choose between them (OQ-069). So a recorded attempt changes what the
 * course's standing SAYS, never a computed SGPA or CGPA.
 *
 * The grade on a successful re-pass is the one actually earned (22OB 6.5(2));
 * no cap was found in the regulation or the amendments. The CIE is the original
 * one carried forward (4.3(7)), so only what the later sitting printed is held.
 */

import { printedPass } from './results.js';
import type { CourseAttempt } from './types.js';

/** The exam kinds a student can record, newest regulation names. */
export const ATTEMPT_KIND_LABEL: Readonly<Record<CourseAttempt['kind'], string>> = {
  see: 'Regular SEE',
  makeup: 'Make-up / supplementary',
  summer: 'Summer semester',
};

/**
 * The identity of one sitting: a course, in a semester, in one session. Re-
 * entering the same session is a correction of that row, not a new attempt.
 */
export function attemptKey(
  attempt: Pick<CourseAttempt, 'semester' | 'subjectCode' | 'session'>,
): string {
  return `${String(attempt.semester)}:${attempt.subjectCode.trim().toUpperCase()}:${attempt.session.trim().toLowerCase()}`;
}

export type AttemptOutcome = 'passed' | 'not_passed' | 'unknown';

/**
 * Whether a recorded sitting passed, read ONLY from what it printed. A card
 * that printed P passed; one that printed F did not; anything else is unknown,
 * and unknown never becomes a pass. Marks are not re-graded here: the status
 * column is the university's statement about the sitting.
 */
export function attemptOutcome(attempt: CourseAttempt): AttemptOutcome {
  const printed = printedPass(attempt.resultStatus);
  return printed === null ? 'unknown' : printed ? 'passed' : 'not_passed';
}

/** A course that was not passed first time, with every later sitting in order. */
export interface CourseAttemptHistory {
  readonly semester: number;
  readonly subjectCode: string;
  readonly attempts: readonly CourseAttempt[];
  /** `cleared` once any sitting printed a pass; `pending` while none has; `unknown` otherwise. */
  readonly standing: 'cleared' | 'pending' | 'unknown';
  /** The session that cleared it, when one did. */
  readonly clearedIn: string | null;
}

/**
 * Groups attempts by course, newest sitting last, and states each course's
 * standing. Deduped by `attemptKey`, keeping the one recorded latest.
 */
export function courseAttemptHistories(attempts: readonly CourseAttempt[]): CourseAttemptHistory[] {
  const deduped = new Map<string, CourseAttempt>();
  for (const attempt of [...attempts].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    deduped.set(attemptKey(attempt), attempt);
  }

  const byCourse = new Map<string, CourseAttempt[]>();
  for (const attempt of deduped.values()) {
    const key = `${String(attempt.semester)}:${attempt.subjectCode.trim().toUpperCase()}`;
    byCourse.set(key, [...(byCourse.get(key) ?? []), attempt]);
  }

  return [...byCourse.values()].map((group) => {
    const ordered = [...group].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const first = ordered[0]!;
    const cleared = ordered.find((attempt) => attemptOutcome(attempt) === 'passed') ?? null;
    const anyKnown = ordered.some((attempt) => attemptOutcome(attempt) !== 'unknown');
    return {
      semester: first.semester,
      subjectCode: first.subjectCode,
      attempts: ordered,
      standing: cleared !== null ? 'cleared' : anyKnown ? 'pending' : 'unknown',
      clearedIn: cleared?.session ?? null,
    };
  });
}
