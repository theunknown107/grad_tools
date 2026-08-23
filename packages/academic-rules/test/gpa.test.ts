/**
 * SGPA and CGPA.
 *
 * Authority: docs/16 §16.8 (22OB 6.6), docs/33 §33.6 test matrix
 */

import { describe, expect, it } from 'vitest';
import { calculateCGPA, calculateSGPA, vtu2022RuleSet } from '../src/index.js';
import type { CourseGrade, RuleSet } from '../src/index.js';

const rs = vtu2022RuleSet;

/** A realistic VTU 3rd-semester load: 22 credits across six courses. */
const typicalSemester: CourseGrade[] = [
  { subjectCode: 'BCS301', credits: 4, gradeLetter: 'A' }, // 8 -> 32
  { subjectCode: 'BCS302', credits: 4, gradeLetter: 'A+' }, // 9 -> 36
  { subjectCode: 'BCS303', credits: 4, gradeLetter: 'B+' }, // 7 -> 28
  { subjectCode: 'BCS304', credits: 3, gradeLetter: 'O' }, // 10 -> 30
  { subjectCode: 'BCSL305', credits: 1, gradeLetter: 'A' }, // 8 -> 8
  { subjectCode: 'BSCK307', credits: 1, gradeLetter: 'B' }, // 6 -> 6
];
// Sum(Ci x Gi) = 140, Sum(Ci) = 17 -> 8.235294... -> 8.24

describe('calculateSGPA — normal semester', () => {
  it('computes the credit-weighted average and rounds to 2 dp', () => {
    const result = calculateSGPA(typicalSemester, rs);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(8.24);
  });

  it('exposes the formula, clause and per-course working', () => {
    const result = calculateSGPA(typicalSemester, rs);
    expect(result.explanation.formula).toBe('SGPA = Sum(Ci x Gi) / Sum(Ci)');
    expect(result.explanation.clause).toBe('22OB 6.6(2a)');
    expect(result.explanation.inputs.weightedPoints).toBe(140);
    expect(result.explanation.inputs.totalCredits).toBe(17);
    expect(result.explanation.ruleSetId).toBe(rs.id);
    expect(result.explanation.ruleSetVersion).toBe(1);
  });

  it('returns the grade point directly for a single course', () => {
    const result = calculateSGPA([{ credits: 4, gradeLetter: 'A' }], rs);
    expect(result.ok && result.value).toBe(8);
  });

  it('is unchanged when every credit is doubled', () => {
    const doubled = typicalSemester.map((c) => ({ ...c, credits: c.credits * 2 }));
    const a = calculateSGPA(typicalSemester, rs);
    const b = calculateSGPA(doubled, rs);
    expect(a.ok && a.value).toBe(b.ok && b.value);
  });
});

describe('calculateSGPA — F and DX participation (22OB 6.2)', () => {
  it('counts F credits in the denominator with 0 points', () => {
    // 4x8 = 32 over 4+4 = 8 credits -> 4.00
    const result = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 4, gradeLetter: 'F' },
      ],
      rs,
    );
    expect(result.ok && result.value).toBe(4);
  });

  it('excludes DX credits entirely — "Credits are not included in CGPA"', () => {
    // The DX course must not appear in the numerator OR the denominator.
    const withoutDx = calculateSGPA([{ credits: 4, gradeLetter: 'A' }], rs);
    const withDx = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 4, gradeLetter: 'DX' },
      ],
      rs,
    );
    expect(withDx.ok && withDx.value).toBe(8);
    expect(withDx.ok && withDx.value).toBe(withoutDx.ok && withoutDx.value);
  });

  it('does not confuse F with DX — they must differ', () => {
    const withF = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 4, gradeLetter: 'F' },
      ],
      rs,
    );
    const withDx = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 4, gradeLetter: 'DX' },
      ],
      rs,
    );
    expect(withF.ok && withF.value).not.toBe(withDx.ok && withDx.value);
  });

  it('excludes non-credit PP and NP grades from the ratio', () => {
    const result = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 0, gradeLetter: 'PP' },
        { credits: 0, gradeLetter: 'NP' },
      ],
      rs,
    );
    expect(result.ok && result.value).toBe(8);
  });

  it('reports insufficient input when every course is GPA-excluded', () => {
    const result = calculateSGPA([{ credits: 4, gradeLetter: 'DX' }], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
    expect(!result.ok && result.detail).toContain('excluded from GPA');
  });
});

describe('calculateSGPA — AB stays rule-set driven (OQ-018)', () => {
  it('refuses to compute rather than assuming a grade point for AB', () => {
    const result = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 4, gradeLetter: 'AB' },
      ],
      rs,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('unverified_rule');
  });

  it('would compute normally if a rule set verified the behaviour', () => {
    // Demonstrates that the refusal comes from the DATA, not from a hard-coded
    // special case: give AB a verified behaviour and the engine proceeds.
    const withVerifiedAb: RuleSet = {
      ...rs,
      id: 'test-ab-verified',
      specialGrades: rs.specialGrades.map((g) =>
        g.letter === 'AB' ? { ...g, points: 0, pointsVerified: true, includedInGpa: true } : g,
      ),
    };
    const result = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 4, gradeLetter: 'AB' },
      ],
      withVerifiedAb,
    );
    expect(result.ok && result.value).toBe(4);
  });

  it('also refuses for IC and W, whose points are likewise unstated', () => {
    for (const letter of ['IC', 'W']) {
      const result = calculateSGPA([{ credits: 4, gradeLetter: letter }], rs);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe('unverified_rule');
    }
  });
});

