/**
 * Rule-set registry.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.13
 *
 * Two schemes never share calculation logic. Supporting a new scheme means
 * adding a verified rule set here, never adding a branch to a calculator.
 *
 * In a later milestone rule sets will be loaded from the database (docs/09
 * §9.4). This registry keeps the same contract: an unknown identifier fails,
 * and an unverified rule set can never be returned as active.
 */

import type { RuleSet } from '../types.js';
import { vtu2022RuleSet } from './vtu-2022.js';

const RULE_SETS: ReadonlyMap<string, RuleSet> = new Map([[vtu2022RuleSet.id, vtu2022RuleSet]]);

/** Every rule set known to this build, verified or not. */
export function listRuleSets(): readonly RuleSet[] {
  return [...RULE_SETS.values()];
}

/** Looks up a rule set by identifier. Returns undefined when unknown. */
export function getRuleSet(id: string): RuleSet | undefined {
  return RULE_SETS.get(id);
}

/**
 * The active rule set for a scheme.
 *
 * Mirrors the `one_active_rule_set` unique index (docs/09 §9.4): at most one
 * rule set per scheme may be active, and an unverified one never counts.
 */
export function getActiveRuleSetForScheme(schemeId: string): RuleSet | undefined {
  return listRuleSets().find(
    (ruleSet) => ruleSet.schemeId === schemeId && ruleSet.active && ruleSet.verifiedAt !== null,
  );
}
