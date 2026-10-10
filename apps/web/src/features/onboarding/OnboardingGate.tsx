/**
 * The onboarding gate (TERMS-AND-ONBOARDING, Slice 2).
 *
 * Enforces the approved flow in ONE place, around the whole app shell:
 *
 *   no provider configured  → inert; GradTools stays local-first (M9 §25, §40)
 *   session restoring        → a skeleton, never a premature redirect
 *   not signed in            → protected routes go to /sign-in
 *   signed in, terms stale   → everything goes to /terms until accepted
 *   signed in, terms current → the app
 *
 * Authority is the SERVER (`/me`), never localStorage: the gate asks the API
 * whether this account has accepted `CURRENT_TERMS.version`, and if it cannot
 * find out, it refuses access rather than guessing — a failed check is not an
 * accepted one.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ErrorState } from '../../components/ui/feedback.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { authorizedFetch } from '../../lib/api.js';
import { useAuth } from '../auth/AuthContext.js';

/**
 * Routes a signed-out or not-yet-onboarded user may still reach. `/welcome`
 * lives outside the shell, so it never reaches this gate.
 */
const PUBLIC_ROUTES = new Set([
  '/sign-in',
  '/reset-password',
  '/sso-callback',
  '/terms',
  '/onboarding',
]);

type TermsStatus =
  | { readonly phase: 'idle' } // no provider, or not signed in — nothing to fetch
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly accepted: boolean }
  | { readonly phase: 'error' };

/** Reads the authoritative terms state from `/me`, only while signed in. */
function useTermsStatus(signedIn: boolean): {
  readonly status: TermsStatus;
  readonly refetch: () => void;
} {
  const { adapter } = useAuth();
  const [status, setStatus] = useState<TermsStatus>({ phase: 'idle' });
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (adapter === null || !signedIn) {
      setStatus({ phase: 'idle' });
      return;
    }
    let live = true;
    setStatus({ phase: 'loading' });
    void (async () => {
      try {
        const res = await authorizedFetch(adapter, '/api/v1/me');
        if (res === null || !res.ok) throw new Error('me failed');
        const body = (await res.json()) as { terms: { version: string } | null };
        if (live) setStatus({ phase: 'ready', accepted: body.terms !== null });
      } catch {
        if (live) setStatus({ phase: 'error' });
      }
    })();
    return () => {
      live = false;
    };
  }, [adapter, signedIn, nonce]);

  return { status, refetch };
}

export function OnboardingGate({ children }: { readonly children: ReactNode }) {
  const { adapter, state } = useAuth();
  const location = useLocation();
  const signedIn = state.status === 'signed_in';
  const { status, refetch } = useTermsStatus(signedIn);

  // No identity provider in this build: the gate is inert and the app is
  // local-first. The hooks above still run but fetch nothing.
  if (adapter === null) return <>{children}</>;

  const isPublic = PUBLIC_ROUTES.has(location.pathname);

  if (state.status === 'restoring') return <PageSkeleton label="Checking your session" />;

  // Signed out or an expired session: only the public routes render; anything
  // else sends them to sign in.
  if (!signedIn) return isPublic ? <>{children}</> : <Navigate to="/sign-in" replace />;

  // Signed in — the terms check decides. Until it resolves we wait; if it
  // fails we refuse access and offer a retry (a failed check is not consent).
  if (status.phase === 'idle' || status.phase === 'loading')
    return <PageSkeleton label="Loading your account" />;
  if (status.phase === 'error')
    return (
      <div className="mx-auto w-full max-w-md py-8">
        <ErrorState
          title="We couldn’t load your account"
          message="GradTools needs to confirm your account before continuing. Check your connection and try again."
          onRetry={refetch}
        />
      </div>
    );

  if (!status.accepted)
    return location.pathname === '/terms' ? <>{children}</> : <Navigate to="/terms" replace />;

  // Terms accepted: a signed-in user on /terms has nothing left to do here.
  if (location.pathname === '/terms') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
