/**
 * Grade-card mark row validation.
 *
 * Authority: docs/16 §16.5 (22OB 4.1(4)), §16.6 (22OB 6.3), §16.3 (22OB 6.1(3))
 *
 * The valid cases are SYNTHETIC rows shaped like the ones a VTU grade card
 * prints, and the malformed cases are mutations of them, so every rejection
 * test starts from a well-formed row rather than an arbitrary shape. These were
 * once transcribed from a real card; that record has been removed from this
 * public repository and the shape kept (docs/12).
 */

import { describe, expect, it } from 'vitest';
import { validateCourseMarks, type CourseMarks } from '../src/marks.js';
import { vtu2022RuleSet } from '../src/rulesets/vtu-2022.js';
import { isOk } from '../src/result.js';

const rs = vtu2022RuleSet;

/** A well-formed synthetic row: internal 42, external 33, total 75. */
const ROW: CourseMarks = { subjectCode: 'BXXX401', internal: 42, external: 33, total: 75 };

function expectRejected(marks: CourseMarks, options?: { hasSee?: boolean }) {
  const result = validateCourseMarks(marks, rs, options);
  expect(isOk(result)).toBe(false);
  if (!isOk(result)) {
    expect(result.reason).toBe('invalid_input');
    expect(result.detail.length).toBeGreaterThan(0);
  }
  return result;
}

describe('validateCourseMarks — accepts well-formed rows', () => {
  it('accepts an ordinary CIE + SEE row and reports its percentage', () => {
    const result = validateCourseMarks(ROW, rs);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.percentage).toBe(75);
      expect(result.value.hasSee).toBe(true);
      expect(result.value.total).toBe(75);
    }
  });

  it('normalises a lowercase, padded subject code', () => {
    const result = validateCourseMarks({ ...ROW, subjectCode: '  bxxx401 ' }, rs);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.subjectCode).toBe('BXXX401');
  });

  it('returns an explanation citing the clause', () => {
    const result = validateCourseMarks(ROW, rs);
    if (isOk(result)) {
      expect(result.explanation.clause).toContain('4.1(4)');
      expect(result.explanation.steps.length).toBeGreaterThan(0);
    }
  });

  it('accepts a zero row (a real possibility for a failed course)', () => {
    const result = validateCourseMarks(
      { subjectCode: 'BXXX401', internal: 0, external: 0, total: 0 },
      rs,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.percentage).toBe(0);
  });

  it('accepts the maxima exactly', () => {
    const result = validateCourseMarks(
      { subjectCode: 'BXXX401', internal: 50, external: 50, total: 100 },
      rs,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.percentage).toBe(100);
  });
});

describe('validateCourseMarks — subject codes', () => {
  it.each([
    ['BXX401', '3 letters + 3 digits'],
    ['BXXL404', '4 letters + 3 digits'],
    ['BXX405B', '3 letters + elective suffix'],
    ['BXXX456D', '4 letters + elective suffix'],
    ['BXXX459', '4 letters, no suffix'],
  ])('accepts %s (%s)', (subjectCode) => {
    expect(isOk(validateCourseMarks({ ...ROW, subjectCode }, rs))).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['BX401', 'too few letters'],
    ['BXXXX401', 'too many letters'],
    ['BXX40', 'too few digits'],
    ['BXX4011', 'too many digits'],
    ['BXX401BB', 'two suffix letters'],
    ['BXX-401', 'punctuation'],
    ['BXX401; DROP TABLE subjects', 'trailing text'],
  ])('rejects %s (%s)', (subjectCode) => {
    expectRejected({ ...ROW, subjectCode });
  });
});

describe('validateCourseMarks — malformed marks', () => {
  it.each([
    ['internal', { ...ROW, internal: Number.NaN }],
    ['external', { ...ROW, external: Number.NaN }],
    ['total', { ...ROW, total: Number.NaN }],
  ])('rejects a non-numeric %s', (_label, marks) => {
    expectRejected(marks);
  });

  it.each([
    ['internal', { ...ROW, internal: Number.POSITIVE_INFINITY }],
    ['external', { ...ROW, external: Number.POSITIVE_INFINITY }],
  ])('rejects an infinite %s', (_label, marks) => {
    expectRejected(marks);
  });

  it.each([
    ['internal', { ...ROW, internal: -1, total: 32 }],
    ['external', { ...ROW, external: -1, total: 41 }],
    ['total', { ...ROW, total: -75 }],
  ])('rejects a negative %s', (_label, marks) => {
    expectRejected(marks);
  });

  it('rejects internal above the CIE maximum', () => {
    const result = expectRejected({ ...ROW, internal: 51, total: 84 });
    if (!isOk(result)) expect(result.detail).toContain('Internal');
  });

  it('rejects external above the SEE contribution maximum', () => {
    const result = expectRejected({ ...ROW, external: 51, total: 93 });
    if (!isOk(result)) expect(result.detail).toContain('External');
  });

  it('rejects a total that does not equal internal + external', () => {
    const result = expectRejected({ ...ROW, total: 76 });
    if (!isOk(result)) expect(result.detail).toContain('does not equal');
  });

  it('rejects a raw SEE mark pasted into the external column', () => {
    // The exact mistake §16.5's wording invited: entering 66 (the raw SEE)
    // instead of 33 (the printed contribution). It exceeds the 50 maximum.
    expectRejected({ ...ROW, external: 66, total: 108 });
  });
});

describe('validateCourseMarks — courses with no SEE (22OB 6.1(3))', () => {
  // Synthetic: an internal above the ordinary CIE maximum of 50 with a zero
  // external, the shape 22OB 6.1(3) produces.
  const PE: CourseMarks = { subjectCode: 'BXXX459', internal: 72, external: 0, total: 72 };

  it('accepts CIE over the full course maximum', () => {
    const result = validateCourseMarks(PE, rs, { hasSee: false });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.hasSee).toBe(false);
      expect(result.value.percentage).toBe(72);
    }
  });

  it('rejects the same row when modelled as an ordinary course', () => {
    expectRejected(PE, { hasSee: true });
  });

  it('rejects a non-zero external, since there is no SEE to score', () => {
    expectRejected(
      { subjectCode: 'BXXX459', internal: 90, external: 5, total: 95 },
      {
        hasSee: false,
      },
    );
  });

  it('rejects internal above the course maximum', () => {
    expectRejected(
      { subjectCode: 'BXXX459', internal: 101, external: 0, total: 101 },
      {
        hasSee: false,
      },
    );
  });
});

describe('validateCourseMarks — rule-set guard', () => {
  it('refuses to validate against an unverified rule set', () => {
    const result = validateCourseMarks(ROW, { ...rs, verifiedAt: null }, {});
    expect(isOk(result)).toBe(false);
  });

  it('refuses to validate against an inactive rule set', () => {
    const result = validateCourseMarks(ROW, { ...rs, active: false }, {});
    expect(isOk(result)).toBe(false);
  });
});
