/**
 * Attendance, bunk planning and recovery.
 *
 * Authority: docs/16 §16.7 (22OB 3.7), §16.9 worked table
 */

import { describe, expect, it } from 'vitest';
import {
  calculateAttendance,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
  vtu2022RuleSet,
} from '../src/index.js';
import type { RuleSet } from '../src/index.js';

const rs = vtu2022RuleSet;
/** A rule set with the 75% condonation floor as the working threshold. */
const rs75: RuleSet = { ...rs, id: 'test-75', attendanceRequiredPct: 75 };

describe('calculateAttendance', () => {
  it.each([
    [45, 50, 90],
    [42, 50, 84],
    [40, 50, 80],
    [30, 50, 60],
    [50, 50, 100],
    [0, 50, 0],
  ])('attended %s of %s conducted is %s%%', (attended, conducted, expected) => {
    const result = calculateAttendance(attended, conducted, rs);
    expect(result.ok && result.value.percentage).toBeCloseTo(expected, 10);
  });

  it('reports insufficient input when no classes have been conducted', () => {
    const result = calculateAttendance(0, 0, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
  });

  it('treats all classes attended as safe', () => {
    const result = calculateAttendance(20, 20, rs);
    expect(result.ok && result.value.status).toBe('safe');
    expect(result.ok && result.value.percentage).toBe(100);
  });

  it('treats no classes attended as DX risk', () => {
    const result = calculateAttendance(0, 20, rs);
    expect(result.ok && result.value.status).toBe('dx_risk');
  });

  describe('status boundaries (22OB 3.7(1), 6.2(1))', () => {
    it.each([
      // exactly at the 85% requirement -> safe
      [17, 20, 'safe'],
      // one class below 85% -> below_requirement
      [16, 20, 'below_requirement'],
      // exactly at the 75% DX floor -> below_requirement, NOT dx_risk
      [15, 20, 'below_requirement'],
      // below 75% -> dx_risk
      [14, 20, 'dx_risk'],
    ])('attended %s of %s is %s', (attended, conducted, expected) => {
      const result = calculateAttendance(attended, conducted, rs);
      expect(result.ok && result.value.status).toBe(expected);
    });

    it('reports the thresholds it used, so the UI need not restate them', () => {
      const result = calculateAttendance(17, 20, rs);
      expect(result.ok && result.value.requiredPct).toBe(85);
      expect(result.ok && result.value.dxFloorPct).toBe(75);
    });
  });

  it.each([
    [21, 20, 'attended exceeds conducted'],
    [-1, 20, 'negative attended'],
    [5, -1, 'negative conducted'],
    [1.5, 20, 'fractional attended'],
    [Number.NaN, 20, 'NaN'],
    [Number.POSITIVE_INFINITY, 20, 'Infinity'],
  ])('rejects (%s, %s) — %s', (attended, conducted) => {
    const result = calculateAttendance(attended, conducted, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('rejects an unverified rule set', () => {
    const result = calculateAttendance(17, 20, { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });
});

describe('calculateClassesCanMiss — the docs/16 §16.9 worked table', () => {
  it.each([
    [45, 50, rs, 2],
    [42, 50, rs, 0],
    [40, 50, rs, 0],
    [30, 50, rs, 0],
    [38, 50, rs75, 0],
  ])('attended %s of %s -> can miss %s', (attended, conducted, ruleSet, expected) => {
    const result = calculateClassesCanMiss(attended, conducted, ruleSet);
    expect(result.ok && result.value).toBe(expected);
  });

  it('is exact at the threshold: 17/20 at 85% allows zero more', () => {
    // 17 x 100 / 85 = 20 exactly. A float slip here would report 1 or -1.
    const result = calculateClassesCanMiss(17, 20, rs);
    expect(result.ok && result.value).toBe(0);
  });

  it('never returns a negative number', () => {
    const result = calculateClassesCanMiss(1, 100, rs);
    expect(result.ok && result.value).toBe(0);
  });

  it('projects against classes still to be conducted', () => {
    // 45/50 now, 10 more to come: attend all -> 55/60.
    // 55 x 100 / 85 = 64.7 -> 64.7 - 60 = 4.7 -> 4 may be missed.
    const result = calculateClassesCanMiss(45, 50, rs, 10);
    expect(result.ok && result.value).toBe(4);
  });

  it('records the projection in the explanation inputs', () => {
    const result = calculateClassesCanMiss(45, 50, rs, 10);
    expect(result.explanation.inputs.remainingClasses).toBe(10);
  });

  it('omits remainingClasses from the explanation when not projecting', () => {
    const result = calculateClassesCanMiss(45, 50, rs);
    expect(result.explanation.inputs.remainingClasses).toBeUndefined();
  });

  it.each([-1, 1.5, Number.NaN])('rejects invalid remainingClasses %s', (remaining) => {
    const result = calculateClassesCanMiss(45, 50, rs, remaining);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('reports insufficient input when nothing is conducted or scheduled', () => {
    const result = calculateClassesCanMiss(0, 0, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
  });

  it('rejects a zero threshold rather than dividing by zero', () => {
    const result = calculateClassesCanMiss(10, 20, { ...rs, attendanceRequiredPct: 0 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('rejects invalid counts', () => {
    const result = calculateClassesCanMiss(21, 20, rs);
    expect(result.ok).toBe(false);
  });
});

describe('calculateClassesMustAttend — the docs/16 §16.9 worked table', () => {
  it.each([
    [45, 50, rs, 0],
    [42, 50, rs, 4],
    [40, 50, rs, 17],
    [30, 50, rs, 84],
    [38, 50, rs75, 0],
  ])('attended %s of %s -> must attend %s', (attended, conducted, ruleSet, expected) => {
    const result = calculateClassesMustAttend(attended, conducted, ruleSet);
    expect(result.ok && result.value).toBe(expected);
  });

  it('returns 0 when already at the threshold exactly', () => {
    const result = calculateClassesMustAttend(17, 20, rs);
    expect(result.ok && result.value).toBe(0);
  });

  it('satisfies the inverse property: attending the answer reaches the threshold', () => {
    for (const [attended, conducted] of [
      [42, 50],
      [40, 50],
      [30, 50],
      [1, 10],
      [7, 33],
    ] as const) {
      const needed = calculateClassesMustAttend(attended, conducted, rs);
      if (!needed.ok) continue;
      const finalPct = ((attended + needed.value) / (conducted + needed.value)) * 100;
      expect(finalPct).toBeGreaterThanOrEqual(rs.attendanceRequiredPct - 1e-9);

      // and one fewer would NOT reach it (minimality)
      if (needed.value > 0) {
        const shortPct = ((attended + needed.value - 1) / (conducted + needed.value - 1)) * 100;
        expect(shortPct).toBeLessThan(rs.attendanceRequiredPct);
      }
    }
  });

  it('reports unreachable when more classes are needed than remain', () => {
    // 30/50 needs 84 more classes; only 20 remain.
    const result = calculateClassesMustAttend(30, 50, rs, 20);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('unreachable');
    expect(!result.ok && result.detail).toContain('84');
    expect(!result.ok && result.detail).toContain('20');
  });

  it('reports the maximum attainable attendance when unreachable', () => {
    const result = calculateClassesMustAttend(30, 50, rs, 20);
    const step = result.explanation.steps.find((s) => s.label === 'Maximum attainable attendance');
    // (30+20)/(50+20) = 71.43%
    expect(step?.value).toBeCloseTo(71.4285, 3);
  });

  it('succeeds when the remaining classes are sufficient', () => {
    const result = calculateClassesMustAttend(42, 50, rs, 10);
    expect(result.ok && result.value).toBe(4);
  });

  it('reports unreachable for a 100% requirement once a class is missed', () => {
    const result = calculateClassesMustAttend(19, 20, { ...rs, attendanceRequiredPct: 100 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('unreachable');
  });

  it('returns 0 for a 100% requirement when nothing has been missed', () => {
    const result = calculateClassesMustAttend(20, 20, { ...rs, attendanceRequiredPct: 100 });
    expect(result.ok && result.value).toBe(0);
  });

  it('reports insufficient input when no classes have been conducted', () => {
    const result = calculateClassesMustAttend(0, 0, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('insufficient_input');
  });

  it.each([-1, 2.5, Number.NaN])('rejects invalid remainingClasses %s', (remaining) => {
    const result = calculateClassesMustAttend(40, 50, rs, remaining);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('rejects invalid counts', () => {
    const result = calculateClassesMustAttend(51, 50, rs);
    expect(result.ok).toBe(false);
  });

  it('rejects an unverified rule set', () => {
    const result = calculateClassesMustAttend(40, 50, { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });
});
