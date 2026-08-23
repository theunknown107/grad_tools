/**
 * Attendance, bunk planning and recovery.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.7 (22OB 3.7), §16.9
 *
 *   Required attendance     85%  (22OB 3.7(1))
 *   Maximum condonation     10 percentage points, DISCRETIONARY (22OB 3.7(1))
 *   DX floor                below 75% -> barred from the SEE (22OB 6.2(1), 3.7(5))
 *
 * These figures come from the rule set, never from constants in this file.
 *
 * Product constraint (docs/19 §19.11, docs/28 §28.6): this module reports
 * arithmetic. It never advises a student to skip a class.
 */

import { assertUsableRuleSet, buildExplanation, fail, isFiniteNumber, succeed } from './result.js';
import type { AttendanceOutcome, AttendanceStatus, RuleResult, RuleSet } from './types.js';

/**
 * Guards `Math.floor` against binary floating point error.
 *
 * (17 * 100) / 85 is mathematically 20 but can compute as 19.999999999999996,
 * which would floor to 19 and under-report by a whole class.
 */
const FLOOR_TOLERANCE = 1e-9;

interface CountsValidation {
  readonly failure: RuleResult<never> | null;
}

function validateCounts(
  attended: number,
  conducted: number,
  ruleSet: RuleSet,
  formula: string,
  clause: string,
): CountsValidation {
  const explanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: { attended, conducted },
  });

  const guard = assertUsableRuleSet(ruleSet, explanation);
  if (guard) return { failure: guard };

  if (!isFiniteNumber(attended) || !isFiniteNumber(conducted)) {
    return {
      failure: fail('invalid_input', 'Class counts must be finite numbers.', explanation),
    };
  }
  if (!Number.isInteger(attended) || !Number.isInteger(conducted)) {
    return { failure: fail('invalid_input', 'Class counts must be whole numbers.', explanation) };
  }
  if (attended < 0 || conducted < 0) {
    return { failure: fail('invalid_input', 'Class counts cannot be negative.', explanation) };
  }
  if (attended > conducted) {
    return {
      failure: fail(
        'invalid_input',
        `Attended (${String(attended)}) cannot be more than conducted (${String(conducted)}).`,
        explanation,
      ),
    };
  }
  return { failure: null };
}

function statusFor(percentage: number, ruleSet: RuleSet): AttendanceStatus {
  if (percentage >= ruleSet.attendanceRequiredPct) return 'safe';
  if (percentage >= ruleSet.attendanceDxFloorPct) return 'below_requirement';
  return 'dx_risk';
}

/** Current attendance percentage and its status against the rule set thresholds. */
export function calculateAttendance(
  attended: number,
  conducted: number,
  ruleSet: RuleSet,
): RuleResult<AttendanceOutcome> {
  const formula = 'attendance % = attended / conducted x 100';
  const clause = '22OB 3.7';

  const { failure } = validateCounts(attended, conducted, ruleSet, formula, clause);
  if (failure) return failure;

  const explanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: { attended, conducted },
  });

  if (conducted === 0) {
    return fail(
      'insufficient_input',
      'No classes have been conducted yet, so attendance cannot be calculated.',
      explanation,
    );
  }

  const percentage = (attended / conducted) * 100;
  const status = statusFor(percentage, ruleSet);

  return succeed(
    {
      percentage,
      status,
      requiredPct: ruleSet.attendanceRequiredPct,
      dxFloorPct: ruleSet.attendanceDxFloorPct,
    },
    buildExplanation(ruleSet, {
      formula,
      clause,
      inputs: {
        attended,
        conducted,
        requiredPct: ruleSet.attendanceRequiredPct,
        dxFloorPct: ruleSet.attendanceDxFloorPct,
      },
      steps: [{ label: 'Attendance', value: percentage }],
    }),
  );
}

/**
 * How many further classes may be missed while staying at or above the threshold.
 *
 *   can_miss = floor( attended x 100 / threshold - conducted )      (16 §16.9)
 *
 * Without `remainingClasses`, this assumes no classes are conducted beyond the
 * ones missed. With it, the student is assumed to attend all remaining classes
 * and the answer is how many of those could instead be missed.
 *
 * Never returns a negative number: a student already below the threshold can
 * miss zero more, which is the honest answer.
 */
