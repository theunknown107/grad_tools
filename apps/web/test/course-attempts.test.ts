/**
 * Later sittings of a failed course (docs/53).
 *
 * Deterministic: outcome is read from what the sitting PRINTED, never re-graded
 * here, and no SGPA/CGPA is computed. Synthetic records only.
 */
import { describe, expect, it } from 'vitest';
import {
  attemptKey,
  attemptOutcome,
  courseAttemptHistories,
} from '../src/domain/course-attempts.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { CourseAttempt } from '../src/domain/types.js';

const pid = asStudentProfileId('local');
const attempt = (over: Partial<CourseAttempt>): CourseAttempt => ({
  id: over.id ?? 'a1',
  profileId: pid,
  semester: 3,
  subjectCode: 'BCS301',
  kind: 'makeup',
  session: 'Summer / Makeup - 2026',
  external: null,
  total: null,
  resultStatus: null,
  recordedAt: '2026-10-01T00:00:00Z',
  ...over,
});

describe('attemptOutcome', () => {
  it('reads only the printed status, never guessing a pass', () => {
    expect(attemptOutcome(attempt({ resultStatus: 'P' }))).toBe('passed');
    expect(attemptOutcome(attempt({ resultStatus: 'F' }))).toBe('not_passed');
    expect(attemptOutcome(attempt({ resultStatus: null }))).toBe('unknown');
    expect(attemptOutcome(attempt({ resultStatus: 'AB' }))).toBe('unknown');
  });
});

describe('attemptKey', () => {
  it('is the same for the same sitting however it is cased or spaced', () => {
    expect(
      attemptKey(attempt({ subjectCode: 'bcs301', session: ' Summer / Makeup - 2026 ' })),
    ).toBe(attemptKey(attempt({})));
  });
  it('differs across sessions, so two real sittings are two attempts', () => {
    expect(attemptKey(attempt({ session: 'Dec 2026' }))).not.toBe(attemptKey(attempt({})));
  });
});

describe('courseAttemptHistories', () => {
  it('groups sittings by course, newest last, and dedupes a re-entry of the same session', () => {
    const histories = courseAttemptHistories([
      attempt({ id: 'a', resultStatus: 'F', recordedAt: '2026-01-01T00:00:00Z' }),
      // Same session re-entered later with a correction: ONE attempt, the later one.
      attempt({ id: 'b', resultStatus: 'P', recordedAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(histories).toHaveLength(1);
    expect(histories[0]?.attempts).toHaveLength(1);
    expect(histories[0]?.attempts[0]?.id).toBe('b');
  });

  it('is cleared once any sitting printed a pass, and says which session', () => {
    const histories = courseAttemptHistories([
      attempt({
        id: 'a',
        session: 'Dec 2025',
        resultStatus: 'F',
        recordedAt: '2026-01-01T00:00:00Z',
      }),
      attempt({
        id: 'b',
        session: 'Summer / Makeup - 2026',
        resultStatus: 'P',
        recordedAt: '2026-02-01T00:00:00Z',
      }),
    ]);
    expect(histories[0]?.attempts).toHaveLength(2);
    expect(histories[0]?.standing).toBe('cleared');
    expect(histories[0]?.clearedIn).toBe('Summer / Makeup - 2026');
  });

  it('is pending while every recorded sitting failed, and unknown while none has a result', () => {
    expect(courseAttemptHistories([attempt({ resultStatus: 'F' })])[0]?.standing).toBe('pending');
    expect(courseAttemptHistories([attempt({ resultStatus: null })])[0]?.standing).toBe('unknown');
  });

  it('keeps two different courses apart', () => {
    const histories = courseAttemptHistories([
      attempt({ id: 'a', subjectCode: 'BCS301' }),
      attempt({ id: 'b', subjectCode: 'BCS302' }),
    ]);
    expect(histories).toHaveLength(2);
  });
});
