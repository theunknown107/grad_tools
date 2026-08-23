/**
 * Percentage conversion — the strictest regression suite in the repository.
 *
 * Authority: docs/16 §16.8 (22OB 6.7), docs/22 §Percentage-formula regression
 *            tests (P-1 … P-8), docs/32 DEC-009
 *
 * Every third-party VTU calculator publishes (CGPA - 0.75) x 10, which does not
 * appear in the 2022 regulation. For CGPA 8.20 that is 74.5% instead of the
 * regulation's own worked example of 82.0% — a 7.5 point error, enough to change
 * a class classification. These tests exist to make that regression unshippable.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateClass,
  calculatePercentage,
  listPercentageFormulaIds,
  listRuleSets,
  vtu2022RuleSet,
} from '../src/index.js';
import type { RuleSet } from '../src/index.js';

const rs = vtu2022RuleSet;

function expectOk<T>(result: { ok: boolean }): asserts result is { ok: true } & { value: T } {
  expect(result.ok).toBe(true);
}

describe('P-1: the regulation worked example', () => {
  it('converts CGPA 8.20 to 82.0% (22OB 6.7)', () => {
    const result = calculatePercentage(8.2, rs);
    expectOk(result);
    expect(result.ok && result.value).toBe(82);
  });

  it('cites the clause and the source document', () => {
    const result = calculatePercentage(8.2, rs);
    expect(result.explanation.clause).toBe('22OB 6.7');
    expect(result.explanation.formula).toBe('M = CGPA x 10');
    expect(result.explanation.sourceUrl).toContain('vtu.ac.in');
  });
});

describe('P-2: the obsolete formula is not applied', () => {
  it('does NOT return 74.5 for CGPA 8.20', () => {
    const result = calculatePercentage(8.2, rs);
    expect(result.ok && result.value).not.toBe(74.5);
  });

  it.each([
    [8.2, 74.5],
    [9.0, 82.5],
    [7.5, 67.5],
    [6.0, 52.5],
  ])('CGPA %s does not produce the 0.75-offset result %s', (cgpa, obsolete) => {
    const result = calculatePercentage(cgpa, rs);
    expect(result.ok && result.value).not.toBe(obsolete);
    expect(result.ok && result.value).toBe(cgpa * 10);
  });
});

describe('P-3: seed integrity', () => {
  it('the VTU 2022 rule set declares percentageFormulaId = cgpa_x_10', () => {
    expect(rs.percentageFormulaId).toBe('cgpa_x_10');
  });

  it('the rule set is verified and active, as required to compute at all', () => {
    expect(rs.verifiedAt).not.toBeNull();
    expect(rs.active).toBe(true);
    expect(rs.sourceClause).toBe('22OB');
  });
});

describe('P-4: no active rule set uses an offset formula', () => {
  it('every active rule set uses a registered, non-offset conversion', () => {
    for (const ruleSet of listRuleSets().filter((candidate) => candidate.active)) {
      expect(ruleSet.percentageFormulaId).not.toMatch(/0_75|minus/i);
      expect(listPercentageFormulaIds()).toContain(ruleSet.percentageFormulaId);
    }
  });

  it('the obsolete formula is not even registered', () => {
    expect(listPercentageFormulaIds()).not.toContain('cgpa_minus_0_75_x_10');
    expect(listPercentageFormulaIds()).toEqual(['cgpa_x_10']);
  });
});

describe('P-5: a rule set is always required', () => {
  it('rejects an unverified rule set rather than computing', () => {
    const unverified: RuleSet = { ...rs, verifiedAt: null };
    const result = calculatePercentage(8.2, unverified);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
    expect(!result.ok && result.detail).toContain('not been verified');
  });

  it('rejects an inactive rule set', () => {
    const inactive: RuleSet = { ...rs, active: false };
    const result = calculatePercentage(8.2, inactive);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.detail).toContain('not active');
  });
});

describe('P-6: boundary sweep', () => {
  it.each([
    [0, 0],
    [4, 40],
    [6, 60],
    [7, 70],
    [8.2, 82],
    [9.99, 99.9],
    [10, 100],
  ])('CGPA %s -> %s%%', (cgpa, expected) => {
    const result = calculatePercentage(cgpa, rs);
    expect(result.ok && result.value).toBe(expected);
  });
});

describe('P-7: percentage to class equivalence chain (22OB 6.8)', () => {
  it.each([
    [8.2, 82, 'FCD'],
    [7.0, 70, 'FCD'],
    [6.5, 65, 'FC'],
    [6.0, 60, 'FC'],
    [5.5, 55, 'SC'],
    [4.5, 45, 'P'],
    [4.0, 40, 'P'],
  ])('CGPA %s -> %s%% -> %s', (cgpa, expectedPct, expectedClass) => {
    const pct = calculatePercentage(cgpa, rs);
    expect(pct.ok && pct.value).toBe(expectedPct);

    const cls = calculateClass(expectedPct, rs);
    expect(cls.ok && cls.value.shortLabel).toBe(expectedClass);
  });

  it('resolves the regulation overlap at exactly 50% to the higher class (A-16.3)', () => {
    // 22OB 6.8 states Second Class as 50 <= M < 60 AND Pass Class as 40 <= M <= 50.
    const result = calculateClass(50, rs);
    expect(result.ok && result.value.shortLabel).toBe('SC');
  });

  it('reports ineligibility below the lowest class band rather than inventing one', () => {
    const result = calculateClass(39.9, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('ineligible');
  });
});

describe('P-8: the conversion is data-driven, not hard-coded', () => {
  it('fails cleanly when a rule set names a formula this engine does not implement', () => {
    // If the conversion were hard-coded as `cgpa * 10`, this would still return
    // 82 and the test would fail. That is exactly what it is guarding against.
    const unknownFormula: RuleSet = { ...rs, percentageFormulaId: 'some_future_formula' };
    const result = calculatePercentage(8.2, unknownFormula);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
    expect(!result.ok && result.detail).toContain('some_future_formula');
  });
});

describe('invalid input', () => {
  it.each([
    [Number.NaN, 'not finite'],
    [Number.POSITIVE_INFINITY, 'not finite'],
    [-0.1, 'negative'],
    [10.1, 'above maximum'],
  ])('rejects CGPA %s (%s)', (cgpa) => {
    const result = calculatePercentage(cgpa, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it.each([Number.NaN, -1, 101])('calculateClass rejects percentage %s', (pct) => {
    const result = calculateClass(pct, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('calculateClass rejects an unverified rule set', () => {
    const result = calculateClass(82, { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });
});
