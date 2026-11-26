/**
 * The Clerk identity adapter (CLERK-AUTH-MIGRATION-V1).
 *
 * Same `AuthAdapter` contract as the legacy Supabase adapter, so nothing above
 * AuthContext knows which provider is live. Clerk confirms an address and
 * recovers a password with an EMAILED CODE entered here, not a link, so this
 * adapter implements `verifyCode` and `resetWithCode`.
 *
 * Only the PUBLISHABLE key (`VITE_CLERK_PUBLISHABLE_KEY`) reaches the browser.
 * The secret key lives on the API alone; deleting a Clerk user happens there.
 *
 * The session token Clerk issues is sent to the API as a bearer token, where
 * `clerkMiddleware()` verifies it. Nothing in the browser decodes it.
 */

import type { useClerk } from '@clerk/react';
import { isClerkAPIResponseError } from '@clerk/react/errors';
import type { Identity } from '../../domain/auth.js';
import { toast } from '../../components/ui/feedback.js';
import type { AuthAdapter } from './supabase.js';

type Clerk = ReturnType<typeof useClerk>;

export function clerkPublishableKey(): string | null {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  return key === undefined || key === '' ? null : key;
}

function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

/** Android's deep link. Clerk's server refuses it as an OAuth return address. */
export const NATIVE_AUTH_CALLBACK = 'gradtools://auth/callback';

/**
 * Where the Custom Tab lands after Google: an https page (NativeReturnPage)
 * that opens the deep link, so the app comes back and finishes. Until that page
 * is deployed, the student closes the tab and the app's watch finishes instead.
 */
const NATIVE_RETURN_PAGE = 'https://grad-tools.vercel.app/native-return';
const NATIVE_OAUTH_POLL_MS = 2_000;

/**
 * Deep-link defense. `gradtools://auth/callback` is a BROWSABLE deep link any
 * installed app can fire, so a callback is honoured ONLY if THIS app recently
 * started a native OAuth — a single-use, expiring `localStorage` marker, checked
 * and cleared on return (`completeDeepLink`). It records which flow started, so
 * the return reads the right Clerk resource. It never forges a session (Clerk
 * verifies the provider server-side), and it fails CLOSED.
 */
const OAUTH_PENDING_KEY = 'gradtools:v1:oauth-pending';
const OAUTH_PENDING_TTL_MS = 10 * 60_000;

type OauthFlow = 'sign_in' | 'sign_up';

/** Throws when storage is blocked: an unmarked return would be refused anyway. */
function markOauthPending(flow: OauthFlow): void {
  localStorage.setItem(OAUTH_PENDING_KEY, `${flow}:${String(Date.now())}`);
}

/** The flow a recent native OAuth started, or null. Clears the marker, and
 *  rejects (fails closed) when storage is unavailable. */
function consumeOauthPending(): OauthFlow | null {
  try {
    const raw = localStorage.getItem(OAUTH_PENDING_KEY);
    localStorage.removeItem(OAUTH_PENDING_KEY);
    const [flow, startedAt] = (raw ?? '').split(':');
    if (flow !== 'sign_in' && flow !== 'sign_up') return null;
    const started = Number(startedAt);
    return Number.isFinite(started) && Date.now() - started < OAUTH_PENDING_TTL_MS ? flow : null;
  } catch {
    return null;
  }
}

/**
 * Clerk error codes → words a student can act on. Sign-IN never reveals whether
 * an account exists — a wrong password and an unknown email give the same line;
 * sign-UP necessarily does, since Clerk rejects a duplicate address.
 */
export function friendlyClerkError(error: unknown): string {
  if (!isClerkAPIResponseError(error)) {
    return error instanceof TypeError
      ? 'Could not reach the sign-in service. Check your connection.'
      : 'Something went wrong signing in. Try again.';
  }
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  const code = error.errors[0]?.code ?? '';
  switch (code) {
    case 'form_password_incorrect':
    case 'form_identifier_not_found':
    case 'strategy_for_user_invalid':
      return 'That email and password do not match an account.';
    case 'form_identifier_exists':
      return 'Could not create an account with that email. If you already have one, sign in or recover it.';
    case 'form_password_pwned':
      return 'That password has appeared in a data breach. Choose a different one.';
    case 'form_password_length_too_short':
    case 'form_password_not_strong_enough':
    case 'form_password_validation_failed':
      // The provider rejected the password against ITS OWN policy. The app
      // imposes no length rule, so it does not state a number it does not own —
      // it reports the rejection and lets the student choose a stronger one.
      return 'That password was not accepted. Choose a longer or stronger one.';
    case 'form_code_incorrect':
    case 'verification_failed':
      return 'That code is not right. Check the latest email and try again.';
    case 'verification_expired':
      return 'That code has expired. Start again to get a new one.';
    case 'form_param_format_invalid':
      return 'Check the email address and try again.';
    default:
      return 'Something went wrong signing in. Try again.';
  }
}

