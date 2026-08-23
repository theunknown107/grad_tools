/**
 * Property-based tests.
 *
 * Authority: docs/16 §16.11, docs/22 §22.3
 *
 * These verify the calculators against the DEFINITION of correctness across a
 * generated input space, rather than against hand-computed examples. They are
 * the strongest tests in the suite: a hand-written case proves one point, a
 * property proves a shape.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  calculateCGPA,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
  calculatePercentage,
  calculateSGPA,
  roundHalfUp,
  vtu2022RuleSet,
} from '../src/index.js';
import type { CourseGrade } from '../src/index.js';

const rs = vtu2022RuleSet;
const RUNS = 500;

/** Letters that always participate in the GPA ratio. */
const regularLetters = rs.gradeBands.map((b) => b.letter);

const courseArb = fc.record({
  credits: fc.integer({ min: 1, max: 6 }),
  gradeLetter: fc.constantFrom(...regularLetters),
});

const courseListArb = fc.array(courseArb, { minLength: 1, maxLength: 12 });

function pointsFor(letter: string): number {
  return rs.gradeBands.find((b) => b.letter === letter)?.points ?? 0;
}

describe('SGPA properties', () => {
  it('always lies between 0 and the maximum grade point', () => {
    fc.assert(
      fc.property(courseListArb, (courses) => {
        const result = calculateSGPA(courses, rs);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBeGreaterThanOrEqual(0);
          expect(result.value).toBeLessThanOrEqual(10);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('never decreases when a grade is raised', () => {
    fc.assert(
      fc.property(courseListArb, fc.nat(), (courses, rawIndex) => {
        const index = rawIndex % courses.length;
        const target = courses[index];
        if (!target) return;

        const current = pointsFor(target.gradeLetter);
        const better = rs.gradeBands.find((b) => b.points > current);
        if (!better) return;

        const improved: CourseGrade[] = courses.map((c, i) =>
          i === index ? { ...c, gradeLetter: better.letter } : c,
        );

        const before = calculateSGPA(courses, rs);
        const after = calculateSGPA(improved, rs);
        if (before.ok && after.ok) {
          expect(after.value).toBeGreaterThanOrEqual(before.value);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('is unchanged when every credit is scaled by the same factor', () => {
    fc.assert(
      fc.property(courseListArb, fc.integer({ min: 2, max: 5 }), (courses, factor) => {
        const scaled = courses.map((c) => ({ ...c, credits: c.credits * factor }));
        const a = calculateSGPA(courses, rs);
        const b = calculateSGPA(scaled, rs);
        if (a.ok && b.ok) {
          expect(b.value).toBe(a.value);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('is never raised by adding an F course', () => {
    fc.assert(
      fc.property(courseListArb, fc.integer({ min: 1, max: 6 }), (courses, credits) => {
        const before = calculateSGPA(courses, rs);
        const after = calculateSGPA([...courses, { credits, gradeLetter: 'F' }], rs);
        if (before.ok && after.ok) {
          expect(after.value).toBeLessThanOrEqual(before.value);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('is never changed by adding a DX course, whose credits are excluded', () => {
    fc.assert(
      fc.property(courseListArb, fc.integer({ min: 1, max: 6 }), (courses, credits) => {
        const before = calculateSGPA(courses, rs);
        const after = calculateSGPA([...courses, { credits, gradeLetter: 'DX' }], rs);
        if (before.ok && after.ok) {
          expect(after.value).toBe(before.value);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('never returns NaN or Infinity for any generated input', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            credits: fc.double({ min: 0, max: 20, noNaN: true }),
            gradeLetter: fc.constantFrom(...regularLetters, 'DX', 'AB', 'ZZ', ''),
          }),
          { maxLength: 10 },
        ),
        (courses) => {
          const result = calculateSGPA(courses, rs);
          if (result.ok) {
            expect(Number.isFinite(result.value)).toBe(true);
          } else {
            expect(typeof result.detail).toBe('string');
            expect(result.detail.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('CGPA properties', () => {
  it('equals the single semester SGPA when there is only one semester', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (credits, sgpa) => {
          const rounded = Math.round(sgpa * 100) / 100;
          const result = calculateCGPA([{ credits, sgpa: rounded }], rs);
          if (result.ok) {
            expect(result.value).toBe(rounded);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('always lies between the lowest and highest semester SGPA', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            credits: fc.integer({ min: 1, max: 30 }),
            sgpa: fc.double({ min: 0, max: 10, noNaN: true }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (semesters) => {
          const result = calculateCGPA(semesters, rs);
          if (!result.ok) return;
          const values = semesters.map((s) => s.sgpa);
          expect(result.value).toBeGreaterThanOrEqual(Math.min(...values) - 0.005);
          expect(result.value).toBeLessThanOrEqual(Math.max(...values) + 0.005);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('Percentage properties', () => {
  it('is monotonic in CGPA', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10, noNaN: true }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (a, b) => {
          const lower = Math.min(a, b);
          const higher = Math.max(a, b);
          const lowerResult = calculatePercentage(lower, rs);
          const higherResult = calculatePercentage(higher, rs);
          if (lowerResult.ok && higherResult.ok) {
            expect(higherResult.value).toBeGreaterThanOrEqual(lowerResult.value);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('never applies a subtractive offset — percentage is always 10x CGPA', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10, noNaN: true }), (cgpa) => {
        const result = calculatePercentage(cgpa, rs);
        if (!result.ok) return;

        // The engine rounds to the rule set's 2 decimal places (22OB 6.6(2b)),
        // so the expectation must be rounded the same way rather than compared
        // against the raw product.
        expect(result.value).toBe(roundHalfUp(cgpa * 10, rs.rounding.decimalPlaces));

        // The obsolete conversion would be 7.5 points lower everywhere.
        const obsolete = roundHalfUp((cgpa - 0.75) * 10, rs.rounding.decimalPlaces);
        expect(result.value - obsolete).toBeCloseTo(7.5, 6);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Attendance properties', () => {
  const countsArb = fc
    .tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 1, max: 200 }))
    .map(([a, c]) => [Math.min(a, c), c] as const);

  it('can-miss and must-attend are never negative', () => {
    fc.assert(
      fc.property(countsArb, ([attended, conducted]) => {
        const canMiss = calculateClassesCanMiss(attended, conducted, rs);
        const mustAttend = calculateClassesMustAttend(attended, conducted, rs);
        if (canMiss.ok) expect(canMiss.value).toBeGreaterThanOrEqual(0);
        if (mustAttend.ok) expect(mustAttend.value).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: RUNS },
    );
  });

  it('at most one of can-miss and must-attend is non-zero', () => {
    fc.assert(
      fc.property(countsArb, ([attended, conducted]) => {
        const canMiss = calculateClassesCanMiss(attended, conducted, rs);
        const mustAttend = calculateClassesMustAttend(attended, conducted, rs);
        if (canMiss.ok && mustAttend.ok) {
          expect(canMiss.value === 0 || mustAttend.value === 0).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('attending must-attend classes reaches the threshold (inverse property)', () => {
    fc.assert(
      fc.property(countsArb, ([attended, conducted]) => {
        const needed = calculateClassesMustAttend(attended, conducted, rs);
        if (!needed.ok) return;
        const finalPct = ((attended + needed.value) / (conducted + needed.value)) * 100;
        expect(finalPct).toBeGreaterThanOrEqual(rs.attendanceRequiredPct - 1e-9);
      }),
      { numRuns: RUNS },
    );
  });

  it('missing can-miss classes keeps attendance at or above the threshold', () => {
    fc.assert(
      fc.property(countsArb, ([attended, conducted]) => {
        const canMiss = calculateClassesCanMiss(attended, conducted, rs);
        if (!canMiss.ok || canMiss.value === 0) return;
        const finalPct = (attended / (conducted + canMiss.value)) * 100;
        expect(finalPct).toBeGreaterThanOrEqual(rs.attendanceRequiredPct - 1e-9);
      }),
      { numRuns: RUNS },
    );
  });

  it('missing one more than can-miss drops below the threshold (minimality)', () => {
    fc.assert(
      fc.property(countsArb, ([attended, conducted]) => {
        const canMiss = calculateClassesCanMiss(attended, conducted, rs);
        if (!canMiss.ok) return;
        const finalPct = (attended / (conducted + canMiss.value + 1)) * 100;
        expect(finalPct).toBeLessThan(rs.attendanceRequiredPct);
      }),
      { numRuns: RUNS },
    );
  });
});
