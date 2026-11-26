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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from '../../components/ui/feedback.js';
import { RepositoryProvider } from '../../repositories/context.js';
import { createLocalRepositories } from '../../repositories/local/index.js';
import { createAuthAdapter, type AuthAdapter } from '../../repositories/cloud/supabase.js';
import { scopeFor, type AuthState, type Identity } from '../../domain/auth.js';

export interface AuthContextValue {
  readonly state: AuthState;
  /** Null when this build has no identity provider configured. */
  readonly adapter: AuthAdapter | null;
  /**
   * Leaves the account on this device at once, then ends the session on the
   * server. `revoked` is true only when the server confirmed it; false means
   * the device is signed out and the server side is still to do (offline).
   */
  readonly signOut: () => Promise<SignOutResult>;
  /** Forces a re-read of the session, after a redirect or a manual refresh. */
  readonly refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  state: { status: 'signed_out' },
  adapter: null,
  signOut: async () =>
    /* No provider configured: there is nothing to sign out of. */
    ({ revoked: true }),
  refresh: async () => {
    /* Likewise. */
  },
});

export interface SignOutResult {
  readonly revoked: boolean;
}

/*
 * A SIGN-OUT THE SERVER HAS NOT CONFIRMED YET.
 *
 * Offline, Clerk cannot end the session: if clerk-js never loaded, @clerk/react
 * only queues the call; if it had loaded, clerk-js swallows the request's
 * network error and clears only its own memory. Either way the session is still
 * live on Clerk's server, and the next launch with a network restores it —
 * silently undoing the student's sign-out.
 *
 * So the intent is recorded here (a flag, no id, no token). While it stands, a
 * session Clerk restores is NOT accepted as signed in: the app stays signed
 * out and asks Clerk to end it again, every launch, until the server confirms.
 *
 * ONLY THE SERVER LIFTS IT. Pressing a sign-in button proves nothing: the student
 * can cancel, Google can fail, the app can die in the Custom Tab. So every sign-in
 * first finishes the sign-out and stops if that fails; a sign-in needs the network
 * the sign-out was waiting for. The old session is then dead whatever the sign-in
 * does next, and a session that appears afterwards can only be a new one.
 */
const SIGN_OUT_PENDING = 'gradtools:v1:sign-out-pending';

export function signOutPending(): boolean {
  try {
    return window.localStorage.getItem(SIGN_OUT_PENDING) === '1';
  } catch {
    return false;
  }
}

/*
 * WHEN THE STUDENT LAST SIGNED OUT ON PURPOSE — a timestamp, nothing else.
 * Read only by Authentication Diagnostics, so a deliberate sign-out is not
 * reported as a session that was lost. Cleared by the next sign-in.
 */
const SIGNED_OUT_AT = 'gradtools:v1:signed-out-at';

export function deliberateSignOutAt(): string | null {
  try {
    return window.localStorage.getItem(SIGNED_OUT_AT);
  } catch {
    return null;
  }
}

function recordDeliberateSignOut(at: string | null): void {
  try {
    if (at === null) window.localStorage.removeItem(SIGNED_OUT_AT);
    else window.localStorage.setItem(SIGNED_OUT_AT, at);
  } catch {
    /* Diagnostics only: nothing depends on it. */
  }
}

function setSignOutPending(pending: boolean): void {
  try {
    if (pending) window.localStorage.setItem(SIGN_OUT_PENDING, '1');
    else window.localStorage.removeItem(SIGN_OUT_PENDING);
  } catch {
    /* Storage blocked: nothing persists across launches to protect anyway. */
  }
}

/** A provider without a result (not Clerk) ends its session in the call itself. */
async function endSession(adapter: AuthAdapter): Promise<boolean> {
  try {
    return (await adapter.signOut())?.revoked ?? true;
  } catch {
    return false;
  }
}

function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

/*
 * THE LAST VERIFIED ACCOUNT, for offline use only.
 *
 * Written when the service confirms a session; removed when the service says
 * signed out, refuses the session, or the student signs out. It holds the
 * identity Clerk already showed this device — id, email, provider — never a
 * token, and it unlocks nothing on the server. It only decides whose ON-DEVICE
 * records an offline student sees, and only for a week after the last
 * verification, roughly a Clerk session's life. (A bare id stored by the
 * release-candidate build does not parse here and is treated as absent until
 * the next verified session rewrites it.)
 *
 * Native only. On a shared browser M9 §37 applies as written: an account's
 * records are shown only behind a session verified now, so a web page never
 * remembers an account.
 */
