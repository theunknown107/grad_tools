import { calculateAttendance, vtu2022RuleSet } from '@gradtools/academic-rules';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ATTENDANCE_CRITERIA,
  attendanceCriteria,
  attendanceRules,
  setAttendanceCriteria,
} from '../src/lib/attendance-criteria.js';

const status = (attended: number, conducted: number) => {
  const result = calculateAttendance(attended, conducted, attendanceRules());
  return result.ok ? result.value.status : null;
};

describe('attendance criteria', () => {
  beforeEach(() => localStorage.clear());

  it('judges against 75% per course by default', () => {
    expect(attendanceCriteria()).toBe(DEFAULT_ATTENDANCE_CRITERIA);
    expect(DEFAULT_ATTENDANCE_CRITERIA).toBe(75);
    expect(status(32, 40)).toBe('safe'); // 80%
    expect(status(30, 40)).toBe('safe'); // 75%
    expect(status(29, 40)).toBe('dx_risk'); // 72.5%
  });

  it("follows a college that enforces VTU's full 85%", () => {
    setAttendanceCriteria(85);
    expect(status(32, 40)).toBe('below_requirement'); // 80%: condonable band
    expect(status(34, 40)).toBe('safe'); // 85%
  });

  it('never puts the DX floor above the chosen line, and keeps the regulation intact', () => {
    expect(attendanceRules(60).attendanceDxFloorPct).toBe(60);
    expect(attendanceRules(85).attendanceDxFloorPct).toBe(75);
    expect(vtu2022RuleSet.attendanceRequiredPct).toBe(85);
  });

  it('ignores a stored value that is not one of the offered options', () => {
    localStorage.setItem('gradtools:v1:attendance-criteria', '12');
    expect(attendanceCriteria()).toBe(75);
  });
});
