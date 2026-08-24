/**
 * Grade-card mark row validation.
 *
 * Authority: docs/16 §16.5 (22OB 4.1(4)), §16.6 (22OB 6.3), §16.3 (22OB 6.1(3))
 *
 * The valid cases are taken from a real VTU grade card; the malformed cases are
 * mutations of those real rows, so every rejection test starts from something
 * VTU actually printed rather than from an invented shape.
 */

import { describe, expect, it } from 'vitest';
import { validateCourseMarks, type CourseMarks } from '../src/marks.js';
import { vtu2022RuleSet } from '../src/rulesets/vtu-2022.js';
import { isOk } from '../src/result.js';

const rs = vtu2022RuleSet;

/** A synthetic row. */
const REAL: CourseMarks = { subjectCode: 'BXXX401', internal: 42, external: 33, total: 75 };

function expectRejected(marks: CourseMarks, options?: { hasSee?: boolean }) {
  const result = validateCourseMarks(marks, rs, options);
  expect(isOk(result)).toBe(false);
  if (!isOk(result)) {
    expect(result.reason).toBe('invalid_input');
    expect(result.detail.length).toBeGreaterThan(0);
  }
  return result;
}

describe('validateCourseMarks — accepts real rows', () => {
  it('accepts a real CIE + SEE row and reports its percentage', () => {
    const result = validateCourseMarks(REAL, rs);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.percentage).toBe(80);
      expect(result.value.hasSee).toBe(true);
      expect(result.value.total).toBe(80);
    }
  });

  it('normalises a lowercase, padded subject code', () => {
    const result = validateCourseMarks({ ...REAL, subjectCode: '  bcs401 ' }, rs);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.subjectCode).toBe('BCS401');
  });

  it('returns an explanation citing the clause', () => {
    const result = validateCourseMarks(REAL, rs);
    if (isOk(result)) {
      expect(result.explanation.clause).toContain('4.1(4)');
      expect(result.explanation.steps.length).toBeGreaterThan(0);
    }
  });

  it('accepts a zero row (a real possibility for a failed course)', () => {
    const result = validateCourseMarks(
      { subjectCode: 'BCS401', internal: 0, external: 0, total: 0 },
      rs,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.percentage).toBe(0);
  });

  it('accepts the maxima exactly', () => {
    const result = validateCourseMarks(
      { subjectCode: 'BCS401', internal: 50, external: 50, total: 100 },
      rs,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.percentage).toBe(100);
  });
});

describe('validateCourseMarks — subject codes', () => {
  it.each([
    ['BCS401', '3 letters + 3 digits'],
    ['BCSL404', '4 letters + 3 digits'],
    ['BCS405B', 'elective suffix'],
    ['BCB456D', 'elective suffix'],
    ['BXXX459', '4 letters, no suffix'],
  ])('accepts %s (%s)', (subjectCode) => {
    expect(isOk(validateCourseMarks({ ...REAL, subjectCode }, rs))).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['BC401', 'too few letters'],
    ['BCSLX401', 'too many letters'],
    ['BCS40', 'too few digits'],
    ['BCS4011', 'too many digits'],
    ['BCS401BB', 'two suffix letters'],
    ['BCS-401', 'punctuation'],
    ['BCS401; DROP TABLE subjects', 'trailing text'],
  ])('rejects %s (%s)', (subjectCode) => {
    expectRejected({ ...REAL, subjectCode });
  });
});

describe('validateCourseMarks — malformed marks', () => {
  it.each([
    ['internal', { ...REAL, internal: Number.NaN }],
    ['external', { ...REAL, external: Number.NaN }],
    ['total', { ...REAL, total: Number.NaN }],
  ])('rejects a non-numeric %s', (_label, marks) => {
    expectRejected(marks);
  });

  it.each([
    ['internal', { ...REAL, internal: Number.POSITIVE_INFINITY }],
    ['external', { ...REAL, external: Number.POSITIVE_INFINITY }],
  ])('rejects an infinite %s', (_label, marks) => {
    expectRejected(marks);
  });

  it.each([
    ['internal', { ...REAL, internal: -1, total: 35 }],
    ['external', { ...REAL, external: -1, total: 43 }],
    ['total', { ...REAL, total: -80 }],
  ])('rejects a negative %s', (_label, marks) => {
    expectRejected(marks);
  });

  it('rejects internal above the CIE maximum', () => {
    const result = expectRejected({ ...REAL, internal: 51, total: 87 });
    if (!isOk(result)) expect(result.detail).toContain('Internal');
  });

  it('rejects external above the SEE contribution maximum', () => {
    const result = expectRejected({ ...REAL, external: 51, total: 95 });
    if (!isOk(result)) expect(result.detail).toContain('External');
  });

  it('rejects a total that does not equal internal + external', () => {
    const result = expectRejected({ ...REAL, total: 81 });
    if (!isOk(result)) expect(result.detail).toContain('does not equal');
  });

  it('rejects a raw SEE mark pasted into the external column', () => {
    // The exact mistake §16.5's wording invited: entering 72 (the raw SEE)
    // instead of 36 (the printed contribution). It exceeds the 50 maximum.
    expectRejected({ ...REAL, external: 72, total: 116 });
  });
});

describe('validateCourseMarks — courses with no SEE (22OB 6.1(3))', () => {
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
    const result = validateCourseMarks(REAL, { ...rs, verifiedAt: null }, {});
    expect(isOk(result)).toBe(false);
  });

  it('refuses to validate against an inactive rule set', () => {
    const result = validateCourseMarks(REAL, { ...rs, active: false }, {});
    expect(isOk(result)).toBe(false);
  });
});
