/**
 * Local-first access (TERMS-AND-ONBOARDING, revised after the lock-out incident).
 *
 * GradTools is local-first: the core app — the dashboard, results, attendance,
 * timetable, calculators and every on-device record — is usable whether or not
 * anyone is signed in, and whether or not an identity provider is configured.
 *
 * So this wrapper NEVER blocks. A failed Clerk/OAuth initialisation must not
 * lock a student out of their own data, and a signed-out visitor must not be
 * bounced to /sign-in for the whole app. Authentication and Terms are enforced
 * only where they are genuinely required — at the CLOUD boundary:
 *
 *   - `useSync` refuses to sync when signed out (`local_only`) and withholds the
 *     upload until the current Terms are accepted (`needs_terms`).
 *   - the account surfaces (`AccountPage`, `FirstSyncPage`) show a sign-in /
 *     accept-Terms prompt with a return path to the action.
 *
 * The /sign-in and /terms screens are reachable by choice, never by force.
 */

import type { ReactNode } from 'react';

export function OnboardingGate({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
