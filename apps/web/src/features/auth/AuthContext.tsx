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

/**
 * A failure to reach the sign-in service, as opposed to a session it refused:
 * the adapter's own AuthServiceUnreachable, a fetch that never got an answer,
 * or the device reporting itself offline.
 */

/*
 * THE LAST VERIFIED ACCOUNT, for offline use only.
 *
 * Written when the service confirms a session; removed when the service says
 * signed out, refuses the session, or the student signs out. It holds the
 * identity Clerk already showed this device — id, email, provider — never a
 * token, and it unlocks nothing on the server. It only decides whose ON-DEVICE
 * records an offline student sees, and only for a week after the last
 * verification, roughly a Clerk session's life.
 */
const LAST_ACCOUNT_KEY = 'gradtools:v1:last-account';
const LAST_ACCOUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function rememberAccount(identity: Identity): void {
  try {
    window.localStorage.setItem(
      LAST_ACCOUNT_KEY,
      JSON.stringify({ identity, verifiedAt: Date.now() }),
    );
  } catch {
    /* Without storage there is no offline account view; nothing else changes. */
  }
}

function forgetAccount(): void {
  try {
    window.localStorage.removeItem(LAST_ACCOUNT_KEY);
  } catch {
    /* Nothing stored, nothing to forget. */
  }
}

export function lastAccount(now: number = Date.now()): Identity | null {
  try {
    const raw = window.localStorage.getItem(LAST_ACCOUNT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { identity?: Partial<Identity>; verifiedAt?: unknown };
    const identity = parsed.identity;
    if (
      typeof parsed.verifiedAt !== 'number' ||
      now - parsed.verifiedAt > LAST_ACCOUNT_MAX_AGE_MS ||
      typeof identity?.userId !== 'string' ||
      identity.userId.length === 0
    ) {
      return null;
    }
    return identity as Identity;
  } catch {
    return null;
  }
}

function isUnreachable(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error instanceof Error && error.name === 'AuthServiceUnreachable') return true;
  return error instanceof TypeError && /fetch|network|load/i.test(error.message);
}

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
    if (identity === null) forgetAccount();
    else rememberAccount(identity);
    setState(identity === null ? { status: 'signed_out' } : { status: 'signed_in', identity });
  }, []);

  const refresh = useCallback(async () => {
    if (adapter === null) return;
    try {
      settle(await adapter.current());
    } catch (error) {
      /*
       * Could not reach the sign-in service: the session is UNKNOWN, so say
       * that (`unreachable`) rather than claim it expired. Nothing is cleared.
       */
      if (isUnreachable(error)) {
        const known = lastAccount();
        setState(
          known === null ? { status: 'unreachable' } : { status: 'offline', identity: known },
        );
        return;
      }
      /*
       * A session we cannot verify is `expired`, not `signed_out`. The
       * difference matters: one is a thing the student did, the other is a
       * thing that happened to them, and only the second needs explaining
       * (M9 §39, §68). The service refused it, so this device stops treating
       * the account as known.
       */
      forgetAccount();
      setState({ status: 'expired' });
    }
  }, [adapter, settle]);

  /*
   * Back online after an unreachable check: try once more, on the device's own
   * signal. No timer, no loop — a student who stays offline is not polled.
   */
  useEffect(() => {
    if (adapter === null || (state.status !== 'unreachable' && state.status !== 'offline')) return;
    const onOnline = (): void => void refresh();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [adapter, refresh, state.status]);

  useEffect(() => {
    if (adapter === null) return;
    void refresh();
    // Fires on sign-in, sign-out, token refresh AND cross-tab changes, so
    // signing out in one tab does not leave another showing an account's data.
    return adapter.onChange(settle);
  }, [adapter, refresh, settle]);

  /*
   * NATIVE AUTH CALLBACK (Android app only).
   *
   * In the Capacitor WebView a provider/email link cannot return to the page's
   * `https://localhost` origin, so those flows redirect to the custom-scheme
   * deep link `gradtools://auth/callback`, which an intent-filter routes here.
   * `@capacitor/app` is imported lazily and only on native, so the web bundle
   * and web behaviour are untouched. Handles both cold start (getLaunchUrl) and
   * an already-running app (appUrlOpen); exchanges the code, then refreshes.
   */
  useEffect(() => {
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (adapter === null || typeof cap?.isNativePlatform !== 'function' || !cap.isNativePlatform())
      return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { App } = await import('@capacitor/app');
      const complete = (url: string): void => {
        void adapter.completeDeepLink(url).then(() => refresh());
      };
      const launch = await App.getLaunchUrl();
      if (!cancelled && launch?.url !== undefined) complete(launch.url);
      const sub = await App.addListener('appUrlOpen', (event) => complete(event.url));
      if (cancelled) void sub.remove();
      else remove = () => void sub.remove();
    })();
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [adapter, refresh]);

  const signOut = useCallback(async () => {
    if (adapter !== null) await adapter.signOut();
    forgetAccount();
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
