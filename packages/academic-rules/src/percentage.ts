/**
 * CGPA -> percentage -> class equivalence.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.8 (22OB 6.7, 6.8)
 *
 *   22OB 6.7: "Percentage of marks secured, M = CGPA Earned x 10"
 *   Worked example in the regulation: CGPA 8.20 -> 82.0%
 *
 * THE OBSOLETE FORMULA IS NOT IMPLEMENTED ANYWHERE IN THIS PACKAGE.
 *
 * Essentially every third-party VTU calculator publishes (CGPA - 0.75) x 10,
 * which does NOT appear in the 2022 regulation and would give 74.5% for the
 * regulation's own 82.0% example. It is not registered here, not referenced
 * here, and not reachable from any rule set.
 *
 * The formula is selected by `RuleSet.percentageFormulaId` and resolved through
 * the registry below. It is never written inline, so a scheme that is one day
 * verified to use a different conversion becomes a new registry entry plus a
 * new rule set, never an `if` in a calculator.
 */

import { assertUsableRuleSet, buildExplanation, fail, isFiniteNumber, succeed } from './result.js';
import { applyRounding } from './rounding.js';
import { highestGradePoint } from './gpa.js';
import type { ClassBand, RuleResult, RuleSet } from './types.js';

export interface PercentageFormula {
  readonly id: string;
  readonly expression: string;
  readonly clause: string;
  readonly apply: (cgpa: number) => number;
}

/**
 * Registry of percentage conversions this engine can evaluate.
 *
 * Exactly one entry, because exactly one conversion is verified (22OB 6.7).
 * Adding an entry requires a verified source clause for a scheme that uses it.
 */
const PERCENTAGE_FORMULAS: ReadonlyMap<string, PercentageFormula> = new Map([
  [
    'cgpa_x_10',
    {
      id: 'cgpa_x_10',
      expression: 'M = CGPA x 10',
      clause: '22OB 6.7',
      apply: (cgpa: number): number => cgpa * 10,
    },
  ],
]);

/** Exposed for tests and for operator tooling that lists available conversions. */
export function listPercentageFormulaIds(): readonly string[] {
  return [...PERCENTAGE_FORMULAS.keys()];
}

export function resolvePercentageFormula(id: string): PercentageFormula | undefined {
  return PERCENTAGE_FORMULAS.get(id);
}

/**
 * Converts CGPA to a percentage of marks (22OB 6.7).
 *
 * Requires a RuleSet. There is deliberately no overload that omits it, so no
 * caller can compute a percentage without stating which scheme's rules apply.
 */
export function calculatePercentage(cgpa: number, ruleSet: RuleSet): RuleResult<number> {
  const baseExplanation = buildExplanation(ruleSet, {
    formula: 'percentage conversion defined by the rule set',
    clause: '22OB 6.7',
    inputs: { cgpa },
  });

  const guard = assertUsableRuleSet(ruleSet, baseExplanation);
  if (guard) return guard;

  if (!isFiniteNumber(cgpa)) {
    return fail('invalid_input', 'CGPA must be a finite number.', baseExplanation);
  }

  const maxGradePoint = highestGradePoint(ruleSet);
  if (cgpa < 0 || cgpa > maxGradePoint) {
    return fail(
      'invalid_input',
      `CGPA must be between 0 and ${String(maxGradePoint)}.`,
      baseExplanation,
    );
  }

  const formula = resolvePercentageFormula(ruleSet.percentageFormulaId);
  if (!formula) {
    return fail(
      'invalid_input',
      `Rule set "${ruleSet.id}" declares percentage formula "${ruleSet.percentageFormulaId}", ` +
        `which this engine does not implement. Known formulas: ${listPercentageFormulaIds().join(', ')}.`,
      baseExplanation,
    );
  }

  const percentage = applyRounding(formula.apply(cgpa), ruleSet.rounding);

  return succeed(
    percentage,
    buildExplanation(ruleSet, {
      formula: formula.expression,
      clause: formula.clause,
      inputs: { cgpa },
      steps: [
        { label: 'CGPA', value: cgpa },
        { label: formula.expression, value: percentage },
      ],
    }),
  );
}

/**
 * Class equivalence from a percentage (22OB 6.8).
 *
 * The regulation's own bands overlap at exactly M = 50 (Second Class is
 * 50 <= M < 60, Pass Class is 40 <= M <= 50). GradTools resolves the overlap to
 * the HIGHER classification by scanning bands from the top down
 * (assumption A-16.3, docs/16 §16.8).
 *
 * Applies after successful completion of the programme, so a caller showing it
 * to an enrolled student should present it as provisional.
 */
export function calculateClass(percentage: number, ruleSet: RuleSet): RuleResult<ClassBand> {
  const baseExplanation = buildExplanation(ruleSet, {
    formula: 'percentage -> class band',
    clause: '22OB 6.8',
    inputs: { percentage },
  });

  const guard = assertUsableRuleSet(ruleSet, baseExplanation);
  if (guard) return guard;

  if (!isFiniteNumber(percentage)) {
    return fail('invalid_input', 'Percentage must be a finite number.', baseExplanation);
  }
  if (percentage < 0 || percentage > 100) {
    return fail('invalid_input', 'Percentage must be between 0 and 100.', baseExplanation);
  }

  const ordered = [...ruleSet.classBands].sort((a, b) => b.minPct - a.minPct);
  const band = ordered.find(
    (candidate) => percentage >= candidate.minPct && percentage <= candidate.maxPct,
  );

  if (!band) {
    return fail(
      'ineligible',
      `A percentage of ${String(percentage)}% is below the lowest class band in rule set "${ruleSet.id}".`,
      baseExplanation,
    );
  }

  return succeed(
    band,
    buildExplanation(ruleSet, {
      formula: 'percentage -> class band',
      clause: '22OB 6.8',
      inputs: { percentage, minPct: band.minPct, maxPct: band.maxPct },
      steps: [{ label: band.label, value: percentage }],
    }),
  );
}
