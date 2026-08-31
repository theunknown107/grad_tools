/**
 * @gradtools/academic-rules
 *
 * Pure, deterministic, zero-dependency VTU academic calculations.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md
 *
 * Invariants (docs/33 §33.4, enforced by lint and by test/purity.test.ts):
 *   1. No imports outside this package. No Node built-ins, no browser globals.
 *   2. No I/O, no clock, no randomness, no environment access.
 *   3. Every exported calculation takes an explicit RuleSet.
 *   4. Every calculation returns a discriminated RuleResult. Never NaN,
 *      never Infinity, never a thrown exception for an expected outcome.
 *   5. Every function cites its regulation clause.
 *   6. No VTU-specific number appears in the logic — only in ./rulesets.
 */

export type {
  AttendanceOutcome,
  AttendanceStatus,
  BindingConstraint,
  ClassBand,
  CourseGrade,
  Explanation,
  ExplanationStep,
  FailureReason,
  GradeBand,
  MarksTarget,
  RequiredMarksOutcome,
  RoundingPolicy,
  RuleFailure,
  RuleResult,
  RuleSet,
  RuleSuccess,
  SemesterSummary,
  SpecialGrade,
} from './types.js';

export { isOk } from './result.js';
export { roundHalfUp, applyRounding } from './rounding.js';

export {
  findGradeBand,
  findSpecialGrade,
  gradeFromMarks,
  resolveGrade,
  type ResolvedGrade,
} from './grades.js';

export { calculateSGPA, calculateCGPA, highestGradePoint } from './gpa.js';

export { validateCourseMarks, type CourseMarks, type ValidatedCourseMarks } from './marks.js';

export {
  evaluateCourseResult,
  type CourseHeadOutcome,
  type CourseResult,
} from './course-result.js';

export {
  calculateClass,
  calculatePercentage,
  listPercentageFormulaIds,
  resolvePercentageFormula,
  type PercentageFormula,
} from './percentage.js';

export {
  calculateAttendance,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
} from './attendance.js';

export { calculateRequiredMarks, calculateRequiredSGPA } from './targets.js';

export { vtu2022RuleSet, VTU_2022_RULE_SET_ID } from './rulesets/vtu-2022.js';
export { getActiveRuleSetForScheme, getRuleSet, listRuleSets } from './rulesets/registry.js';
