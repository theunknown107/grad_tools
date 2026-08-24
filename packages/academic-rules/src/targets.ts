/**
 * Target calculations: marks needed in the SEE, and SGPA needed for a target CGPA.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.9 (derived from 22OB 6.3)
 *
 * Three INDEPENDENT, SIMULTANEOUS thresholds apply to a course (22OB 6.3):
 *   1. CIE   >= cieMinPct% of cieMax        -> eligibility to sit the SEE
 *   2. SEE   >= seeMinPct% of the SEE scale -> passing the SEE head
 *   3. Total >= overallMinPct% of courseMax -> passing the course
 *
 * The result always names the BINDING constraint, because that is the
 * actionable part for a student.
 */

import { findGradeBand } from './grades.js';
import { highestGradePoint } from './gpa.js';
import { assertUsableRuleSet, buildExplanation, fail, isFiniteNumber, succeed } from './result.js';
import { applyRounding } from './rounding.js';
import type { MarksTarget, RequiredMarksOutcome, RuleResult, RuleSet } from './types.js';

const CEIL_TOLERANCE = 1e-9;

/** Resolves a target into a required total-course percentage, using the rule set. */
function resolveTargetPercentage(target: MarksTarget, ruleSet: RuleSet): RuleResult<number> {
  const explanation = buildExplanation(ruleSet, {
    formula: 'target -> required course percentage',
    clause: '22OB 6.1, 6.3',
    inputs: {},
  });

  switch (target.kind) {
    case 'pass':
      return succeed(ruleSet.overallMinPct, explanation);
    case 'grade': {
      const band = findGradeBand(target.letter, ruleSet);
      if (!band) {
        return fail(
          'invalid_input',
          `Unknown target grade "${target.letter}" for rule set "${ruleSet.id}".`,
          explanation,
        );
      }
      return succeed(band.minPct, explanation);
    }
    case 'percentage': {
      if (!isFiniteNumber(target.percentage)) {
        return fail('invalid_input', 'Target percentage must be a finite number.', explanation);
      }
      if (target.percentage < 0 || target.percentage > 100) {
        return fail('invalid_input', 'Target percentage must be between 0 and 100.', explanation);
      }
      return succeed(target.percentage, explanation);
    }
  }
}

/**
 * Minimum SEE mark needed to reach a target.
 *
 *   required = max( seeMinPct% of seeMax , (target - cieObtained) / seeScale )
 *
 * where `seeScale` converts a raw SEE mark into its contribution to the course
 * total. Under VTU 2022 the SEE is written for 100 and contributes 50, so
 * seeScale is 0.5 and the overall term becomes 2 x (target - CIE).
 *
 * The scale is derived from the rule set rather than hard-coded, so a scheme
 * with a different CIE/SEE split needs no code change.
 */
export function calculateRequiredMarks(
  cieObtained: number,
  target: MarksTarget,
  ruleSet: RuleSet,
): RuleResult<RequiredMarksOutcome> {
  const formula = 'required SEE = max(SEE minimum, (target - CIE) / SEE scale)';
  const clause = '22OB 6.3';

  const baseExplanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: { cieObtained },
  });

  const guard = assertUsableRuleSet(ruleSet, baseExplanation);
  if (guard) return guard;

  if (!isFiniteNumber(cieObtained)) {
    return fail('invalid_input', 'CIE marks must be a finite number.', baseExplanation);
  }
  if (cieObtained < 0) {
    return fail('invalid_input', 'CIE marks cannot be negative.', baseExplanation);
  }
  if (cieObtained > ruleSet.cieMax) {
    return fail(
      'invalid_input',
      `CIE marks cannot exceed the maximum of ${String(ruleSet.cieMax)}.`,
      baseExplanation,
    );
  }
  if (ruleSet.seeMax <= 0 || ruleSet.courseMax <= ruleSet.cieMax) {
    return fail(
      'invalid_input',
      `Rule set "${ruleSet.id}" has an inconsistent CIE/SEE structure.`,
      baseExplanation,
    );
  }

  const targetResult = resolveTargetPercentage(target, ruleSet);
  if (!targetResult.ok) return targetResult;
  const targetTotal = (targetResult.value / 100) * ruleSet.courseMax;

  // Eligibility to sit the SEE at all (22OB 6.3(1), 6.3(7)).
  const cieMinimum = (ruleSet.cieMinPct / 100) * ruleSet.cieMax;
  if (cieObtained < cieMinimum) {
    return fail(
      'ineligible',
      `A CIE of ${String(cieObtained)} is below the minimum of ${String(cieMinimum)} ` +
        `(${String(ruleSet.cieMinPct)}% of ${String(ruleSet.cieMax)}), so you are not eligible ` +
        `for the SEE in this course. The course must be re-registered for CIE before the SEE ` +
        `can be attempted (22OB 6.3(7), 6.3(8)).`,
      buildExplanation(ruleSet, {
        formula,
        clause: '22OB 6.3(1), 6.3(7)',
        inputs: { cieObtained, cieMinimum },
        steps: [{ label: 'Minimum CIE required', value: cieMinimum }],
      }),
    );
  }

  // Contribution of one raw SEE mark to the course total.
  const seeWeight = ruleSet.courseMax - ruleSet.cieMax;
  const seeScale = seeWeight / ruleSet.seeMax;

  const seeHeadMinimum = (ruleSet.seeMinPct / 100) * ruleSet.seeMax;
  const neededForOverall = (targetTotal - cieObtained) / seeScale;

  const rawRequired = Math.max(seeHeadMinimum, neededForOverall);
  // Marks are whole numbers; a student cannot score a fraction of a mark.
  const rawSeeRequired = Math.max(0, Math.ceil(rawRequired - CEIL_TOLERANCE));

  /*
   * The same requirement on the scale a grade card prints (A-16.7, M4.1 §4).
   * Deliberately NOT rounded: it is a converted view of `rawSeeRequired`, and
   * rounding it would produce a second number that does not convert back.
   */
  const printedExternalEquivalent = rawSeeRequired * seeScale;

  const bindingConstraint = neededForOverall > seeHeadMinimum ? 'overall_target' : 'see_minimum';

  const explanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: {
      cieObtained,
      targetPercentage: targetResult.value,
      targetTotalMarks: targetTotal,
      seeHeadMinimum,
      neededForOverall,
      seeMax: ruleSet.seeMax,
    },
    steps: [
      { label: 'SEE minimum for the head', value: seeHeadMinimum },
      { label: 'SEE needed for the overall target', value: neededForOverall },
      { label: 'Required raw SEE (out of 100)', value: rawSeeRequired },
      { label: 'Equivalent printed External (out of 50)', value: printedExternalEquivalent },
    ],
  });

  if (rawSeeRequired > ruleSet.seeMax) {
    return fail(
      'unreachable',
      `That target is no longer reachable: it would need ${String(rawSeeRequired)} out of ` +
        `${String(ruleSet.seeMax)} in the SEE ` +
        `(${String(printedExternalEquivalent)} out of ${String(seeWeight)} as printed on a grade card).`,
      explanation,
    );
  }

  return succeed(
    {
      rawSeeRequired,
      rawSeeMaximum: ruleSet.seeMax,
      printedExternalEquivalent,
      printedExternalMaximum: seeWeight,
      bindingConstraint,
    },
    explanation,
  );
}

