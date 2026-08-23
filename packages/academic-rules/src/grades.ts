/**
 * Grade resolution: marks percentage -> letter -> grade points.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.3 (22OB 6.1), §16.4 (22OB 6.2)
 */

import { assertUsableRuleSet, buildExplanation, fail, isFiniteNumber, succeed } from './result.js';
import type { GradeBand, RuleResult, RuleSet, SpecialGrade } from './types.js';

/** How a grade participates in the SGPA/CGPA ratio. */
export interface ResolvedGrade {
  readonly letter: string;
  readonly points: number;
  /** Whether credits and points enter the SGPA/CGPA ratio at all. */
  readonly includedInGpa: boolean;
  readonly kind: 'band' | 'special';
}

/** Looks up a regular grade band by letter, case-insensitively. */
export function findGradeBand(letter: string, ruleSet: RuleSet): GradeBand | undefined {
  const needle = letter.trim().toUpperCase();
  return ruleSet.gradeBands.find((band) => band.letter.toUpperCase() === needle);
}

/** Looks up a special grade by letter, case-insensitively. */
export function findSpecialGrade(letter: string, ruleSet: RuleSet): SpecialGrade | undefined {
  const needle = letter.trim().toUpperCase();
  return ruleSet.specialGrades.find((grade) => grade.letter.toUpperCase() === needle);
}

/**
 * Resolves a grade letter to points and GPA participation.
 *
 * Returns `unverified_rule` for a special grade whose behaviour the regulation
 * does not state (currently `AB` — docs/32 OQ-018). The engine refuses to guess
 * rather than inventing a number that would silently alter a student's CGPA.
 */
export function resolveGrade(letter: string, ruleSet: RuleSet): RuleResult<ResolvedGrade> {
  const explanation = buildExplanation(ruleSet, {
    formula: 'letter -> grade points',
    clause: '22OB 6.1, 6.2',
    inputs: {},
  });

  const guard = assertUsableRuleSet(ruleSet, explanation);
  if (guard) return guard;

  const trimmed = letter.trim();
  if (trimmed === '') {
    return fail('invalid_input', 'Grade letter is empty.', explanation);
  }

  const band = findGradeBand(trimmed, ruleSet);
  if (band) {
    return succeed(
      { letter: band.letter, points: band.points, includedInGpa: true, kind: 'band' },
      buildExplanation(ruleSet, {
        formula: 'letter -> grade points',
        clause: '22OB 6.1',
        inputs: { points: band.points },
        steps: [{ label: `Grade ${band.letter}`, value: band.points }],
      }),
    );
  }

  const special = findSpecialGrade(trimmed, ruleSet);
  if (special) {
    if (!special.pointsVerified || special.points === null) {
      return fail(
        'unverified_rule',
        `The grade-point behaviour of "${special.letter}" is not verified in the source regulation, ` +
          `so GradTools will not compute a value that depends on it. ${special.meaning}`,
        buildExplanation(ruleSet, {
          formula: 'letter -> grade points',
          clause: special.clause,
          inputs: {},
        }),
      );
    }
    return succeed(
      {
        letter: special.letter,
        points: special.points,
        includedInGpa: special.includedInGpa,
        kind: 'special',
      },
      buildExplanation(ruleSet, {
        formula: 'letter -> grade points',
        clause: special.clause,
        inputs: { points: special.points },
        steps: [{ label: `Grade ${special.letter}`, value: special.points }],
      }),
    );
  }

  return fail(
    'invalid_input',
    `Unknown grade letter "${trimmed}" for rule set "${ruleSet.id}".`,
    explanation,
  );
}

/**
 * Converts a marks total into a letter grade (22OB 6.1).
 *
 * Fractional percentages are truncated toward zero before band lookup: rounding
 * 89.5 up to 90 would award an "O" the student did not earn (assumption A-16.1,
 * docs/16 §16.3). VTU reports integer totals, so this arises only on manual entry.
 */
export function gradeFromMarks(
  totalMarks: number,
  maxMarks: number,
  ruleSet: RuleSet,
): RuleResult<GradeBand> {
  const explanation = buildExplanation(ruleSet, {
    formula: 'percentage = totalMarks / maxMarks x 100 -> band',
    clause: '22OB 6.1',
    inputs: { totalMarks, maxMarks },
  });

  const guard = assertUsableRuleSet(ruleSet, explanation);
  if (guard) return guard;

  if (!isFiniteNumber(totalMarks) || !isFiniteNumber(maxMarks)) {
    return fail('invalid_input', 'Marks must be finite numbers.', explanation);
  }
  if (maxMarks <= 0) {
    return fail('invalid_input', 'Maximum marks must be greater than zero.', explanation);
  }
  if (totalMarks < 0) {
    return fail('invalid_input', 'Marks cannot be negative.', explanation);
  }
  if (totalMarks > maxMarks) {
    return fail(
      'invalid_input',
      `Marks (${String(totalMarks)}) cannot exceed the maximum (${String(maxMarks)}).`,
      explanation,
    );
  }

  const exactPct = (totalMarks / maxMarks) * 100;
  const lookupPct = Math.trunc(exactPct);

  const band = ruleSet.gradeBands.find(
    (candidate) => lookupPct >= candidate.minPct && lookupPct <= candidate.maxPct,
  );

  const withSteps = buildExplanation(ruleSet, {
    formula: 'percentage = totalMarks / maxMarks x 100 -> band',
    clause: '22OB 6.1',
    inputs: { totalMarks, maxMarks },
    steps: [
      { label: 'Percentage', value: exactPct },
      { label: 'Percentage used for band lookup (truncated)', value: lookupPct },
    ],
  });

  if (!band) {
    return fail(
      'invalid_input',
      `No grade band in rule set "${ruleSet.id}" covers ${String(lookupPct)}%.`,
      withSteps,
    );
  }

  return succeed(band, withSteps);
}
