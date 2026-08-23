/**
 * SGPA and CGPA.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.8 (22OB 6.6)
 *
 *   SGPA = Sum(Ci x Gi) / Sum(Ci)      22OB 6.6(2a)
 *   CGPA = Sum(Ci x Si) / Sum(Ci)      22OB 6.6(2b)
 *
 * Rounded to 2 decimal places once, at the end (22OB 6.6(2b)).
 */

import { resolveGrade } from './grades.js';
import { assertUsableRuleSet, buildExplanation, fail, isFiniteNumber, succeed } from './result.js';
import { applyRounding } from './rounding.js';
import type {
  CourseGrade,
  ExplanationStep,
  RuleResult,
  RuleSet,
  SemesterSummary,
} from './types.js';

const SGPA_FORMULA = 'SGPA = Sum(Ci x Gi) / Sum(Ci)';
const CGPA_FORMULA = 'CGPA = Sum(Ci x Si) / Sum(Ci)';

/** Formula identifiers this engine knows how to evaluate. */
const SUPPORTED_SGPA_FORMULAS = new Set(['credit_weighted_gp']);
const SUPPORTED_CGPA_FORMULAS = new Set(['credit_weighted_sgpa']);

/**
 * Semester Grade Point Average (22OB 6.6(2a)).
 *
 * Credit participation follows the resolved grade:
 *   - a regular band (including F, 0 points) always counts, credits included;
 *   - a special grade counts only when `includedInGpa` is true. DX does not:
 *     "Credits are not included in CGPA" (22OB 6.2(1)).
 */
export function calculateSGPA(
  courses: readonly CourseGrade[],
  ruleSet: RuleSet,
): RuleResult<number> {
  const baseExplanation = buildExplanation(ruleSet, {
    formula: SGPA_FORMULA,
    clause: '22OB 6.6(2a)',
    inputs: { courseCount: courses.length },
  });

  const guard = assertUsableRuleSet(ruleSet, baseExplanation);
  if (guard) return guard;

  if (!SUPPORTED_SGPA_FORMULAS.has(ruleSet.sgpaFormulaId)) {
    return fail(
      'invalid_input',
      `Rule set "${ruleSet.id}" declares SGPA formula "${ruleSet.sgpaFormulaId}", which this engine does not implement.`,
      baseExplanation,
    );
  }

  if (courses.length === 0) {
    return fail('insufficient_input', 'Add at least one course.', baseExplanation);
  }

  let weightedPoints = 0;
  let totalCredits = 0;
  let excludedCourses = 0;
  const steps: ExplanationStep[] = [];

  for (const [index, course] of courses.entries()) {
    const position = index + 1;
    const label = course.subjectCode ?? `Course ${String(position)}`;

    if (!isFiniteNumber(course.credits)) {
      return fail('invalid_input', `${label}: credits must be a finite number.`, baseExplanation);
    }
    if (course.credits < 0) {
      return fail('invalid_input', `${label}: credits cannot be negative.`, baseExplanation);
    }

    const grade = resolveGrade(course.gradeLetter, ruleSet);
    if (!grade.ok) {
      return fail(grade.reason, `${label}: ${grade.detail}`, grade.explanation);
    }

    if (!grade.value.includedInGpa) {
      excludedCourses += 1;
      steps.push({ label: `${label} (${grade.value.letter}) excluded from GPA`, value: 0 });
      continue;
    }

    const contribution = course.credits * grade.value.points;
    weightedPoints += contribution;
    totalCredits += course.credits;
    steps.push({
      label: `${label}: ${String(course.credits)} credits x ${String(grade.value.points)} points (${grade.value.letter})`,
      value: contribution,
    });
  }

  const explanation = buildExplanation(ruleSet, {
    formula: SGPA_FORMULA,
    clause: '22OB 6.6(2a)',
    inputs: {
      courseCount: courses.length,
      excludedCourses,
      weightedPoints,
      totalCredits,
    },
    steps: [
      ...steps,
      { label: 'Sum(Ci x Gi)', value: weightedPoints },
      { label: 'Sum(Ci)', value: totalCredits },
    ],
  });

  if (totalCredits === 0) {
    return fail(
      'insufficient_input',
      excludedCourses > 0
        ? 'Every course entered is excluded from GPA, so no SGPA can be computed.'
        : 'Total credits are zero, so no SGPA can be computed.',
      explanation,
    );
  }

  return succeed(applyRounding(weightedPoints / totalCredits, ruleSet.rounding), explanation);
}

