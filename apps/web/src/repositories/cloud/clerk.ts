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

/**
 * Where a native OAuth round-trip returns. The Capacitor WebView origin
 * (`https://localhost`) is not a URL a provider will redirect to, so native
 * Google sign-in returns to this custom-scheme deep link, which an intent-filter
 * routes back to the app (AndroidManifest + AuthContext's `appUrlOpen` handler).
 * It must be in the Clerk dashboard's allowed redirect URLs.
 */
const NATIVE_AUTH_CALLBACK = 'gradtools://auth/callback';

/**
 * A native OAuth round-trip is only honoured if THIS app started one. The deep
 * link `gradtools://auth/callback` is BROWSABLE, so any installed app can fire
 * it; without this guard a hostile app could drive the WebView to `/sso-callback`
 * (an annoyance — it cannot forge a session, Clerk validates the handshake
 * server-side, but it should not be possible at all). A timestamp in
 * `localStorage` is set when we open the provider and consumed on return: it
 * survives the Custom Tab overlay and a cold start, and expires so a stale one
 * cannot be replayed.
 */
const OAUTH_PENDING_KEY = 'gradtools:v1:oauth-pending';
const OAUTH_PENDING_TTL_MS = 10 * 60_000;

function markOauthPending(): void {
  try {
    localStorage.setItem(OAUTH_PENDING_KEY, String(Date.now()));
  } catch {
    /* Storage blocked: the return leg falls back to being accepted, below. */
  }
}

/** True if we started a native OAuth recently. Clears the marker either way. */
function consumeOauthPending(): boolean {
  try {
    const raw = localStorage.getItem(OAUTH_PENDING_KEY);
    localStorage.removeItem(OAUTH_PENDING_KEY);
    if (raw === null) return false;
    const started = Number(raw);
    return Number.isFinite(started) && Date.now() - started < OAUTH_PENDING_TTL_MS;
  } catch {
    // Storage unavailable: don't lock a real user out of finishing sign-in.
    return true;
  }
}

/**
 * The minimum length Clerk requires for a NEW password, mirroring this
 * instance's dashboard policy (`password_settings.min_length`). The app does not
 * set the policy — Clerk enforces it server-side — but the sign-in screen must
 * state the real number so a student is not told "8" and then rejected at "15".
 */
const CLERK_PASSWORD_MIN_LENGTH = 15;

/** Clerk error codes → words a student can act on. Never reveals whether an account exists. */
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
      return `That password is not strong enough. Use at least ${CLERK_PASSWORD_MIN_LENGTH} characters.`;
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

const LOAD_TIMEOUT_MS = 15_000;

/**
 * Resolves once Clerk has loaded. `addListener` emits immediately after load,
 * so the first emission is the signal. A Clerk that never loads (offline,
 * blocked script) rejects, which AuthContext reports as `expired`, never as a
 * silent sign-out.
 */
function whenLoaded(clerk: Clerk): Promise<void> {
  if (clerk.loaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Clerk did not load'));
    }, LOAD_TIMEOUT_MS);
    const off = clerk.addListener(() => {
      clearTimeout(timer);
      queueMicrotask(() => off());
      resolve();
    });
  });
}

export function createClerkAdapter(clerk: Clerk): AuthAdapter {
  /** Which code `verifyCode` completes: a sign-up's address, or a new-device sign-in. */
  let pending: 'sign_up' | 'sign_in' | null = null;

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

  return {
    // Mirrors the Clerk dashboard policy so the sign-in screen states the real
    // minimum for a new password (create / reset), not a guessed one.
    passwordMinLength: CLERK_PASSWORD_MIN_LENGTH,

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
        /*
         * Google refuses OAuth inside an embedded WebView, so the WebView never
         * drives it. Instead we create the OAuth sign-in with the custom-scheme
         * deep link as its return, then open Clerk's provider URL in the SYSTEM
         * browser (a Custom Tab), where Google is happy. Google returns to
         * `gradtools://auth/callback`, the intent-filter wakes the app, and
         * `completeDeepLink` finishes. The deep link must be allow-listed in the
         * Clerk dashboard, or Clerk refuses the redirect.
         */
        return attempt(async () => {
          const signIn = clerk.client!.signIn;
          await signIn.create({
            strategy: `oauth_${provider}`,
            redirectUrl: NATIVE_AUTH_CALLBACK,
            actionCompleteRedirectUrl: NATIVE_AUTH_CALLBACK,
          });
          const external = signIn.firstFactorVerification.externalVerificationRedirectURL;
          if (external === null || external === undefined) {
            return { error: 'Could not start Google sign-in. Try again.' };
          }
          markOauthPending();
          const { Browser } = await import('@capacitor/browser');
          await Browser.open({ url: external.toString() });
          return { error: null };
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
      if (!consumeOauthPending()) return { error: null };
      // Close the Custom Tab the provider was shown in (no-op if already gone).
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close();
      } catch {
        /* No browser to close. */
      }
      /*
       * Hand Clerk's return parameters to its own web callback. Navigating the
       * WebView to `/sso-callback` with the same query/hash lets
       * `AuthenticateWithRedirectCallback` (mounted there) finish the sign-in
       * against `window.location` exactly as it does on the web, then route to
       * /account. A full navigation (not SPA push) is deliberate: it gives Clerk
       * a clean `window.location` to read the handshake from.
       */
      const parsed = new URL(url);
      window.location.assign(`/sso-callback${parsed.search}${parsed.hash}`);
      return { error: null };
    },

    async signOut() {
      /*
       * After account deletion the session is already revoked server-side, so
       * Clerk may refuse to sign it out; local state is cleared either way.
       */
      try {
        await clerk.signOut();
      } catch {
        /* Session already gone. */
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
