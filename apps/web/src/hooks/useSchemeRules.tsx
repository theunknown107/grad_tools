/**
 * The academic scheme on this profile, and the rules GradTools holds for it.
 *
 * A profile with no scheme recorded is read as 2022, the scheme every profile
 * held before schemes could be chosen — so nothing a student already saw
 * changes. Any other recorded scheme is taken as stated.
 *
 * `builtIn` is the guard the calculating screens use. Their bodies still read
 * the 2022 rule set directly, so they may render only when the profile's rule
 * set IS that one. When a second scheme gains verified rules, those screens
 * must take the rule set from here instead — and this guard is what makes that
 * a visible failure rather than 2022 rules applied to the wrong student.
 */

import {
  getActiveRuleSetForScheme,
  getScheme,
  vtu2022RuleSet,
  type AcademicScheme,
  type RuleSet,
} from '@gradtools/academic-rules';
import { Link } from 'react-router-dom';
import { externalHref } from '../lib/external-url.js';
import { Callout } from '../components/ui/feedback.js';
import { useProfile } from './useCollection.js';

export const DEFAULT_SCHEME_ID = vtu2022RuleSet.schemeId;

export interface SchemeRules {
  readonly schemeId: string;
  readonly scheme: AcademicScheme | undefined;
  /** The verified rule set for the scheme, or undefined when there is none. */
  readonly ruleSet: RuleSet | undefined;
  /** True when the screens' built-in 2022 rules are this profile's rules. */
  readonly builtIn: boolean;
  readonly loading: boolean;
}

export function schemeRulesFor(schemeId: string | null | undefined): Omit<SchemeRules, 'loading'> {
  const id =
    schemeId === null || schemeId === undefined || schemeId === '' ? DEFAULT_SCHEME_ID : schemeId;
  const ruleSet = getActiveRuleSetForScheme(id);
  return {
    schemeId: id,
    scheme: getScheme(id),
    ruleSet,
    builtIn: ruleSet !== undefined && ruleSet.id === vtu2022RuleSet.id,
  };
}

export function useSchemeRules(): SchemeRules {
  const { profile, loading } = useProfile();
  return { ...schemeRulesFor(profile?.schemeId), loading };
}

/** What a calculating screen shows instead of figures for a scheme it cannot calculate. */
export function SchemeNotice({
  rules,
  what,
}: {
  readonly rules: SchemeRules;
  readonly what: string;
}) {
  const name = rules.scheme?.label ?? rules.schemeId;
  return (
    <Callout tone="info" title={`${what} are not calculated for the ${name} yet.`}>
      Your scheme is recorded, but GradTools holds verified rules only for the 2022 scheme, and
      applying them to another scheme would give figures that look right and are not.{' '}
      {rules.scheme !== undefined && (
        <>
          The{' '}
          <a
            href={externalHref(rules.scheme.regulationUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {name} regulation
          </a>{' '}
          is VTU’s own statement of its rules.{' '}
        </>
      )}
      Wrong scheme? Change it in <Link to="/profile">Profile</Link>.
    </Callout>
  );
}