function toIdentity(clerk: Clerk): Identity | null {
  const user = clerk.user;
  if (user === null || user === undefined) return null;
  const google = user.externalAccounts.some((account) => account.provider === 'google');
  return {
    userId: user.id,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    provider: google ? 'google' : 'email',
  };
}

const LOAD_TIMEOUT_MS = 10_000;
const STATUS_POLL_MS = 250;

/**
 * Clerk could not be loaded: its script or API was unreachable. AuthContext
 * reports this as `unreachable` — never `expired`, never a sign-out — because
 * a network failure says nothing about whether the stored session is valid.
 */
export class AuthServiceUnreachable extends Error {
  constructor() {
    super('The sign-in service could not be reached');
    this.name = 'AuthServiceUnreachable';
  }
}

/*
 * CLERK'S SCRIPT FAILED TO ARRIVE — KNOWN THE MOMENT IT HAPPENS.
 *
 * @clerk/react loads clerk-js from Clerk's CDN and, if that request fails,
 * swallows the script's error and waits out its own fixed 15 s timer before
 * reporting anything. Offline the request fails at once, so the student sat
 * through 15 s of nothing and then had the "not verified" notice shove the
 * screen down. The browser's own `error` event on that <script> is the honest
 * early signal; a reachable-but-slow network still gets the full wait. On an
 * Android WebView `navigator.onLine` stays true offline, so it is not enough.
 */
let scriptFailed = false;
const scriptFailureListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement && target.src.includes('/clerk-js@')) {
        scriptFailed = true;
        for (const listener of scriptFailureListeners) listener();
      }
    },
    true, // a resource error does not bubble; only a capturing listener sees it
  );
}

/**
 * Resolves once Clerk has loaded. `addListener` emits immediately after load,
 * so the first emission is the signal. A Clerk that reports a load error
 * (offline, blocked script) rejects at once instead of waiting out the
 * timeout; one that never answers rejects after LOAD_TIMEOUT_MS. Both reject
 * with AuthServiceUnreachable.
 */
function whenLoaded(clerk: Clerk): Promise<void> {
  if (clerk.loaded) return Promise.resolve();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (scriptFailed || offline) return Promise.reject(new AuthServiceUnreachable());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      scriptFailureListeners.delete(failed);
      queueMicrotask(() => off());
      if (error === undefined) resolve();
      else reject(error);
    };
    const failed = (): void => finish(new AuthServiceUnreachable());
    const timer = setTimeout(failed, LOAD_TIMEOUT_MS);
    const poll = setInterval(() => {
      if ((clerk as { status?: string }).status === 'error') failed();
    }, STATUS_POLL_MS);
    scriptFailureListeners.add(failed);
    const off = clerk.addListener(() => finish());
  });
}

