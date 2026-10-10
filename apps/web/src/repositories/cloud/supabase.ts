/**
 * The identity provider adapter.
 *
 * Authority: docs/11 §11.13 · docs/25 §25.15 · M9 §5, §7, §8, §20, §21, §61
 *
 * ---------------------------------------------------------------------------
 * THE ONLY FILE THAT IMPORTS THE PROVIDER SDK
 * ---------------------------------------------------------------------------
 *
 * Everything above this line speaks `Identity` and `AuthState` (domain/auth.ts).
 * Everything below is Supabase. Keeping that boundary at one file is what makes
 * "could we change providers" a question with an answer (M9 §61).
 *
 * ---------------------------------------------------------------------------
 * WHAT IS PUBLIC AND WHAT IS SECRET
 * ---------------------------------------------------------------------------
 *
 * This file uses the project URL and the **publishable/anon key**, both of
 * which are meant to be in a browser and are useless without a user's own
 * credentials — every table they can reach is RLS-protected (docs/09 §9.18).
 *
 * The service-role key, the database password and the OAuth client secrets are
 * SECRETS. None of them appears in this file, in any file the browser loads, or
 * in the repository (M9 §21, §22, §44).
 *
 * ---------------------------------------------------------------------------
 * SESSION STORAGE
 * ---------------------------------------------------------------------------
 *
 * The SDK's own browser session mechanism is used, unchanged: tokens in
 * `localStorage` with automatic refresh and cross-tab synchronisation. That is
 * the provider's documented recommendation for a SPA, and the honest reasoning
 * is that the alternatives are worse rather than that this one is perfect:
 *
 *   - An httpOnly cookie would be immune to XSS reading the token, but needs a
 *     same-site server to set it, and GradTools' API is a separate origin.
 *   - Memory-only storage loses the session on every refresh, which for a
 *     student utility means signing in several times a day.
 *
 * So the accepted risk is stated plainly rather than designed around: **XSS in
 * this app can read the access token**, which is why there is no
 * `dangerouslySetInnerHTML` anywhere in the codebase and why every piece of
 * external text is rendered as text (docs/13 §T-47).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Identity } from '../../domain/auth.js';

/**
 * Browser-safe configuration.
 *
 * Absent means this build has no cloud: the app runs local-only, the auth
 * screens say so, and nothing pretends an account is available (M9 §68).
 */
export interface CloudConfig {
  readonly url: string;
  readonly anonKey: string;
}

export function cloudConfig(): CloudConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url === undefined || anonKey === undefined || url === '' || anonKey === '') return null;
  return { url, anonKey };
}

let client: SupabaseClient | null = null;

export function authClient(): SupabaseClient | null {
  const config = cloudConfig();
  if (config === null) return null;
  client ??= createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The session arrives in the URL fragment after an OAuth redirect and is
      // consumed by the SDK; the fragment is then cleaned from the address bar
      // so a token never survives in history or a shared link (M9 §21).
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return client;
}

/**
 * The provider's user, reduced to what the domain is allowed to know.
 *
 * `sub` becomes `userId` and nothing else is load-bearing. In particular the
 * email is carried for DISPLAY only: an OAuth provider may hand back a private
 * relay address rather than the one the student recognises, and it may differ
 * between providers for the same person (M9 §8, §47).
 */
function toIdentity(user: {
  id: string;
  email?: string | undefined;
  app_metadata?: { provider?: string } | undefined;
}): Identity {
  return {
    userId: user.id,
    email: user.email ?? null,
    provider: user.app_metadata?.provider ?? null,
  };
}

/**
 * Where an auth provider/email link should return to.
 *
 * On the web it is this origin + the route. Inside the Capacitor Android app the
 * WebView origin is `https://localhost`, which a provider cannot redirect back
 * to, so native builds use a custom-scheme deep link that an intent-filter routes
 * to the app; `completeDeepLink` then exchanges the code for a session. The
 * native callback URL must be in the Supabase redirect allow-list.
 */
const NATIVE_AUTH_CALLBACK = 'gradtools://auth/callback';

function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

function authRedirect(webPath: string): string {
  return isNativeApp() ? NATIVE_AUTH_CALLBACK : `${window.location.origin}${webPath}`;
}

