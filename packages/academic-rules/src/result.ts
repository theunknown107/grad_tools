/**
 * Result constructors and rule-set guards.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.10
 */

import type {
  Explanation,
  ExplanationStep,
  FailureReason,
  RuleFailure,
  RuleResult,
  RuleSet,
  RuleSuccess,
} from './types.js';

export interface ExplanationInput {
  readonly formula: string;
  readonly clause: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly steps?: readonly ExplanationStep[];
}

/** Builds the Explanation that accompanies every result, success or failure. */
export function buildExplanation(ruleSet: RuleSet, input: ExplanationInput): Explanation {
  return {
    formula: input.formula,
    clause: input.clause,
    sourceUrl: ruleSet.sourceUrl,
    inputs: input.inputs,
    steps: input.steps ?? [],
    ruleSetId: ruleSet.id,
    ruleSetVersion: ruleSet.version,
  };
}

export function succeed<T>(value: T, explanation: Explanation): RuleSuccess<T> {
  return { ok: true, value, explanation };
}

export function fail(reason: FailureReason, detail: string, explanation: Explanation): RuleFailure {
  return { ok: false, reason, detail, explanation };
}

/**
 * Guards every public entry point.
 *
 * Mirrors the database constraint `rule_set_active_requires_verification`
 * (docs/09 §9.4): an unverified or inactive rule set can never compute a
 * student-facing number.
 */
export function assertUsableRuleSet(
  ruleSet: RuleSet,
  explanation: Explanation,
): RuleFailure | null {
  if (ruleSet.verifiedAt === null) {
    return fail(
      'invalid_input',
      `Rule set "${ruleSet.id}" has not been verified against its source document and cannot be used for calculations.`,
      explanation,
    );
  }
  if (!ruleSet.active) {
    return fail(
      'invalid_input',
      `Rule set "${ruleSet.id}" (version ${String(ruleSet.version)}) is not active.`,
      explanation,
    );
  }
  return null;
}

/** True when the value is a usable finite number. Rejects NaN and Infinity. */
export function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Type guard narrowing a result to its success branch. Convenience for callers. */
export function isOk<T>(result: RuleResult<T>): result is RuleSuccess<T> {
  return result.ok;
}