export function calculateClassesCanMiss(
  attended: number,
  conducted: number,
  ruleSet: RuleSet,
  remainingClasses?: number,
): RuleResult<number> {
  const formula = 'can miss = floor(attended x 100 / threshold - conducted)';
  const clause = '22OB 3.7 (derived)';

  const { failure } = validateCounts(attended, conducted, ruleSet, formula, clause);
  if (failure) return failure;

  const threshold = ruleSet.attendanceRequiredPct;
  const baseExplanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: { attended, conducted, threshold },
  });

  if (threshold <= 0) {
    return fail(
      'invalid_input',
      'The attendance threshold must be greater than zero.',
      baseExplanation,
    );
  }

  let effectiveAttended = attended;
  let effectiveConducted = conducted;

  if (remainingClasses !== undefined) {
    if (!isFiniteNumber(remainingClasses) || !Number.isInteger(remainingClasses)) {
      return fail('invalid_input', 'Remaining classes must be a whole number.', baseExplanation);
    }
    if (remainingClasses < 0) {
      return fail('invalid_input', 'Remaining classes cannot be negative.', baseExplanation);
    }
    effectiveAttended = attended + remainingClasses;
    effectiveConducted = conducted + remainingClasses;
  }

  if (effectiveConducted === 0) {
    return fail(
      'insufficient_input',
      'No classes have been conducted or are scheduled, so there is nothing to plan against.',
      baseExplanation,
    );
  }

  const raw = (effectiveAttended * 100) / threshold - effectiveConducted;
  const canMiss = Math.max(0, Math.floor(raw + FLOOR_TOLERANCE));

  return succeed(
    canMiss,
    buildExplanation(ruleSet, {
      formula,
      clause,
      inputs: {
        attended,
        conducted,
        threshold,
        ...(remainingClasses === undefined ? {} : { remainingClasses }),
      },
      steps: [
        { label: 'Attended x 100 / threshold', value: (effectiveAttended * 100) / threshold },
        { label: 'Classes that may be missed', value: canMiss },
      ],
    }),
  );
}

/**
 * How many classes must be attended consecutively to reach the threshold.
 *
 *   must_attend = ceil( (threshold x conducted - 100 x attended) / (100 - threshold) )
 *
 * Returns `unreachable` when the threshold cannot be regained — either because
 * the threshold is 100% and a class has already been missed, or because the
 * requirement exceeds the classes actually remaining. Telling a student to
 * attend 84 consecutive classes when 20 remain is noise, not advice (16 §16.9).
 */
export function calculateClassesMustAttend(
  attended: number,
  conducted: number,
  ruleSet: RuleSet,
  remainingClasses?: number,
): RuleResult<number> {
  const formula =
    'must attend = ceil((threshold x conducted - 100 x attended) / (100 - threshold))';
  const clause = '22OB 3.7 (derived)';

  const { failure } = validateCounts(attended, conducted, ruleSet, formula, clause);
  if (failure) return failure;

  const threshold = ruleSet.attendanceRequiredPct;
  const explanation = buildExplanation(ruleSet, {
    formula,
    clause,
    inputs: { attended, conducted, threshold },
  });

  if (remainingClasses !== undefined) {
    if (!isFiniteNumber(remainingClasses) || !Number.isInteger(remainingClasses)) {
      return fail('invalid_input', 'Remaining classes must be a whole number.', explanation);
    }
    if (remainingClasses < 0) {
      return fail('invalid_input', 'Remaining classes cannot be negative.', explanation);
    }
  }

  const alreadyMet = conducted > 0 && (attended / conducted) * 100 >= threshold;
  if (alreadyMet) {
    return succeed(
      0,
      buildExplanation(ruleSet, {
        formula,
        clause,
        inputs: { attended, conducted, threshold },
        steps: [{ label: 'Already at or above the threshold', value: 0 }],
      }),
    );
  }

  if (conducted === 0) {
    return fail(
      'insufficient_input',
      'No classes have been conducted yet, so there is no shortfall to recover.',
      explanation,
    );
  }

  if (threshold >= 100) {
    return fail(
      'unreachable',
      'A 100% attendance requirement cannot be regained once a class has been missed.',
      explanation,
    );
  }

  const required = Math.max(
    0,
    Math.ceil((threshold * conducted - 100 * attended) / (100 - threshold) - FLOOR_TOLERANCE),
  );

  if (remainingClasses !== undefined && required > remainingClasses) {
    const maxAttainable = ((attended + remainingClasses) / (conducted + remainingClasses)) * 100;
    return fail(
      'unreachable',
      `Reaching ${String(threshold)}% would need ${String(required)} more classes but only ` +
        `${String(remainingClasses)} remain. The highest attainable attendance is ` +
        `${maxAttainable.toFixed(2)}%.`,
      buildExplanation(ruleSet, {
        formula,
        clause,
        inputs: { attended, conducted, threshold, remainingClasses },
        steps: [
          { label: 'Classes required', value: required },
          { label: 'Classes remaining', value: remainingClasses },
          { label: 'Maximum attainable attendance', value: maxAttainable },
        ],
      }),
    );
  }

  return succeed(
    required,
    buildExplanation(ruleSet, {
      formula,
      clause,
      inputs: {
        attended,
        conducted,
        threshold,
        ...(remainingClasses === undefined ? {} : { remainingClasses }),
      },
      steps: [{ label: 'Consecutive classes to attend', value: required }],
    }),
  );
}
