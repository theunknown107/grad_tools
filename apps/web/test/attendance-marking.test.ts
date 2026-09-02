/**
 * Recording a class, and what that must never do to the ratio.
 *
 * Authority: docs/22 §22.47 · core product §12, §32
 *
 * Attendance is a RATIO, and the two ways of getting it wrong are symmetrical:
 * counting a present day as `attended` only quietly improves the percentage,
 * and counting an absent day as nothing quietly preserves it. Both treat
 * attendance as a score. A class that happened raises `conducted` either way.
 */

import { describe, expect, it } from 'vitest';
import { calculateAttendance, vtu2022RuleSet } from '@gradtools/academic-rules';
import { isCountable, markClass, startRecord } from '../src/domain/attendance.js';
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

describe('marking one class', () => {
  it('raises both counts when the class was attended', () => {
    const next = markClass(record(30, 40), 'attended');
    expect([next.attended, next.conducted]).toEqual([31, 41]);
  });

  it('raises only the classes held when it was missed', () => {
    // THE CASE THAT DECIDES WHETHER THIS IS A RATIO OR A SCORE.
    const next = markClass(record(30, 40), 'missed');
    expect([next.attended, next.conducted]).toEqual([30, 41]);
  });

  it('moves the percentage in the right direction, either way', () => {
    const percentOf = (r: AttendanceRecord): number => {
      const outcome = calculateAttendance(r.attended, r.conducted, vtu2022RuleSet);
      if (!outcome.ok) throw new Error(outcome.detail);
      return outcome.value.percentage;
    };

    const before = percentOf(record(30, 40));
    expect(percentOf(markClass(record(30, 40), 'attended'))).toBeGreaterThan(before);
    expect(percentOf(markClass(record(30, 40), 'missed'))).toBeLessThan(before);
  });

  it('changes nothing else about the record', () => {
    // Identity, subject and semester are not the increment's business.
    const before = record(30, 40);
    const next = markClass(before, 'attended');
    expect(next.id).toBe(before.id);
    expect(next.subjectCode).toBe(before.subjectCode);
    expect(next.subjectTitle).toBe(before.subjectTitle);
    expect(next.semester).toBe(before.semester);
    expect(next.profileId).toBe(before.profileId);
  });

  it('stamps the record as changed, so a sync can see it', () => {
    const next = markClass(record(30, 40), 'attended');
    expect(next.updatedAt).not.toBe('2026-08-01T00:00:00.000Z');
  });

  it('can never make attended exceed conducted', () => {
    /*
     * A property, checked over every ratio a student could hold. `attended`
     * rises at most as fast as `conducted`, so an increment cannot manufacture
     * a percentage above 100 no matter how often it is tapped.
     */
    for (let conducted = 0; conducted <= 30; conducted += 1) {
      for (let attended = 0; attended <= conducted; attended += 1) {
        for (const outcome of ['attended', 'missed'] as const) {
          const next = markClass(record(attended, conducted), outcome);
          expect(next.attended).toBeLessThanOrEqual(next.conducted);
          expect(isCountable(next)).toBe(true);
        }
      }
    }
  });

  it('records a first class from nothing at all', () => {
    /*
     * Reached from today's timetable, for a subject the student has never
     * opened the attendance screen for. The title comes from the subject index
     * rather than being typed again (M10A.1).
     */
    const seed = {
      id: 'new',
      profileId,
      semester: 5,
      subjectCode: 'BCS502',
      subjectTitle: 'Computer Networks',
    };
    expect(startRecord(seed, 'attended')).toMatchObject({ attended: 1, conducted: 1 });
    expect(startRecord(seed, 'missed')).toMatchObject({ attended: 0, conducted: 1 });
    expect(startRecord(seed, 'missed').subjectTitle).toBe('Computer Networks');
  });

  it('is undone by keeping the record that came before it', () => {
    /*
     * Undo is the caller holding the previous value, not arithmetic that
     * subtracts one. Subtracting would happily take a record to -1 if it were
     * ever called twice, and an irreversible counter with a mis-tappable button
     * is worse than no button.
     */
    const before = record(30, 40);
    const after = markClass(before, 'attended');
    expect(after).not.toEqual(before);
    expect(before).toEqual(record(30, 40));
  });
});

describe('a record that could not have come from counting classes', () => {
  it('rejects attending more classes than were held', () => {
    expect(isCountable(record(41, 40))).toBe(false);
  });

  it('rejects fractional and negative counts', () => {
    expect(isCountable(record(1.5, 40))).toBe(false);
    expect(isCountable(record(-1, 40))).toBe(false);
  });

  it('accepts a subject whose classes have not started', () => {
    // 0 of 0 is not corrupt, it is a subject nobody has taught yet.
    expect(isCountable(record(0, 0))).toBe(true);
  });
});
