/**
 * Attendance eligibility is the regulation's, not a preference (docs/16 §16.7):
 * 85% per course meets the requirement; 75–84.99% is below it, where a
 * shortage MAY be condoned at the Vice Chancellor's discretion; below 75% the
 * DX threshold is crossed (22OB 3.7, 6.2(1)).
 */
import {
  calculateAttendance,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
  vtu2022RuleSet,
} from '@gradtools/academic-rules';
import { afterEach, describe, expect, it } from 'vitest';
import { schemeRulesFor } from '../src/hooks/useSchemeRules.js';
import {
  DEFAULT_PERSONAL_TARGET,
  PERSONAL_TARGET_OPTIONS,
  attendanceRules,
  personalTarget,
  setPersonalTarget,
  targetRules,
} from '../src/lib/attendance-criteria.js';

afterEach(() => window.localStorage.clear());

/** Status at a percentage, using 10,000 conducted classes for two-decimal steps. */
const statusAt = (percent: number) => {
  const result = calculateAttendance(Math.round(percent * 100), 10_000, attendanceRules());
  if (!result.ok) throw new Error(result.detail);
  return result.value.status;
};

describe('the official classification', () => {
  it.each([
    [74.99, 'dx_risk'],
    [75, 'below_requirement'],
    [75.01, 'below_requirement'],
    [84.99, 'below_requirement'],
    [85, 'safe'],
    [85.01, 'safe'],
    [100, 'safe'],
  ] as const)('%s%% is %s', (percent, expected) => {
    expect(statusAt(percent)).toBe(expected);
  });

  it('is the unmodified 2022 rule set: 85 required, 10 condonable, DX below 75', () => {
    const rules = attendanceRules();
    expect(rules).toBe(vtu2022RuleSet);
    expect(rules.attendanceRequiredPct).toBe(85);
    expect(rules.attendanceCondonablePct).toBe(10);
    expect(rules.attendanceDxFloorPct).toBe(75);
  });

  it('fails safely on impossible counts', () => {
    expect(calculateAttendance(41, 40, attendanceRules()).ok).toBe(false);
    expect(calculateAttendance(-1, 40, attendanceRules()).ok).toBe(false);
  });
});

describe('a personal target cannot rewrite eligibility', () => {
  it('defaults to the requirement and offers nothing below it', () => {
    expect(DEFAULT_PERSONAL_TARGET).toBe(85);
    expect(Math.min(...PERSONAL_TARGET_OPTIONS)).toBe(85);
    expect(personalTarget()).toBe(85);
  });

  it('ignores a stored value below the requirement (the old 60–80 criteria)', () => {
    for (const old of ['60', '70', '75', '80', 'x']) {
      window.localStorage.setItem('gradtools:v1:attendance-criteria', old);
      expect(personalTarget()).toBe(85);
    }
  });

  it('leaves every official figure unchanged whatever the target', () => {
    setPersonalTarget(95);
    expect(personalTarget()).toBe(95);
    expect(attendanceRules().attendanceRequiredPct).toBe(85);
    expect(attendanceRules().attendanceDxFloorPct).toBe(75);
    expect(statusAt(80)).toBe('below_requirement');
    expect(statusAt(74.99)).toBe('dx_risk');
    /* The target's own arithmetic moves only the line it is drawn at. */
    expect(targetRules(95).attendanceRequiredPct).toBe(95);
    expect(targetRules(95).attendanceDxFloorPct).toBe(75);
    expect(vtu2022RuleSet.attendanceRequiredPct).toBe(85);
  });
});

describe('class counts use the 85% requirement', () => {
  it('margin and recovery are measured against 85%, not 75%', () => {
    /* 36 of 40 is 90%: 2 more misses keep it at 85% (36/42 = 85.7%), a third does not. */
    const canMiss = calculateClassesCanMiss(36, 40, attendanceRules());
    expect(canMiss.ok && canMiss.value).toBe(2);
    /* 30 of 40 is 75%: 27 consecutive classes reach 85% (57/67 = 85.07%). */
    const mustAttend = calculateClassesMustAttend(30, 40, attendanceRules());
    expect(mustAttend.ok && mustAttend.value).toBe(27);
  });
});

describe('each scheme keeps its own rule set', () => {
  it('2022 and 2025 resolve independently', () => {
    const v2022 = schemeRulesFor('vtu-2022');
    const v2025 = schemeRulesFor('vtu-2025');
    expect(v2022.ruleSet?.schemeId).toBe('vtu-2022');
    expect(v2025.ruleSet?.schemeId).toBe('vtu-2025');
    expect(v2025.ruleSet).not.toBe(v2022.ruleSet);
    /* The screens' built-in rules are 2022's; a 2025 profile is told so rather than judged by them. */
    expect(v2022.builtIn).toBe(true);
    expect(v2025.builtIn).toBe(false);
    expect(v2025.ruleSet?.attendanceRequiredPct).toBe(85);
    expect(v2025.ruleSet?.attendanceDxFloorPct).toBe(75);
  });
});
