/**
 * Required marks and target CGPA.
 *
 * Authority: docs/16 §16.9 worked table (derived from 22OB 6.3)
 */

import { describe, expect, it } from 'vitest';
import { calculateRequiredMarks, calculateRequiredSGPA, vtu2022RuleSet } from '../src/index.js';
import type { MarksTarget, RuleSet } from '../src/index.js';

const rs = vtu2022RuleSet;
const PASS: MarksTarget = { kind: 'pass' };

describe('calculateRequiredMarks — the docs/16 §16.9 worked table', () => {
  it.each([
    // CIE, target,                        required SEE, binding constraint
    [20, PASS, 40, 'overall_target'],
    [30, PASS, 35, 'see_minimum'],
    [45, PASS, 35, 'see_minimum'],
    [40, { kind: 'grade', letter: 'A' } as MarksTarget, 60, 'overall_target'],
    [50, { kind: 'grade', letter: 'O' } as MarksTarget, 80, 'overall_target'],
  ])('CIE %s -> requires %s in the SEE (%s)', (cie, target, expected, binding) => {
    const result = calculateRequiredMarks(cie, target, rs);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.requiredSee).toBe(expected);
    expect(result.ok && result.value.bindingConstraint).toBe(binding);
  });

  it('reports UNREACHABLE for CIE 35 targeting an O grade (would need 110)', () => {
    const result = calculateRequiredMarks(35, { kind: 'grade', letter: 'O' }, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('unreachable');
    expect(!result.ok && result.detail).toContain('110');
  });

  it('reports INELIGIBLE for CIE 18, below the 40% CIE minimum', () => {
    const result = calculateRequiredMarks(18, PASS, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('ineligible');
    expect(!result.ok && result.detail).toContain('not eligible');
    // and points at the re-registration route (22OB 6.3(8))
    expect(!result.ok && result.detail).toContain('re-registered');
  });
});

describe('calculateRequiredMarks — the binding constraint is the actionable part', () => {
  it('names the SEE minimum when a strong CIE already satisfies the overall target', () => {
    // This is the row most third-party tools get wrong.
    const result = calculateRequiredMarks(45, PASS, rs);
    expect(result.ok && result.value.bindingConstraint).toBe('see_minimum');
    expect(result.ok && result.value.requiredSee).toBe(35);
  });

  it('names the overall target when it exceeds the SEE minimum', () => {
    const result = calculateRequiredMarks(20, PASS, rs);
    expect(result.ok && result.value.bindingConstraint).toBe('overall_target');
  });

  it('never returns a requirement below the SEE head minimum', () => {
    for (let cie = 20; cie <= 50; cie += 1) {
      const result = calculateRequiredMarks(cie, PASS, rs);
      expect(result.ok && result.value.requiredSee).toBeGreaterThanOrEqual(35);
    }
  });
});

describe('calculateRequiredMarks — soundness and minimality', () => {
  /** Total course marks: CIE + SEE scaled to its weight (50 under VTU 2022). */
  function courseTotal(cie: number, see: number): number {
    const seeScale = (rs.courseMax - rs.cieMax) / rs.seeMax;
    return cie + see * seeScale;
  }

  it('the returned mark always achieves the target', () => {
    for (let cie = 20; cie <= 50; cie += 1) {
      for (const targetPct of [40, 50, 55, 60, 70, 80, 90]) {
        const target: MarksTarget = { kind: 'percentage', percentage: targetPct };
        const result = calculateRequiredMarks(cie, target, rs);
        if (!result.ok) continue;
        const achieved = courseTotal(cie, result.value.requiredSee);
        expect(achieved).toBeGreaterThanOrEqual(targetPct - 1e-9);
        expect(result.value.requiredSee).toBeGreaterThanOrEqual(35);
      }
    }
  });

  it('one mark less fails to achieve the target, unless the SEE minimum binds', () => {
    for (let cie = 20; cie <= 50; cie += 1) {
      for (const targetPct of [40, 55, 70, 90]) {
        const target: MarksTarget = { kind: 'percentage', percentage: targetPct };
        const result = calculateRequiredMarks(cie, target, rs);
        if (!result.ok || result.value.bindingConstraint !== 'overall_target') continue;
        const achieved = courseTotal(cie, result.value.requiredSee - 1);
        expect(achieved).toBeLessThan(targetPct);
      }
    }
  });
});

describe('calculateRequiredMarks — targets and validation', () => {
  it('accepts an explicit percentage target', () => {
    const result = calculateRequiredMarks(30, { kind: 'percentage', percentage: 60 }, rs);
    // needs (60-30)/0.5 = 60
    expect(result.ok && result.value.requiredSee).toBe(60);
  });

  it('rejects an unknown target grade', () => {
    const result = calculateRequiredMarks(30, { kind: 'grade', letter: 'Z' }, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it.each([Number.NaN, -1, 101])('rejects target percentage %s', (percentage) => {
    const result = calculateRequiredMarks(30, { kind: 'percentage', percentage }, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it.each([
    [Number.NaN, 'not finite'],
    [-1, 'negative'],
    [51, 'above the CIE maximum'],
  ])('rejects CIE %s (%s)', (cie) => {
    const result = calculateRequiredMarks(cie, PASS, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('rejects a rule set with an inconsistent CIE/SEE structure', () => {
    const broken: RuleSet = { ...rs, courseMax: 50 };
    const result = calculateRequiredMarks(30, PASS, broken);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.detail).toContain('inconsistent');
  });

  it('rejects a rule set with a zero SEE maximum', () => {
    const result = calculateRequiredMarks(30, PASS, { ...rs, seeMax: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects an unverified rule set', () => {
    const result = calculateRequiredMarks(30, PASS, { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });

  it('derives the SEE scale from the rule set, not a hard-coded 0.5', () => {
    // A hypothetical scheme where the SEE is written for 50 and carries 50.
    const evenSplit: RuleSet = { ...rs, id: 'test-even', seeMax: 50 };
    // scale = (100-50)/50 = 1.0, so needing 20 more marks means 20 SEE marks.
    const result = calculateRequiredMarks(20, PASS, evenSplit);
    expect(result.ok && result.value.requiredSee).toBe(20);
    expect(result.ok && result.value.seeMax).toBe(50);
  });
});

describe('calculateRequiredSGPA', () => {
  it('computes the SGPA needed over the remaining credits', () => {
    // target 8.5 over 160 total, 8.0 over 80 done
    // (8.5x160 - 8.0x80) / 80 = (1360 - 640)/80 = 9.00
    const result = calculateRequiredSGPA(8.0, 80, 80, 8.5, rs);
    expect(result.ok && result.value).toBe(9);
  });

  it('still reports a positive requirement when the target is reachable but not yet met', () => {
    // Current 9.0 over 80 credits, target 8.0 over 160 total:
    // (8.0x160 - 9.0x80) / 80 = (1280 - 720)/80 = 7.00
    // A high current CGPA does not mean nothing is required.
    const result = calculateRequiredSGPA(9.0, 80, 80, 8.0, rs);
    expect(result.ok && result.value).toBe(7);
  });

  it('returns 0 when the target is already secured whatever happens next', () => {
    // (7.0x160 - 9.5x150) / 10 = (1120 - 1425)/10 = -30.5 -> nothing more needed.
    const result = calculateRequiredSGPA(9.5, 150, 10, 7.0, rs);
    expect(result.ok && result.value).toBe(0);
  });

  it('reports unreachable with the maximum attainable CGPA', () => {
    const result = calculateRequiredSGPA(5.0, 120, 40, 9.5, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('unreachable');
    // max = (5x120 + 10x40)/160 = (600+400)/160 = 6.25
    expect(!result.ok && result.detail).toContain('6.25');
  });

  it('reports insufficient input when no credits remain', () => {
    const result = calculateRequiredSGPA(8.0, 160, 0, 8.5, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
  });

  it.each([
    [Number.NaN, 80, 80, 8.5],
    [8, Number.NaN, 80, 8.5],
    [8, 80, Number.NaN, 8.5],
    [8, 80, 80, Number.NaN],
    [-1, 80, 80, 8.5],
    [11, 80, 80, 8.5],
    [8, -1, 80, 8.5],
    [8, 80, -1, 8.5],
    [8, 80, 80, -1],
    [8, 80, 80, 11],
  ])('rejects invalid input (%s, %s, %s, %s)', (current, done, remaining, target) => {
    const result = calculateRequiredSGPA(current, done, remaining, target, rs);
    expect(result.ok).toBe(false);
    expect(['invalid_input', 'insufficient_input']).toContain(!result.ok && result.reason);
  });

  it('rejects an unverified rule set', () => {
    const result = calculateRequiredSGPA(8, 80, 80, 8.5, { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });
});