describe('calculateSGPA — invalid and empty input', () => {
  it('reports insufficient input for an empty course list, not 0.00 or NaN', () => {
    const result = calculateSGPA([], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
    expect(!result.ok && result.detail).toBe('Add at least one course.');
  });

  it('reports insufficient input when total credits are zero', () => {
    const result = calculateSGPA([{ credits: 0, gradeLetter: 'A' }], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
  });

  it.each([
    [Number.NaN, 'not a number'],
    [Number.POSITIVE_INFINITY, 'infinite'],
    [-1, 'negative'],
  ])('rejects credits of %s (%s)', (credits) => {
    const result = calculateSGPA([{ credits, gradeLetter: 'A' }], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('rejects an unknown grade letter', () => {
    const result = calculateSGPA([{ credits: 4, gradeLetter: 'Z' }], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
    expect(!result.ok && result.detail).toContain('Z');
  });

  it('rejects an empty grade letter', () => {
    const result = calculateSGPA([{ credits: 4, gradeLetter: '  ' }], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('names the offending course in the failure detail', () => {
    const result = calculateSGPA(
      [
        { subjectCode: 'BCS301', credits: 4, gradeLetter: 'A' },
        { subjectCode: 'BCS302', credits: -1, gradeLetter: 'A' },
      ],
      rs,
    );
    expect(!result.ok && result.detail).toContain('BCS302');
  });

  it('falls back to a positional label when no subject code is given', () => {
    const result = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: -1, gradeLetter: 'A' },
      ],
      rs,
    );
    expect(!result.ok && result.detail).toContain('Course 2');
  });

  it('rejects an unverified rule set', () => {
    const result = calculateSGPA(typicalSemester, { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });

  it('rejects a rule set naming an unimplemented SGPA formula', () => {
    const result = calculateSGPA(typicalSemester, { ...rs, sgpaFormulaId: 'mystery' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.detail).toContain('mystery');
  });

  it('accepts decimal credits, which the VTU scheme uses for some labs', () => {
    const result = calculateSGPA(
      [
        { credits: 1.5, gradeLetter: 'A' }, // 12
        { credits: 0.5, gradeLetter: 'O' }, // 5
      ],
      rs,
    );
    // 17 / 2 = 8.5
    expect(result.ok && result.value).toBe(8.5);
  });
});

describe('calculateCGPA', () => {
  it('computes the credit-weighted average across semesters (22OB 6.6(2b))', () => {
    // (20x8.5 + 22x9.0) / 42 = (170 + 198) / 42 = 368/42 = 8.7619... -> 8.76
    const result = calculateCGPA(
      [
        { semester: 1, credits: 20, sgpa: 8.5 },
        { semester: 2, credits: 22, sgpa: 9.0 },
      ],
      rs,
    );
    expect(result.ok && result.value).toBe(8.76);
  });

  it('equals the single semester SGPA when only one semester exists', () => {
    const result = calculateCGPA([{ credits: 20, sgpa: 8.43 }], rs);
    expect(result.ok && result.value).toBe(8.43);
  });

  it('weights semesters by credits, not equally', () => {
    // Equal weighting would give 9.00; credit weighting gives 9.75.
    const result = calculateCGPA(
      [
        { credits: 4, sgpa: 6 },
        { credits: 36, sgpa: 10 },
      ],
      rs,
    );
    expect(result.ok && result.value).toBe(9.6);
  });

  it('reports insufficient input for no semesters', () => {
    const result = calculateCGPA([], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
  });

  it('reports insufficient input when all credits are zero', () => {
    const result = calculateCGPA([{ credits: 0, sgpa: 8 }], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
  });

  it.each([
    [-1, 8],
    [20, -0.1],
    [20, 10.1],
    [Number.NaN, 8],
    [20, Number.NaN],
  ])('rejects invalid semester data (credits %s, sgpa %s)', (credits, sgpa) => {
    const result = calculateCGPA([{ credits, sgpa }], rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('labels semesters by their number when provided', () => {
    const result = calculateCGPA([{ semester: 5, credits: -1, sgpa: 8 }], rs);
    expect(!result.ok && result.detail).toContain('Semester 5');
  });

  it('labels semesters positionally when no number is provided', () => {
    const result = calculateCGPA([{ credits: -1, sgpa: 8 }], rs);
    expect(!result.ok && result.detail).toContain('Semester 1');
  });

  it('rejects a rule set naming an unimplemented CGPA formula', () => {
    const result = calculateCGPA([{ credits: 20, sgpa: 8 }], { ...rs, cgpaFormulaId: 'mystery' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unverified rule set', () => {
    const result = calculateCGPA([{ credits: 20, sgpa: 8 }], { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });
});