export interface AuthAdapter {
  /** The current identity, or null. Refreshes an expired token if it can. */
  current(): Promise<Identity | null>;
  /** The access token for an API call, or null when not signed in. */
  accessToken(): Promise<string | null>;
  /** `needsCode`: the provider emailed a code that `verifyCode` must complete (new device). */
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<{ error: string | null; needsCode?: boolean }>;
  /**
   * Code-based providers (Clerk) only: completes a sign-up or a new-device
   * sign-in with the code just emailed. Absent → confirmation is a link.
   */
  verifyCode?(code: string): Promise<{ error: string | null }>;
  /**
   * Code-based providers only: completes recovery here with the emailed code
   * and a new password. Absent → recovery is a link to /reset-password.
   */
  resetWithCode?(code: string, password: string): Promise<{ error: string | null }>;
  /** Set when provider sign-in cannot work on this platform: the reason, in words. */
  readonly providerUnavailable?: string;
  signUpWithPassword(
    email: string,
    password: string,
  ): Promise<{ error: string | null; needsConfirmation: boolean }>;
  signInWithProvider(provider: 'google'): Promise<{ error: string | null }>;
  sendRecovery(email: string): Promise<{ error: string | null }>;
  /** Sets a new password for the recovery session the reset link established. */
  updatePassword(password: string): Promise<{ error: string | null }>;
  /**
   * Completes a native deep-link auth callback (`gradtools://auth/callback?code=…`):
   * exchanges the PKCE code for a session. A no-op for URLs without a `code`.
   */
  completeDeepLink(url: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  /** Fires on sign-in, sign-out, token refresh and cross-tab changes. */
  onChange(listener: (identity: Identity | null) => void): () => void;
  /**
   * Fires once the SDK has consumed a password-recovery link and put the client
   * into the short-lived recovery session where `updatePassword` is allowed.
   */
  onPasswordRecovery(listener: () => void): () => void;
}

/**
 * Authentication errors, in words a student can act on.
 *
 * TWO RULES, BOTH LOAD-BEARING:
 *
 * 1. **Never reveal whether an account exists** (M9 §23). "Wrong password" and
 *    "no such account" are the same message, because the difference is exactly
 *    what an attacker enumerating addresses wants to learn.
 * 2. **Never surface provider internals** (M9 §46). No status codes, no
 *    "AuthApiError", no stack traces.
 */
function friendly(message: string): string {
  const lower = message.toLowerCase();
  /*
   * A PROVIDER THAT IS NOT SET UP IS NOT THE STUDENT'S MISTAKE (M9 §22.17).
   *
   * Google is implemented in code and enabled per project in the provider's
   * dashboard. Where a build's project has not enabled it, the
   * SDK answers "Unsupported provider: provider is not enabled" — and telling
   * a student "something went wrong, try again" invites them to try again for
   * ever at a button that cannot work yet. Say what is true instead.
   */
  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return 'That sign-in method is not available for this build yet. Use email and password.';
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return 'That email and password do not match an account.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Check your email and confirm your address before signing in.';
  }
  if (lower.includes('rate') || lower.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (lower.includes('password')) {
    return 'That password is not strong enough. Use at least eight characters.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Could not reach the sign-in service. Check your connection.';
  }
  return 'Something went wrong signing in. Try again.';
}

export function createAuthAdapter(): AuthAdapter | null {
  const supabase = authClient();
  if (supabase === null) return null;

  return {
    async current() {
      const { data } = await supabase.auth.getUser();
      return data.user === null ? null : toIdentity(data.user);
    },

    async accessToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },

    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error === null ? null : friendly(error.message) };
    },

    async signUpWithPassword(email, password) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Web: return to this origin. Native app: the deep-link callback. Either
        // target must be in the project's redirect allow-list (see auth config).
        options: { emailRedirectTo: authRedirect('/account') },
      });
      if (error !== null) return { error: friendly(error.message), needsConfirmation: false };
      /*
       * A signup that returns a user with no session means the project requires
       * email confirmation. Reported as a STATE, not an error — the student did
       * nothing wrong and needs to know to check their inbox.
       */
      return { error: null, needsConfirmation: data.session === null };
    },

    async signInWithProvider(provider) {
      /*
       * A REDIRECT, not a popup. Popups are blocked by default on mobile
       * browsers, which is where most students are, and a blocked popup looks
       * to a student like the button is broken (M9 §49).
       */
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: authRedirect('/account') },
      });
      return { error: error === null ? null : friendly(error.message) };
    },

    async sendRecovery(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // Web: this origin's reset-password screen. Native: the deep-link
        // callback (the PASSWORD_RECOVERY session then drives the reset UI).
        // Either target must be in the project's redirect allow-list.
        redirectTo: authRedirect('/reset-password'),
      });
      /*
       * THE RESULT IS THE SAME WHETHER OR NOT THE ADDRESS IS REGISTERED
       * (M9 §23, §48). Only a transport failure is reported; "no such account"
       * is deliberately indistinguishable from success.
       */
      return {
        error:
          error !== null && /network|fetch/i.test(error.message) ? friendly(error.message) : null,
      };
    },

    async updatePassword(password) {
      /*
       * Only valid inside the recovery session the reset link opened (or any
       * live session). Supabase authenticates the change against that session;
       * the old password is never needed, read, or shown (M9 §23, §48).
       */
      const { error } = await supabase.auth.updateUser({ password });
      return { error: error === null ? null : friendly(error.message) };
    },

    async completeDeepLink(url) {
      // gradtools://auth/callback?code=… — OAuth and PKCE email links both land
      // here on native. No `code` (e.g. a different deep link) → nothing to do.
      try {
        const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
        const code = new URLSearchParams(query).get('code');
        if (code === null) return { error: null };
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        return { error: error === null ? null : friendly(error.message) };
      } catch {
        return { error: 'Could not complete sign-in from that link. Try again.' };
      }
    },

    async signOut() {
      /*
       * Signing out clears the SESSION and nothing else. Local academic data
       * stays exactly where it is, under its own account scope, because it is
       * the student's and they did not ask to delete it (M9 §36).
       */
      await supabase.auth.signOut();
    },

    onChange(listener) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        listener(session?.user === undefined ? null : toIdentity(session.user));
      });
      return () => {
        data.subscription.unsubscribe();
      };
    },

    onPasswordRecovery(listener) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') listener();
      });
      return () => {
        data.subscription.unsubscribe();
      };
    },
  };
}
