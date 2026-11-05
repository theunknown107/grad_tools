/**
 * The arithmetic behind marking, correcting and un-marking one class.
 *
 * Authority: docs/22 §22.67 · M10A.11 §11, §12, §13, §14, §44
 *
 * These are the sums the daily loop rests on. Every one of them is reversible,
 * which is the whole reason undo does not have to keep a copy of the record it
 * replaced — and the reason a correction from attended to missed can move one
 * counter without touching the other.
 *
 * The `ClassMark` collection these once accompanied is gone: it was a
 * fortnightly duplicate guard, and the ledger is a durable record of the same
 * classes (see attendance-ledger.test.ts). The sums are unchanged.
 */

import { describe, expect, it } from 'vitest';
import { applyDelta, countDelta, isCountable } from '../src/domain/attendance.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { AttendanceRecord } from '../src/domain/types.js';

const profileId = asStudentProfileId('p1');

function record(attended: number, conducted: number): AttendanceRecord {
  return {
    id: 'a1',
    profileId,
    semester: 5,
    subjectCode: 'BCS501',
    subjectTitle: 'Software Engineering',
    attended,
    conducted,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('what one decision does to the counts', () => {
  it('counts a first attended class in both totals', () => {
    expect(countDelta(null, 'attended')).toEqual({ attended: 1, conducted: 1 });
  });

  it('counts a first missed class only as one held', () => {
    // THE CASE THAT DECIDES WHETHER THIS IS A RATIO OR A SCORE.
    expect(countDelta(null, 'missed')).toEqual({ attended: 0, conducted: 1 });
  });

  it('corrects attended to missed without inventing a second class', () => {
    // The class still happened. Only who was there changed.
    expect(countDelta('attended', 'missed')).toEqual({ attended: -1, conducted: 0 });
  });

  it('corrects missed to attended without inventing a second class', () => {
    expect(countDelta('missed', 'attended')).toEqual({ attended: 1, conducted: 0 });
  });

  it('undoes exactly what it applied, either way round', () => {
    expect(countDelta('attended', null)).toEqual({ attended: -1, conducted: -1 });
    expect(countDelta('missed', null)).toEqual({ attended: 0, conducted: -1 });
  });

  it('does nothing at all when the answer has not changed', () => {
    // A second tap on the button that is already pressed is a second tap, not
    // a second class (§13).
    expect(countDelta('attended', 'attended')).toEqual({ attended: 0, conducted: 0 });
    expect(countDelta(null, null)).toEqual({ attended: 0, conducted: 0 });
  });
});

describe('moving a record by a delta', () => {
  it('returns the record to exactly where it started after an undo', () => {
    const before = record(30, 40);
    const marked = applyDelta(before, countDelta(null, 'attended'));
    const undone = applyDelta(marked, countDelta('attended', null));
    expect([undone.attended, undone.conducted]).toEqual([30, 40]);
  });

  it('never produces a record that says more attended than held', () => {
    /*
     * The counts are also editable by hand. A student who marks a class, then
     * types the totals down to nothing, must not be able to undo their way to a
     * negative record — every result stays countable.
     */
    const edited = record(0, 0);
    const undone = applyDelta(edited, countDelta('attended', null));
    expect(isCountable(undone)).toBe(true);
    expect([undone.attended, undone.conducted]).toEqual([0, 0]);
  });
});
