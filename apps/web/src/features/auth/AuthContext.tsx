/**
 * Auth state, and the storage scope that follows from it.
 *
 * Authority: docs/11 §11.13 · docs/12 §12.14 · M9 §37, §38, §39
 *
 * ---------------------------------------------------------------------------
 * SIGNING IN CHANGES WHICH DATA THE APP IS LOOKING AT
 * ---------------------------------------------------------------------------
 *
 * This provider owns one decision and makes it in one place: which account
 * scope the repositories read (M9 §38). A sign-in swaps the bundle, a sign-out
 * swaps it back, and no feature component knows either happened.
 *
 * The security property that buys: **two accounts on one browser cannot see
 * each other's records**, because the second is never handed a bundle pointed
 * at the first's keys (M9 §37).
 *
 * ---------------------------------------------------------------------------
 * WITHOUT A PROVIDER CONFIGURED, EVERYTHING STILL WORKS
 * ---------------------------------------------------------------------------
 *
 * A build with no Supabase configuration reports `signed_out` forever, the auth
 * screens explain that accounts are unavailable, and every local feature —
 * calculators, attendance, the degree, the paper library — behaves exactly as
 * it did before M9. Local-first is not a fallback here; it is the base case
 * (M9 §25, §40).
 */

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { RepositoryProvider } from '../../repositories/context.js';
import { createLocalRepositories } from '../../repositories/local/index.js';
import { createAuthAdapter, type AuthAdapter } from '../../repositories/cloud/supabase.js';
import { scopeFor, type AuthState, type Identity } from '../../domain/auth.js';

export interface AuthContextValue {
  readonly state: AuthState;
  /** Null when this build has no identity provider configured. */
  readonly adapter: AuthAdapter | null;
  readonly signOut: () => Promise<void>;
  /** Forces a re-read of the session, after a redirect or a manual refresh. */
  readonly refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  state: { status: 'signed_out' },
  adapter: null,
  signOut: async () => {
    /* No provider configured: there is nothing to sign out of. */
  },
  refresh: async () => {
    /* Likewise. */
  },
});

export function AuthProvider({
  children,
  /** Injected by tests. Production builds construct one from configuration. */
  adapter: injected,
}: {
  children: ReactNode;
  adapter?: AuthAdapter | null;
}) {
  /*
   * `undefined` means "not injected — build one from configuration"; an
   * explicit `null` means "there is no provider" and must be honoured. `??`
   * conflates the two, which silently gave a configured build a real adapter
   * where the caller had asked for none.
   */
  const adapter = useMemo(
    () => (injected === undefined ? createAuthAdapter() : injected),
    [injected],
  );
  const [state, setState] = useState<AuthState>(
    adapter === null ? { status: 'signed_out' } : { status: 'restoring' },
  );

  const settle = useCallback((identity: Identity | null) => {
    setState(identity === null ? { status: 'signed_out' } : { status: 'signed_in', identity });
  }, []);

  const refresh = useCallback(async () => {
    if (adapter === null) return;
    try {
      settle(await adapter.current());
    } catch {
      /*
       * A session we cannot verify is `expired`, not `signed_out`. The
       * difference matters: one is a thing the student did, the other is a
       * thing that happened to them, and only the second needs explaining
       * (M9 §39, §68).
       */
      setState({ status: 'expired' });
    }
  }, [adapter, settle]);

  useEffect(() => {
    if (adapter === null) return;
    void refresh();
    // Fires on sign-in, sign-out, token refresh AND cross-tab changes, so
    // signing out in one tab does not leave another showing an account's data.
    return adapter.onChange(settle);
  }, [adapter, refresh, settle]);

  const signOut = useCallback(async () => {
    if (adapter !== null) await adapter.signOut();
    /*
     * LOCAL DATA IS NOT TOUCHED (M9 §36). The scope simply changes back to
     * anonymous, and the signed-out student's records stay under their own
     * account scope for when they sign back in.
     */
    setState({ status: 'signed_out' });
  }, [adapter]);

  /*
   * The bundle is rebuilt only when the scope changes, so an ordinary token
   * refresh does not remount every screen reading from storage.
   */
  const scope = scopeFor(state);
  const repositories = useMemo(() => createLocalRepositories(scope), [scope]);

  const value = useMemo(
    () => ({ state, adapter, signOut, refresh }),
    [state, adapter, signOut, refresh],
  );

  return (
    <AuthContext value={value}>
      <RepositoryProvider repositories={repositories}>{children}</RepositoryProvider>
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  return use(AuthContext);
}

/** The signed-in student, or null. The shorthand most screens want. */
export function useIdentity(): Identity | null {
  const { state } = useAuth();
  return state.status === 'signed_in' ? state.identity : null;
}