/**
 * SGPA needed across the remaining credits to reach a target CGPA.
 *
 *   required = (target x (done + remaining) - current x done) / remaining
 *
 * Reports `unreachable` with the maximum attainable CGPA rather than clamping,
 * because the maximum attainable figure is the useful answer (16 §16.9).
 */
export function calculateRequiredSGPA(
  currentCgpa: number,
  creditsCompleted: number,
  creditsRemaining: number,
  targetCgpa: number,
  ruleSet: RuleSet,
): RuleResult<number> {
  const formula =
    'required SGPA = (target x (completed + remaining) - current x completed) / remaining';
  const clause = '22OB 6.6(2b) (derived)';

  const baseExplanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: { currentCgpa, creditsCompleted, creditsRemaining, targetCgpa },
  });

  const guard = assertUsableRuleSet(ruleSet, baseExplanation);
  if (guard) return guard;

  const maxGradePoint = highestGradePoint(ruleSet);

  if (
    !isFiniteNumber(currentCgpa) ||
    !isFiniteNumber(creditsCompleted) ||
    !isFiniteNumber(creditsRemaining) ||
    !isFiniteNumber(targetCgpa)
  ) {
    return fail('invalid_input', 'All inputs must be finite numbers.', baseExplanation);
  }
  if (creditsCompleted < 0 || creditsRemaining < 0) {
    return fail('invalid_input', 'Credits cannot be negative.', baseExplanation);
  }
  if (currentCgpa < 0 || currentCgpa > maxGradePoint) {
    return fail(
      'invalid_input',
      `Current CGPA must be between 0 and ${String(maxGradePoint)}.`,
      baseExplanation,
    );
  }
  if (targetCgpa < 0 || targetCgpa > maxGradePoint) {
    return fail(
      'invalid_input',
      `Target CGPA must be between 0 and ${String(maxGradePoint)}.`,
      baseExplanation,
    );
  }
  if (creditsRemaining === 0) {
    return fail(
      'insufficient_input',
      'There are no remaining credits, so the CGPA can no longer change.',
      baseExplanation,
    );
  }

  const totalCredits = creditsCompleted + creditsRemaining;
  const required = (targetCgpa * totalCredits - currentCgpa * creditsCompleted) / creditsRemaining;

  const explanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: { currentCgpa, creditsCompleted, creditsRemaining, targetCgpa },
    steps: [{ label: 'Required SGPA', value: required }],
  });

  if (required > maxGradePoint) {
    const maxAttainable =
      (currentCgpa * creditsCompleted + maxGradePoint * creditsRemaining) / totalCredits;
    return fail(
      'unreachable',
      `A CGPA of ${String(targetCgpa)} is no longer reachable. Scoring the maximum ` +
        `${String(maxGradePoint)} in every remaining credit gives at most ` +
        `${applyRounding(maxAttainable, ruleSet.rounding).toFixed(2)}.`,
      buildExplanation(ruleSet, {
        formula,
        clause,
        inputs: { currentCgpa, creditsCompleted, creditsRemaining, targetCgpa },
        steps: [
          { label: 'Required SGPA', value: required },
          { label: 'Maximum attainable CGPA', value: maxAttainable },
        ],
      }),
    );
  }

  // A negative requirement means the target is already met; report 0, since a
  // student cannot score below zero and the useful answer is "nothing more".
  return succeed(applyRounding(Math.max(0, required), ruleSet.rounding), explanation);
}
