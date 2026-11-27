/**
 * The attendance rules the screens judge against, and the student's own target.
 *
 * EVERY VERDICT USES THE OFFICIAL RULE SET, unmodified (docs/16 §16.7):
 *   - 85% per registered course is the requirement (22OB 3.7(1));
 *   - a shortage of up to 10 points MAY be condoned by the Vice Chancellor on
 *     the Principal's recommendation: discretionary, never automatic;
 *   - below 75% the course is marked DX and its exam cannot be sat
 *     (22OB 3.7(5), 6.2(1)).
 * Nothing on this device can change those figures.
 *
 * The screens compute only for the 2022 scheme (useSchemeRules().builtIn);
 * another scheme sees "not calculated" rather than 2022 figures.
 *
 * A PERSONAL TARGET is a goal the student sets at or above the requirement
 * (85, 90 or 95%). It adds its own labelled line to the attendance plan and
 * never changes a verdict. There is no college-specific threshold: GradTools
 * holds no verified institutional policy, so it does not offer one.
 */

import { vtu2022RuleSet, type RuleSet } from '@gradtools/academic-rules';
import { useSyncExternalStore } from 'react';

/* The key the earlier "criteria" picker used: a stored 85 or 90 carries over;
   anything below the requirement (60–80) is ignored and reads as 85. */
const KEY = 'gradtools:v1:attendance-criteria';
export const PERSONAL_TARGET_OPTIONS = [85, 90, 95] as const;
export const DEFAULT_PERSONAL_TARGET = vtu2022RuleSet.attendanceRequiredPct;

const listeners = new Set<() => void>();

export function personalTarget(): number {
  try {
    const stored = Number(window.localStorage.getItem(KEY));
    return (PERSONAL_TARGET_OPTIONS as readonly number[]).includes(stored)
      ? stored
      : DEFAULT_PERSONAL_TARGET;
  } catch {
    return DEFAULT_PERSONAL_TARGET;
  }
}

export function setPersonalTarget(percent: number): void {
  try {
    window.localStorage.setItem(KEY, String(percent));
  } catch {
    /* Storage unavailable: the default stays in force. */
  }
  for (const listener of listeners) listener();
}

/** Re-renders the caller when the target changes. */
export function usePersonalTarget(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    personalTarget,
    () => DEFAULT_PERSONAL_TARGET,
  );
}

/** The official rules every verdict, margin and recovery count uses. */
export function attendanceRules(): RuleSet {
  return vtu2022RuleSet;
}

/**
 * The same arithmetic aimed at the personal target, for its own labelled line
 * only. Never used for a status.
 */
export function targetRules(target: number): RuleSet {
  return { ...vtu2022RuleSet, attendanceRequiredPct: target };
}
