/**
 * The first run on a device: Terms, then Sign in / Sign up, once.
 *
 * Both answers live on the DEVICE (a new device asks again). They never lock a
 * student out: if storage cannot be read at all, there is no first-run step,
 * and "Keep using GradTools without an account" always finishes it.
 */
import { CURRENT_TERMS } from '@gradtools/shared-types';

export const TERMS_ACCEPTED_KEY = 'gradtools:v1:terms-accepted';
export const FIRST_RUN_DONE_KEY = 'gradtools:v1:first-run-done';

function read(key: string): string | null | undefined {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Storage unavailable: the gate already lets the student through. */
  }
}

export function markTermsAccepted(): void {
  write(TERMS_ACCEPTED_KEY, CURRENT_TERMS.version);
}

export function markFirstRunDone(): void {
  write(FIRST_RUN_DONE_KEY, '1');
}

/** Which first-run screen this device still owes, or null. */
export function firstRunStep(): 'terms' | 'sign-in' | null {
  const terms = read(TERMS_ACCEPTED_KEY);
  const done = read(FIRST_RUN_DONE_KEY);
  if (terms === undefined || done === undefined) return null;
  if (terms !== CURRENT_TERMS.version) return 'terms';
  if (done !== '1') return 'sign-in';
  return null;
}
