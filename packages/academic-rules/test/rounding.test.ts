/**
 * Rounding.
 *
 * Authority: docs/16 §16.8 (22OB 6.6(2b)) — "rounded off to 2 decimal points",
 * applied once at the end, with intermediate values keeping full precision.
 */

import { describe, expect, it } from 'vitest';
import { applyRounding, calculateSGPA, roundHalfUp, vtu2022RuleSet } from '../src/index.js';

const rs = vtu2022RuleSet;

describe('roundHalfUp', () => {
  it.each([
    [8.234, 2, 8.23],
    [8.235, 2, 8.24],
    [8.236, 2, 8.24],
    [8.4285714, 2, 8.43],
    [0, 2, 0],
    [10, 2, 10],
    [8.2, 2, 8.2],
    [82.0, 2, 82],
  ])('rounds %s at %s dp to %s', (value, dp, expected) => {
    expect(roundHalfUp(value, dp)).toBe(expected);
  });

  it('rounds exact halves up rather than to even', () => {
    // Math.round is half-up for positives, but a naive implementation using
    // toFixed or banker's rounding would give 8.22 here.
    expect(roundHalfUp(8.225, 2)).toBe(8.23);
    expect(roundHalfUp(8.245, 2)).toBe(8.25);
  });

  it('survives binary floating-point representation error', () => {
    // 1.005 is stored as 1.00499999999999989..., so `Math.round(1.005*100)/100`
    // gives 1.00. The boundary tolerance corrects it.
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
  });

  it('handles negative values symmetrically and never produces -0', () => {
    expect(roundHalfUp(-8.235, 2)).toBe(-8.24);
    expect(roundHalfUp(-0.001, 2)).toBe(0);
    expect(Object.is(roundHalfUp(-0.001, 2), -0)).toBe(false);
  });

  it.each([0, 1, 3, 4])('supports %s decimal places', (dp) => {
    expect(roundHalfUp(1.23456, dp)).toBeCloseTo(Number((1.23456).toFixed(dp)), 10);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws on non-finite input %s',
    (value) => {
      expect(() => roundHalfUp(value, 2)).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, 16, Number.NaN])('throws on invalid decimalPlaces %s', (dp) => {
    expect(() => roundHalfUp(1.5, dp)).toThrow(RangeError);
  });
});

describe('applyRounding', () => {
  it("uses the rule set's policy", () => {
    expect(applyRounding(8.4285714, rs.rounding)).toBe(8.43);
  });

  it('honours a policy with a different precision', () => {
    expect(applyRounding(8.4285714, { ...rs.rounding, decimalPlaces: 3 })).toBe(8.429);
  });
});

describe('rounding is applied once, at the end (22OB 6.6(2b))', () => {
  it('does not round intermediate per-course contributions', () => {
    // Three courses whose individual contributions have long decimal parts.
    // Rounding each contribution first would drift away from the true value.
    const courses = [
      { credits: 1 / 3, gradeLetter: 'A' },
      { credits: 1 / 3, gradeLetter: 'B' },
      { credits: 1 / 3, gradeLetter: 'C' },
    ];
    const result = calculateSGPA(courses, rs);
    // (8 + 6 + 5) / 3 = 6.333... -> 6.33
    expect(result.ok && result.value).toBe(6.33);
  });

  it('keeps full precision in the explanation while rounding the value', () => {
    const result = calculateSGPA(
      [
        { credits: 4, gradeLetter: 'A' },
        { credits: 3, gradeLetter: 'B+' },
      ],
      rs,
    );
    // (32 + 21) / 7 = 7.5714285714...
    expect(result.ok && result.value).toBe(7.57);
    expect(result.explanation.inputs.weightedPoints).toBe(53);
    expect(result.explanation.inputs.totalCredits).toBe(7);
  });
});
