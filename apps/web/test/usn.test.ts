// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { branchNameForCode, parseUsn, semesterFromAdmission } from '../src/domain/usn.js';

describe('reading a USN on the device', () => {
  it('splits college, admission year and branch', () => {
    expect(parseUsn(' 1xx22cs001 ')).toEqual({
      collegeCode: 'XX',
      admissionYear: 2022,
      branchCode: 'CS',
    });
    expect(parseUsn('2AB24CB118')?.branchCode).toBe('CB');
    expect(parseUsn('not a usn')).toBeNull();
    expect(parseUsn(null)).toBeNull();
  });

  it('names known branch codes and never guesses an unknown one', () => {
    expect(branchNameForCode('CB')).toBe('Computer Science and Business Systems');
    expect(branchNameForCode('ZZ')).toBeNull();
  });

  it('places a regular-entry student in the semester the calendar implies', () => {
    expect(semesterFromAdmission(2024, new Date(2026, 10, 22))).toBe(5);
    expect(semesterFromAdmission(2024, new Date(2024, 8, 1))).toBe(1);
    expect(semesterFromAdmission(2026, new Date(2026, 5, 1))).toBeNull();
    expect(semesterFromAdmission(2018, new Date(2026, 10, 22))).toBeNull();
  });
});
