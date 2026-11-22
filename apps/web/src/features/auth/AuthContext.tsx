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

const REMEMBERED_ACCOUNT = 'gradtools:v1:last-account';

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

function readRememberedAccount(): string | null {
  if (!isNativeApp()) return null;
  try {
    return window.localStorage.getItem(REMEMBERED_ACCOUNT);
  } catch {
    return null;
  }
}

/** Stores (or, with null, forgets) the verified account; returns what is now remembered. */
function rememberAccount(userId: string | null): string | null {
  if (!isNativeApp()) return null;
  try {
    if (userId === null) window.localStorage.removeItem(REMEMBERED_ACCOUNT);
    else window.localStorage.setItem(REMEMBERED_ACCOUNT, userId);
  } catch {
    /* Storage blocked: the app still works, it just waits for Clerk each launch. */
  }
  return userId;
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
      if (identity !== null) recordDeliberateSignOut(null);
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
    } catch {
      /*
       * A session we cannot verify is `expired`, not `signed_out`. The
       * difference matters: one is a thing the student did, the other is a
       * thing that happened to them, and only the second needs explaining
       * (M9 §39, §68).
       */
      // ...unless the student already signed out: then they are, here.
      setState(signOutPending() ? { status: 'signed_out' } : { status: 'expired' });
    }
  }, [adapter, finishSignOut, settle]);

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
     * fail, and the app stops presenting the account immediately — the
     * remembered account is forgotten by the effect below.
     *
     * LOCAL DATA IS NOT TOUCHED (M9 §36). The scope simply changes back to
     * anonymous, and the signed-out student's records stay under their own
     * account scope for when they sign back in.
     */
    setSignOutPending(true);
    recordDeliberateSignOut(new Date().toISOString());
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
   * THE PHONE'S OWN ACCOUNT, BEFORE (OR WITHOUT) THE NETWORK.
   *
   * On the app, the account Clerk last verified here is remembered — its id
   * only, never a token. While the session is restoring, or when Clerk cannot
   * be reached at all (offline: `expired` after the load timeout), the student
   * keeps reading their own records instead of an empty anonymous scope. It is
   * forgotten the moment Clerk affirmatively says nobody is signed in, or the
   * student signs out. Nothing is uploaded on its strength: sync requires a
   * verified `signed_in` (useSync).
   *
   * Native only. On a shared browser M9 §37 applies as written: an account's
   * records are shown only behind a session verified now.
   */
  const [remembered, setRemembered] = useState(readRememberedAccount);
  useEffect(() => {
    if (state.status === 'signed_in') setRemembered(rememberAccount(state.identity.userId));
    if (state.status === 'signed_out') setRemembered(rememberAccount(null));
  }, [state]);

  /*
   * The bundle is rebuilt only when the scope changes, so an ordinary token
   * refresh does not remount every screen reading from storage.
   */
  const unverified = state.status === 'restoring' || state.status === 'expired';
  const scope = scopeFor(state) ?? (unverified ? remembered : null);
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
