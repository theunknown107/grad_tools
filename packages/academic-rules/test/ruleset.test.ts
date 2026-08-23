/**
 * Rule-set resolution and versioning.
 *
 * Authority: docs/16 §16.13, docs/09 §9.4, docs/33 §33.6 (RuleSet matrix)
 *
 * The architectural point: two schemes never share calculation logic. Every
 * VTU-specific number lives in a rule set, so this suite is what proves the
 * calculators contain no hidden constants.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateAttendance,
  calculatePercentage,
  calculateRequiredMarks,
  calculateSGPA,
  getActiveRuleSetForScheme,
  getRuleSet,
  isOk,
  listRuleSets,
  vtu2022RuleSet,
  VTU_2022_RULE_SET_ID,
} from '../src/index.js';
import type { RuleSet } from '../src/index.js';

const rs = vtu2022RuleSet;

describe('registry resolution', () => {
  it('resolves the VTU 2022 rule set by id', () => {
    expect(getRuleSet(VTU_2022_RULE_SET_ID)).toBe(rs);
  });

  it('returns undefined for an unknown id rather than a default', () => {
    expect(getRuleSet('vtu-2018-v1')).toBeUndefined();
    expect(getRuleSet('')).toBeUndefined();
  });

  it('resolves the active rule set for a scheme', () => {
    expect(getActiveRuleSetForScheme('vtu-2022')).toBe(rs);
  });

  it('returns undefined for a scheme with no active rule set', () => {
    expect(getActiveRuleSetForScheme('vtu-2021')).toBeUndefined();
  });

  it('lists only rule sets this build actually ships', () => {
    const all = listRuleSets();
    expect(all).toHaveLength(1);
    expect(all[0]?.schemeId).toBe('vtu-2022');
  });

  it('every listed rule set is verified and carries source provenance', () => {
    for (const ruleSet of listRuleSets()) {
      expect(ruleSet.verifiedAt).not.toBeNull();
      expect(ruleSet.sourceUrl).toMatch(/^https:\/\//);
      expect(ruleSet.sourceClause.length).toBeGreaterThan(0);
    }
  });
});

describe('unverified and inactive rule sets are rejected everywhere', () => {
  const unverified: RuleSet = { ...rs, verifiedAt: null };
  const inactive: RuleSet = { ...rs, active: false };

  const calls: readonly (readonly [string, (r: RuleSet) => { ok: boolean }])[] = [
    ['calculateSGPA', (r) => calculateSGPA([{ credits: 4, gradeLetter: 'A' }], r)],
    ['calculatePercentage', (r) => calculatePercentage(8.2, r)],
    ['calculateAttendance', (r) => calculateAttendance(17, 20, r)],
    ['calculateRequiredMarks', (r) => calculateRequiredMarks(30, { kind: 'pass' }, r)],
  ];

  it.each(calls)('%s rejects an unverified rule set', (_name, call) => {
    expect(call(unverified).ok).toBe(false);
  });

  it.each(calls)('%s rejects an inactive rule set', (_name, call) => {
    expect(call(inactive).ok).toBe(false);
  });
});

describe('version separation — no hidden VTU constants in the calculators', () => {
  it('honours a different attendance threshold from the rule set', () => {
    const relaxed: RuleSet = { ...rs, id: 'test-relaxed', attendanceRequiredPct: 60 };
    // 70% is below VTU's 85% but above this rule set's 60%.
    const strict = calculateAttendance(14, 20, rs);
    const lenient = calculateAttendance(14, 20, relaxed);
    expect(strict.ok && strict.value.status).toBe('dx_risk');
    expect(lenient.ok && lenient.value.status).toBe('safe');
  });

  it('honours different grade bands from the rule set', () => {
    const generous: RuleSet = {
      ...rs,
      id: 'test-generous',
      gradeBands: [
        { letter: 'A', descriptor: 'Top', points: 10, minPct: 50, maxPct: 100 },
        { letter: 'F', descriptor: 'Fail', points: 0, minPct: 0, maxPct: 49 },
      ],
    };
    const result = calculateSGPA([{ credits: 4, gradeLetter: 'A' }], generous);
    expect(result.ok && result.value).toBe(10);
  });

  it('honours a different CIE minimum from the rule set', () => {
    const lenient: RuleSet = { ...rs, id: 'test-lenient-cie', cieMinPct: 20 };
    // CIE 18 is ineligible under VTU 2022 (40% of 50 = 20) but eligible at 20%.
    expect(calculateRequiredMarks(18, { kind: 'pass' }, rs).ok).toBe(false);
    expect(calculateRequiredMarks(18, { kind: 'pass' }, lenient).ok).toBe(true);
  });

  it('records the rule set id and version on every explanation', () => {
    const versioned: RuleSet = { ...rs, id: 'test-v7', version: 7 };
    const result = calculateSGPA([{ credits: 4, gradeLetter: 'A' }], versioned);
    expect(result.explanation.ruleSetId).toBe('test-v7');
    expect(result.explanation.ruleSetVersion).toBe(7);
  });

  it('records the rule set even on a failure, so a wrong result is traceable', () => {
    const result = calculateSGPA([], rs);
    expect(result.ok).toBe(false);
    expect(result.explanation.ruleSetId).toBe(rs.id);
    expect(result.explanation.sourceUrl).toContain('vtu.ac.in');
  });
});

describe('VTU 2022 values match the cited clauses', () => {
  it('assessment structure (22OB 4.1)', () => {
    expect(rs.cieMax).toBe(50);
    expect(rs.seeMax).toBe(100);
    expect(rs.courseMax).toBe(100);
  });

  it('passing standards (22OB 6.3)', () => {
    expect(rs.cieMinPct).toBe(40);
    expect(rs.seeMinPct).toBe(35);
    expect(rs.overallMinPct).toBe(40);
  });

  it('attendance (22OB 3.7, 6.2(1))', () => {
    expect(rs.attendanceRequiredPct).toBe(85);
    expect(rs.attendanceCondonablePct).toBe(10);
    expect(rs.attendanceDxFloorPct).toBe(75);
  });

  it('formula identifiers (22OB 6.6, 6.7)', () => {
    expect(rs.sgpaFormulaId).toBe('credit_weighted_gp');
    expect(rs.cgpaFormulaId).toBe('credit_weighted_sgpa');
    expect(rs.percentageFormulaId).toBe('cgpa_x_10');
  });

  it('rounding (22OB 6.6(2b))', () => {
    expect(rs.rounding).toEqual({ decimalPlaces: 2, mode: 'half_up', stage: 'final_only' });
  });

  it('class bands (22OB 6.8)', () => {
    expect(rs.classBands.map((b) => b.shortLabel)).toEqual(['FCD', 'FC', 'SC', 'P']);
    expect(rs.classBands.find((b) => b.shortLabel === 'FCD')?.minPct).toBe(70);
  });

  it('scope is the non-autonomous 2022 scheme', () => {
    expect(rs.schemeId).toBe('vtu-2022');
    expect(rs.collegeId).toBeNull();
    expect(rs.sourceClause).toBe('22OB');
  });
});

describe('isOk type guard', () => {
  it('narrows a successful result', () => {
    const result = calculateSGPA([{ credits: 4, gradeLetter: 'A' }], rs);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(8);
    }
  });

  it('rejects a failed result', () => {
    expect(isOk(calculateSGPA([], rs))).toBe(false);
  });
});