const LAST_ACCOUNT_KEY = 'gradtools:v1:last-account';
const LAST_ACCOUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function rememberAccount(identity: Identity): void {
  if (!isNativeApp()) return;
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
  if (!isNativeApp()) return null;
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

/**
 * A failure to reach the sign-in service, as opposed to a session it refused:
 * the adapter's own AuthServiceUnreachable, a fetch that never got an answer,
 * or the device reporting itself offline.
 */
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

  /* One attempt at a time: a late second one could end the session that came after. */
  const finishing = useRef<Promise<boolean> | null>(null);
  const finishSignOut = useCallback((): Promise<boolean> => {
    finishing.current ??= (adapter === null ? Promise.resolve(true) : endSession(adapter)).then(
      (revoked) => {
        finishing.current = null;
        if (revoked) setSignOutPending(false);
        return revoked;
      },
    );
    return finishing.current;
  }, [adapter]);

  const settle = useCallback(
    (identity: Identity | null) => {
      if (identity !== null && signOutPending()) {
        // A restored session the student already signed out of: refuse it,
        // and try again to end it on the server.
        setState({ status: 'signed_out' });
        void finishSignOut();
        return;
      }
      if (identity === null) forgetAccount();
      else {
        recordDeliberateSignOut(null);
        rememberAccount(identity);
      }
      setState(identity === null ? { status: 'signed_out' } : { status: 'signed_in', identity });
    },
    [finishSignOut],
  );

  const refresh = useCallback(async () => {
    if (adapter === null) return;
    try {
      const identity = await adapter.current();
      /*
       * No session HERE is not the server's word: offline, clerk-js clears only
       * its memory and emits "signed out". Only the server's answer lifts it.
       */
      if (identity === null && signOutPending()) await finishSignOut();
      settle(identity);
    } catch (error) {
      /* The student already signed out: then they are, here, whatever the network says. */
      if (signOutPending()) {
        setState({ status: 'signed_out' });
        return;
      }
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
  }, [adapter, finishSignOut, settle]);

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
        void adapter.completeDeepLink(url).then(({ error, handled }) => {
          if (error !== null) toast(error, { tone: 'warning' });
          /* Any app or page can fire this link: only our own sign-in re-reads. */
          if (handled !== true) return;
          return refresh();
        });
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

  const signOut = useCallback(async (): Promise<SignOutResult> => {
    /*
     * THIS DEVICE FIRST, AT ONCE. The intent is recorded before anything can
     * fail, and the app stops presenting the account immediately, and the
     * remembered account is forgotten.
     *
     * LOCAL DATA IS NOT TOUCHED (M9 §36). The scope simply changes back to
     * anonymous, and the signed-out student's records stay under their own
     * account scope for when they sign back in.
     */
    setSignOutPending(true);
    recordDeliberateSignOut(new Date().toISOString());
    forgetAccount();
    setState({ status: 'signed_out' });
    // Then the server, which only it can confirm.
    return { revoked: await finishSignOut() };
  }, [finishSignOut]);

  /* The adapter screens use: no sign-in starts over an unfinished sign-out. */
  const exposed = useMemo((): AuthAdapter | null => {
    if (adapter === null) return null;
    const afterSignOut =
      <A extends unknown[], R extends { error: string | null }>(
        call: (...args: A) => Promise<R>,
      ) =>
      async (...args: A): Promise<R> => {
        if (signOutPending() && !(await finishSignOut())) {
          return { error: 'Could not reach the sign-in service. Check your connection.' } as R;
        }
        return call(...args);
      };
    return {
      ...adapter,
      signInWithPassword: afterSignOut(adapter.signInWithPassword.bind(adapter)),
      signUpWithPassword: afterSignOut(adapter.signUpWithPassword.bind(adapter)),
      signInWithProvider: afterSignOut(adapter.signInWithProvider.bind(adapter)),
      signUpWithProvider: afterSignOut(adapter.signUpWithProvider.bind(adapter)),
    };
  }, [adapter, finishSignOut]);

  /*
   * THE PHONE'S OWN ACCOUNT WHILE THE SESSION RESTORES.
   *
   * On the app, the account Clerk last verified here (lastAccount, above) is
   * read while Clerk loads, so the student sees their own records instead of an
   * empty anonymous scope that is about to be replaced. Unreachable after that
   * is the `offline` state. Nothing is uploaded on its strength: sync requires
   * a verified `signed_in` (useSync).
   *
   * Native only. On a shared browser M9 §37 applies as written: an account's
   * records are shown only behind a session verified now (or `offline`).
   */
  const [remembered] = useState(() => lastAccount()?.userId ?? null);

  /*
   * The bundle is rebuilt only when the scope changes, so an ordinary token
   * refresh does not remount every screen reading from storage.
   */
  const scope = scopeFor(state) ?? (state.status === 'restoring' ? remembered : null);
  const repositories = useMemo(() => createLocalRepositories(scope), [scope]);
  /* Restoring with nothing remembered reads as loading — never as an empty
     anonymous account that is about to be replaced. */
  const ready = state.status !== 'restoring' || scope !== null;

  const value = useMemo(
    () => ({ state, adapter: exposed, signOut, refresh }),
    [state, exposed, signOut, refresh],
  );

  return (
    <AuthContext value={value}>
      <RepositoryProvider repositories={repositories} ready={ready}>
        {children}
      </RepositoryProvider>
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
