/**
 * Passing a course, and carrying one.
 *
 * Authority: 22OB 6.3 · docs/16 §16.13
 *
 * The mark shapes below are taken from the STRUCTURE of real VTU provisional
 * result cards, with invented numbers. No real student's marks, name or seat
 * number appears here or anywhere in this repository.
 */

import { describe, expect, it } from 'vitest';
import { evaluateCourseResult } from '../src/course-result.js';
import { isOk } from '../src/result.js';
import { vtu2022RuleSet as rules } from '../src/rulesets/vtu-2022.js';

const evaluate = (internal: number, external: number, options: { hasSee?: boolean } = {}) => {
  const outcome = evaluateCourseResult(
    { subjectCode: 'BXXX101', internal, external, total: internal + external },
    rules,
    options,
  );
  if (!isOk(outcome)) throw new Error(`expected success, got: ${outcome.detail}`);
  return outcome.value;
};

describe('the passing minima this rule set states', () => {
  it('derives the SEE minimum as 35% of the SEE scale', () => {
    // courseMax 100, cieMax 50 -> SEE scale 50; 35% of 50 = 17.5.
    expect(evaluate(40, 20).seeMinimum).toBeCloseTo(17.5);
  });

  it('derives the CIE and total minima at 40%', () => {
    const result = evaluate(40, 20);
    expect(result.cieMinimum).toBeCloseTo(20);
    expect(result.overallMinimum).toBeCloseTo(40);
  });
});

describe('the SEE head', () => {
  /*
   * The product requirement is "a backlog if the external is below 18". That is
   * not a separate rule: 35% of the 50-mark printed SEE scale is 17.5, so 18 is
   * the smallest whole mark that clears it. These two tests pin the boundary
   * from both sides so the engine and the product statement cannot drift.
   */
  it('passes at 18, the smallest whole mark clearing 17.5', () => {
    const result = evaluate(40, 18);
    expect(result.see).toBe('passed');
    expect(result.backlog).toBe(false);
  });

  it('fails at 17', () => {
    const result = evaluate(40, 17);
    expect(result.see).toBe('failed');
    expect(result.backlog).toBe(true);
  });

  it('carries the course even when the total is comfortable', () => {
    // 49 + 17 = 66, well past the 40 total minimum, but the SEE head failed.
    const result = evaluate(49, 17);
    expect(result.overall).toBe('passed');
    expect(result.see).toBe('failed');
    expect(result.passed).toBe(false);
    expect(result.backlog).toBe(true);
  });
});

describe('a course with no semester-end examination', () => {
  /*
   * THE CASE THAT MAKES A BARE THRESHOLD DANGEROUS.
   *
   * A real card shows a Physical Education row with an an internal above the ordinary CIE maximum, an
   * external of 0, and a printed PASS. Read as "external
   * below 18 means a backlog", that row is a failure. It is not: the course is
   * assessed on CIE alone over the whole course maximum (22OB 6.1(3)).
   */
  it('passes on CIE alone with an external of zero', () => {
    const result = evaluate(72, 0, { hasSee: false });
    expect(result.passed).toBe(true);
    expect(result.backlog).toBe(false);
  });

  it('reports the SEE head as not applicable, never as passed', () => {
    const result = evaluate(72, 0, { hasSee: false });
    // Distinct from 'passed': there was no head to satisfy.
    expect(result.see).toBe('not_applicable');
    expect(result.seeMinimum).toBeNull();
  });

  it('scales the CIE minimum to the whole course maximum', () => {
    // 40% of 100, not 40% of 50, because CIE carries the entire course.
    expect(evaluate(72, 0, { hasSee: false }).cieMinimum).toBeCloseTo(40);
  });

  it('still fails a CIE-only course whose CIE is too low', () => {
    const result = evaluate(30, 0, { hasSee: false });
    expect(result.cie).toBe('failed');
    expect(result.backlog).toBe(true);
  });

  /*
   * `hasSee` is reference data, never inferred. An external of 0 is equally
   * consistent with "no SEE" and with "sat the SEE and scored nothing", and the
   * two have opposite outcomes.
   */
  it('treats an external of zero as a failure when the course does have a SEE', () => {
    const withSee = evaluate(40, 0);
    expect(withSee.see).toBe('failed');
    expect(withSee.backlog).toBe(true);

    const withoutSee = evaluate(40, 0, { hasSee: false });
    expect(withoutSee.see).toBe('not_applicable');
    expect(withoutSee.backlog).toBe(false);
  });
});

describe('the CIE head', () => {
  it('fails a course whose internal is below the eligibility minimum', () => {
    const result = evaluate(19, 45);
    expect(result.cie).toBe('failed');
    expect(result.backlog).toBe(true);
  });

  it('passes exactly at the minimum', () => {
    expect(evaluate(20, 20).cie).toBe('passed');
  });
});

describe('the overall head', () => {
  it('fails a course below the total minimum even with both heads clear', () => {
    // 20 + 18 = 38, under the 40 total minimum, though CIE and SEE each clear.
    const result = evaluate(20, 18);
    expect(result.cie).toBe('passed');
    expect(result.see).toBe('passed');
    expect(result.overall).toBe('failed');
    expect(result.backlog).toBe(true);
  });
});

describe('input the regulation cannot speak to', () => {
  it('refuses a row whose columns do not add up', () => {
    const outcome = evaluateCourseResult(
      { subjectCode: 'BXXX101', internal: 40, external: 20, total: 99 },
      rules,
    );
    expect(isOk(outcome)).toBe(false);
  });

  it('refuses an external beyond the SEE scale', () => {
    const outcome = evaluateCourseResult(
      { subjectCode: 'BXXX101', internal: 40, external: 60, total: 100 },
      rules,
    );
    expect(isOk(outcome)).toBe(false);
  });
});

describe('the explanation', () => {
  it('cites the clause and states each minimum it used', () => {
    const outcome = evaluateCourseResult(
      { subjectCode: 'BXXX101', internal: 40, external: 20, total: 60 },
      rules,
    );
    if (!isOk(outcome)) throw new Error('expected success');
    expect(outcome.explanation.clause).toContain('22OB 6.3');
    const labels = outcome.explanation.steps.map((step) => step.label).join(' | ');
    expect(labels).toMatch(/CIE minimum/);
    expect(labels).toMatch(/SEE minimum/);
    expect(labels).toMatch(/Total minimum/);
  });

  it('omits the SEE minimum for a course that has no SEE', () => {
    const outcome = evaluateCourseResult(
      { subjectCode: 'BXXX101', internal: 72, external: 0, total: 72 },
      rules,
      { hasSee: false },
    );
    if (!isOk(outcome)) throw new Error('expected success');
    const labels = outcome.explanation.steps.map((step) => step.label).join(' | ');
    expect(labels).not.toMatch(/SEE minimum/);
  });
});
