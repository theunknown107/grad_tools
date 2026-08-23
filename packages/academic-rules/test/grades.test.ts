/**
 * Grade bands and grade resolution.
 *
 * Authority: docs/16 §16.3 (22OB 6.1), §16.4 (22OB 6.2)
 *
 * The band boundaries matter disproportionately: B (55-59) and C (50-54) span
 * five marks while every other band spans ten. A calculator that assumes
 * uniform ten-mark bands is wrong at exactly these edges, which is a common
 * defect in third-party tools (docs/16 §16.3).
 */

import { describe, expect, it } from 'vitest';
import {
  findGradeBand,
  findSpecialGrade,
  gradeFromMarks,
  resolveGrade,
  vtu2022RuleSet,
} from '../src/index.js';

const rs = vtu2022RuleSet;

describe('gradeFromMarks — the 22OB 6.1 table', () => {
  it.each([
    [100, 'O', 10],
    [95, 'O', 10],
    [90, 'O', 10],
    [89, 'A+', 9],
    [85, 'A+', 9],
    [80, 'A+', 9],
    [79, 'A', 8],
    [70, 'A', 8],
    [69, 'B+', 7],
    [60, 'B+', 7],
    [59, 'B', 6],
    [55, 'B', 6],
    [54, 'C', 5],
    [50, 'C', 5],
    [49, 'P', 4],
    [40, 'P', 4],
    [39, 'F', 0],
    [0, 'F', 0],
  ])('%s marks is grade %s (%s points)', (marks, letter, points) => {
    const result = gradeFromMarks(marks, 100, rs);
    expect(result.ok && result.value.letter).toBe(letter);
    expect(result.ok && result.value.points).toBe(points);
  });

  describe('the irregular five-mark bands', () => {
    it.each([
      [54, 'C'],
      [55, 'B'],
      [59, 'B'],
      [60, 'B+'],
    ])('%s is %s', (marks, letter) => {
      const result = gradeFromMarks(marks, 100, rs);
      expect(result.ok && result.value.letter).toBe(letter);
    });
  });

  it('truncates a fractional percentage rather than rounding up (A-16.1)', () => {
    // 89.5 must stay A+, not become O. Rounding up would award a grade the
    // student did not earn.
    const result = gradeFromMarks(89.5, 100, rs);
    expect(result.ok && result.value.letter).toBe('A+');
  });

  it('records both the exact and the truncated percentage in the explanation', () => {
    const result = gradeFromMarks(89.5, 100, rs);
    const exact = result.explanation.steps.find((s) => s.label === 'Percentage');
    const lookup = result.explanation.steps.find((s) =>
      s.label.startsWith('Percentage used for band lookup'),
    );
    expect(exact?.value).toBeCloseTo(89.5, 10);
    expect(lookup?.value).toBe(89);
  });

  it('scales against a non-100 maximum', () => {
    const result = gradeFromMarks(45, 50, rs);
    expect(result.ok && result.value.letter).toBe('O');
  });

  it.each([
    [Number.NaN, 100, 'NaN marks'],
    [50, Number.NaN, 'NaN maximum'],
    [-1, 100, 'negative marks'],
    [101, 100, 'marks above maximum'],
    [50, 0, 'zero maximum'],
    [50, -10, 'negative maximum'],
  ])('rejects (%s / %s) — %s', (marks, max) => {
    const result = gradeFromMarks(marks, max, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('fails cleanly when no band covers the percentage', () => {
    const gapped = { ...rs, gradeBands: rs.gradeBands.filter((b) => b.letter !== 'F') };
    const result = gradeFromMarks(10, 100, gapped);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.detail).toContain('No grade band');
  });

  it('rejects an unverified rule set', () => {
    const result = gradeFromMarks(85, 100, { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });
});

describe('resolveGrade', () => {
  it.each(['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F'])('resolves regular grade %s', (letter) => {
    const result = resolveGrade(letter, rs);
    expect(result.ok && result.value.includedInGpa).toBe(true);
    expect(result.ok && result.value.kind).toBe('band');
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    const result = resolveGrade('  a+  ', rs);
    expect(result.ok && result.value.letter).toBe('A+');
    expect(result.ok && result.value.points).toBe(9);
  });

  it.each([
    ['DX', false],
    ['AU', false],
    ['PP', false],
    ['NP', false],
  ])('resolves special grade %s as excluded from GPA', (letter, included) => {
    const result = resolveGrade(letter, rs);
    expect(result.ok && result.value.includedInGpa).toBe(included);
    expect(result.ok && result.value.kind).toBe('special');
  });

  it.each(['AB', 'IC', 'W'])(
    'refuses to resolve %s while its behaviour is unverified',
    (letter) => {
      const result = resolveGrade(letter, rs);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe('unverified_rule');
      expect(!result.ok && result.detail).toContain('not verified');
    },
  );

  it('cites the clause for an unverified grade so a reviewer can check it', () => {
    const result = resolveGrade('AB', rs);
    expect(result.explanation.clause).toBe('22OB 6.2(3)');
  });

  it.each([
    ['Z', 'unknown letter'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
  ])('rejects %s (%s)', (letter) => {
    const result = resolveGrade(letter, rs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('invalid_input');
  });

  it('rejects an unverified rule set', () => {
    const result = resolveGrade('A', { ...rs, verifiedAt: null });
    expect(result.ok).toBe(false);
  });
});

describe('lookup helpers', () => {
  it('finds a band by letter, case-insensitively', () => {
    expect(findGradeBand('a+', rs)?.points).toBe(9);
    expect(findGradeBand('nope', rs)).toBeUndefined();
  });

  it('finds a special grade by letter, case-insensitively', () => {
    expect(findSpecialGrade('dx', rs)?.includedInGpa).toBe(false);
    expect(findSpecialGrade('nope', rs)).toBeUndefined();
  });
});

describe('VTU 2022 rule set integrity', () => {
  it('has no overlapping grade bands', () => {
    const sorted = [...rs.gradeBands].sort((a, b) => a.minPct - b.minPct);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      expect(current && previous && current.minPct > previous.maxPct).toBe(true);
    }
  });

  it('covers 0 to 100 with no gaps', () => {
    for (let pct = 0; pct <= 100; pct += 1) {
      const band = rs.gradeBands.find((b) => pct >= b.minPct && pct <= b.maxPct);
      expect(band, `no band covers ${String(pct)}%`).toBeDefined();
    }
  });

  it('marks AB, IC and W as unverified and everything else as verified', () => {
    const unverified = rs.specialGrades.filter((g) => !g.pointsVerified).map((g) => g.letter);
    expect(unverified.sort()).toEqual(['AB', 'IC', 'W']);
  });

  it('excludes every special grade from the GPA ratio', () => {
    for (const grade of rs.specialGrades) {
      expect(grade.includedInGpa).toBe(false);
    }
  });

  it('keeps F as a regular band, so its credits count', () => {
    expect(findGradeBand('F', rs)).toBeDefined();
    expect(findSpecialGrade('F', rs)).toBeUndefined();
  });
});