export function createClerkAdapter(clerk: Clerk): AuthAdapter {
  /** Which code `verifyCode` completes: a sign-up's address, or a new-device sign-in. */
  let pending: 'sign_up' | 'sign_in' | null = null;
  /** Ends the native OAuth watch in progress. One at a time: a second tap replaces it. */
  let endWatch: (() => void) | null = null;

  const activate = async (sessionId: string | null): Promise<{ error: string | null }> => {
    if (sessionId === null) return { error: 'Something went wrong signing in. Try again.' };
    await clerk.setActive({ session: sessionId });
    pending = null;
    return { error: null };
  };

  const attempt = async (work: () => Promise<{ error: string | null }>) => {
    try {
      await whenLoaded(clerk);
      return await work();
    } catch (error) {
      return { error: friendlyClerkError(error) };
    }
  };

  /*
   * NATIVE GOOGLE, OUT.
   *
   * Google refuses OAuth inside a WebView, so the WebView only CREATES the
   * attempt and the provider page opens in the system browser (a Custom Tab).
   * Clerk's server refuses a custom-scheme return during a real login
   * (`invalid_url_scheme`, seen on a device), so the tab returns to an https page
   * and the app watches the attempt instead of waiting for a deep link.
   */
  const openProvider = async (url: URL | null | undefined, flow: OauthFlow) => {
    if (url === null || url === undefined) {
      return { error: 'Could not start Google sign-in. Try again.' };
    }
    const { Browser } = await import('@capacitor/browser');
    await watchNativeOAuth(flow);
    await Browser.open({ url: url.toString() });
    return { error: null };
  };

  /*
   * NATIVE GOOGLE, BACK.
   *
   * Reads the attempt this WebView's client owns. Null means it is still going.
   * A Google account with no GradTools account arrives on sign-in as
   * `transferable` (and the reverse on sign-up); Clerk's own transfer finishes it.
   */
  const settleNativeOAuth = async (flow: OauthFlow) => {
    const client = clerk.client!;
    const result =
      flow === 'sign_in'
        ? await (async () => {
            const signIn = await client.signIn.reload();
            return signIn.firstFactorVerification.status === 'transferable'
              ? client.signUp.create({ transfer: true })
              : signIn;
          })()
        : await (async () => {
            const signUp = await client.signUp.reload();
            return signUp.verifications.externalAccount.status === 'transferable'
              ? client.signIn.create({ transfer: true })
              : signUp;
          })();
    return result.status === 'complete' ? activate(result.createdSessionId) : null;
  };

  /*
   * Checks when a page loads in the tab, every two seconds, and once more when
   * the tab closes. A tab closed with nothing finished is a cancel, not an error.
   *
   * ponytail: if Android kills the app while the tab is open the watch dies with
   * it and the student signs in again. Upgrade path: resume from the marker.
   */
  const watchNativeOAuth = async (flow: OauthFlow): Promise<void> => {
    const { Browser } = await import('@capacitor/browser');
    endWatch?.();
    /* The marker is this watch's only from here: an older one must not clear it. */
    markOauthPending(flow);
    let checking = false;
    let closed = false;
    let done = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const end = (): void => {
      done = true;
      clearInterval(timer);
      clearTimeout(expiry);
      for (const handle of handles) void handle.remove();
      endWatch = null;
    };
    const stop = (): void => {
      end();
      consumeOauthPending();
    };
    endWatch = end;
    const check = async (): Promise<void> => {
      if (checking || done) return;
      checking = true;
      const wasClosed = closed;
      try {
        await whenLoaded(clerk);
        const settled = await settleNativeOAuth(flow);
        if (done) return;
        if (settled !== null) {
          stop();
          if (settled.error !== null) toast(settled.error, { tone: 'warning' });
          await Browser.close().catch(() => undefined);
        } else if (wasClosed) stop();
      } catch (error) {
        if (wasClosed) {
          stop();
          toast(friendlyClerkError(error), { tone: 'warning' });
        }
      } finally {
        checking = false;
      }
      if (closed && !wasClosed && !done) await check();
    };
    const timer = setInterval(() => void check(), NATIVE_OAUTH_POLL_MS);
    const expiry = setTimeout(stop, OAUTH_PENDING_TTL_MS);
    handles.push(
      await Browser.addListener('browserPageLoaded', () => void check()),
      await Browser.addListener('browserFinished', () => {
        closed = true;
        void check();
      }),
    );
  };

  return {
    async current() {
      await whenLoaded(clerk);
      return toIdentity(clerk);
    },

    async accessToken() {
      await whenLoaded(clerk);
      return (await clerk.session?.getToken()) ?? null;
    },

    async signInWithPassword(email, password) {
      let needsCode = false;
      const result = await attempt(async () => {
        const signIn = await clerk.client!.signIn.create({ identifier: email, password });
        if (signIn.status === 'complete') return activate(signIn.createdSessionId);
        /*
         * `needs_client_trust`: Clerk's new-device check. `needs_second_factor`:
         * an email-code second factor. Both are finished with an emailed code.
         */
        if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
          const factor = signIn.supportedSecondFactors?.find((f) => f.strategy === 'email_code');
          if (factor === undefined)
            return { error: 'This account needs a sign-in step GradTools does not support yet.' };
          await signIn.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: factor.emailAddressId,
          });
          pending = 'sign_in';
          needsCode = true;
          return { error: null };
        }
        return { error: 'Something went wrong signing in. Try again.' };
      });
      return { ...result, needsCode };
    },

    async signUpWithPassword(email, password) {
      let needsConfirmation = false;
      const result = await attempt(async () => {
        const signUp = await clerk.client!.signUp.create({ emailAddress: email, password });
        if (signUp.status === 'complete') return activate(signUp.createdSessionId);
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        pending = 'sign_up';
        needsConfirmation = true;
        return { error: null };
      });
      return { ...result, needsConfirmation };
    },

    async verifyCode(code) {
      return attempt(async () => {
        if (pending === 'sign_up') {
          const signUp = await clerk.client!.signUp.attemptEmailAddressVerification({ code });
          return signUp.status === 'complete'
            ? activate(signUp.createdSessionId)
            : { error: 'Something went wrong creating your account. Try again.' };
        }
        if (pending === 'sign_in') {
          const signIn = await clerk.client!.signIn.attemptSecondFactor({
            strategy: 'email_code',
            code,
          });
          return signIn.status === 'complete'
            ? activate(signIn.createdSessionId)
            : { error: 'Something went wrong signing in. Try again.' };
        }
        return { error: 'That code has expired. Start again to get a new one.' };
      });
    },

    async signInWithProvider(provider) {
      if (isNativeApp()) {
        return attempt(async () => {
          const signIn = await clerk.client!.signIn.create({
            strategy: `oauth_${provider}`,
            redirectUrl: NATIVE_RETURN_PAGE,
            actionCompleteRedirectUrl: NATIVE_RETURN_PAGE,
          });
          return openProvider(
            signIn.firstFactorVerification.externalVerificationRedirectURL,
            'sign_in',
          );
        });
      }
      return attempt(async () => {
        // A redirect, not a popup: mobile browsers block popups by default.
        await clerk.client!.signIn.authenticateWithRedirect({
          strategy: `oauth_${provider}`,
          redirectUrl: `${window.location.origin}/sso-callback`,
          redirectUrlComplete: `${window.location.origin}/account`,
        });
        return { error: null };
      });
    },

    async signUpWithProvider(provider) {
      if (isNativeApp()) {
        return attempt(async () => {
          const signUp = await clerk.client!.signUp.create({
            strategy: `oauth_${provider}`,
            redirectUrl: NATIVE_RETURN_PAGE,
            actionCompleteRedirectUrl: NATIVE_RETURN_PAGE,
          });
          return openProvider(
            signUp.verifications.externalAccount.externalVerificationRedirectURL,
            'sign_up',
          );
        });
      }
      return attempt(async () => {
        /*
         * The SIGN-UP object, not sign-in. Both run the same Google OAuth and
         * clerk-js transfers between them (a returning user is signed in, a new
         * one is created), so this cannot force "new accounts only"; it is the
         * sign-up ENTRY POINT. The same `/sso-callback` finishes it — Clerk's
         * `handleRedirectCallback` there completes a sign-up or a sign-in alike.
         */
        await clerk.client!.signUp.authenticateWithRedirect({
          strategy: `oauth_${provider}`,
          redirectUrl: `${window.location.origin}/sso-callback`,
          redirectUrlComplete: `${window.location.origin}/account`,
        });
        return { error: null };
      });
    },

    async sendRecovery(email) {
      try {
        await whenLoaded(clerk);
        await clerk.client!.signIn.create({
          strategy: 'reset_password_email_code',
          identifier: email,
        });
      } catch (error) {
        /*
         * SAME RESULT WHETHER OR NOT THE ADDRESS IS REGISTERED: an unknown
         * address is indistinguishable from success. Only a transport failure,
         * or a rate limit, is reported.
         */
        if (!isClerkAPIResponseError(error) || error.status === 429)
          return { error: friendlyClerkError(error) };
      }
      return { error: null };
    },

    async resetWithCode(code, password) {
      return attempt(async () => {
        const signIn = await clerk.client!.signIn.attemptFirstFactor({
          strategy: 'reset_password_email_code',
          code,
          password,
        });
        return signIn.status === 'complete'
          ? activate(signIn.createdSessionId)
          : { error: 'Something went wrong resetting your password. Try again.' };
      });
    },

    async updatePassword() {
      // Clerk resets inside the sign-in screen (`resetWithCode`); there is no link session.
      return { error: 'Request a reset code from the sign-in screen.' };
    },

    async completeDeepLink(url) {
      // Only our own OAuth return; ignore any other deep link.
      if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return { error: null };
      // Only honour a callback for a sign-in THIS app started: a BROWSABLE deep
      // link fired by any other app must not drive the WebView to /sso-callback.
      const flow = consumeOauthPending();
      if (flow === null) return { error: null };
      // Close the Custom Tab the provider was shown in (no-op if already gone).
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close();
      } catch {
        /* No browser to close. */
      }
      const settled = await attempt(
        async () =>
          (await settleNativeOAuth(flow)) ?? {
            error: 'Google sign-in did not finish. Try again, or use your email and password.',
          },
      );
      return { ...settled, handled: true };
    },

    async signOut() {
      /*
       * Never loaded (offline cold start): @clerk/react would only QUEUE the
       * call and resolve, and the queue dies with the page. Nothing was ended.
       */
      if (!clerk.loaded) return { revoked: false };
      /*
       * After account deletion the session is already revoked server-side, so
       * Clerk may refuse to sign it out; local state is cleared either way.
       */
      try {
        await clerk.signOut();
      } catch {
        /* Session already gone. */
      }
      /*
       * clerk-js swallows a `network_error` from its DELETE and clears only
       * its own memory, so a resolved signOut() is no proof. Ask the server:
       * revoked only when the reloaded client holds no signed-in session.
       */
      try {
        const client = await clerk.client?.reload();
        return { revoked: client !== undefined && client.signedInSessions.length === 0 };
      } catch {
        return { revoked: false };
      }
    },

    onChange(listener) {
      let last: string | null | undefined;
      return clerk.addListener(() => {
        const identity = toIdentity(clerk);
        const key = identity?.userId ?? null;
        if (key === last) return;
        last = key;
        listener(identity);
      });
    },

    onPasswordRecovery() {
      return () => undefined;
    },
  };
}