/**
 * Cumulative Grade Point Average (22OB 6.6(2b)).
 *
 * Takes per-semester credit totals and SGPAs, matching how the regulation
 * states the formula. Deriving each semester's SGPA is the caller's job.
 */
export function calculateCGPA(
  semesters: readonly SemesterSummary[],
  ruleSet: RuleSet,
): RuleResult<number> {
  const baseExplanation = buildExplanation(ruleSet, {
    formula: CGPA_FORMULA,
    clause: '22OB 6.6(2b)',
    inputs: { semesterCount: semesters.length },
  });

  const guard = assertUsableRuleSet(ruleSet, baseExplanation);
  if (guard) return guard;

  if (!SUPPORTED_CGPA_FORMULAS.has(ruleSet.cgpaFormulaId)) {
    return fail(
      'invalid_input',
      `Rule set "${ruleSet.id}" declares CGPA formula "${ruleSet.cgpaFormulaId}", which this engine does not implement.`,
      baseExplanation,
    );
  }

  if (semesters.length === 0) {
    return fail('insufficient_input', 'Add at least one semester.', baseExplanation);
  }

  const maxGradePoint = highestGradePoint(ruleSet);
  let weighted = 0;
  let totalCredits = 0;
  const steps: ExplanationStep[] = [];

  for (const [index, semester] of semesters.entries()) {
    const label =
      semester.semester === undefined
        ? `Semester ${String(index + 1)}`
        : `Semester ${String(semester.semester)}`;

    if (!isFiniteNumber(semester.credits) || !isFiniteNumber(semester.sgpa)) {
      return fail(
        'invalid_input',
        `${label}: credits and SGPA must be finite numbers.`,
        baseExplanation,
      );
    }
    if (semester.credits < 0) {
      return fail('invalid_input', `${label}: credits cannot be negative.`, baseExplanation);
    }
    if (semester.sgpa < 0 || semester.sgpa > maxGradePoint) {
      return fail(
        'invalid_input',
        `${label}: SGPA must be between 0 and ${String(maxGradePoint)}.`,
        baseExplanation,
      );
    }

    const contribution = semester.credits * semester.sgpa;
    weighted += contribution;
    totalCredits += semester.credits;
    steps.push({
      label: `${label}: ${String(semester.credits)} credits x SGPA ${String(semester.sgpa)}`,
      value: contribution,
    });
  }

  const explanation = buildExplanation(ruleSet, {
    formula: CGPA_FORMULA,
    clause: '22OB 6.6(2b)',
    inputs: { semesterCount: semesters.length, weighted, totalCredits },
    steps: [
      ...steps,
      { label: 'Sum(Ci x Si)', value: weighted },
      { label: 'Sum(Ci)', value: totalCredits },
    ],
  });

  if (totalCredits === 0) {
    return fail(
      'insufficient_input',
      'Total credits across the semesters are zero, so no CGPA can be computed.',
      explanation,
    );
  }

  return succeed(applyRounding(weighted / totalCredits, ruleSet.rounding), explanation);
}

/** The maximum attainable grade point under a rule set (10 on the VTU scale). */
export function highestGradePoint(ruleSet: RuleSet): number {
  return ruleSet.gradeBands.reduce((max, band) => (band.points > max ? band.points : max), 0);
}
