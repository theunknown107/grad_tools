/**
 * A signed-in student, for tests that need one and nothing else about auth.
 *
 * Authority: Phase 7B.3.1 §118
 *
 * THE REAL PROVIDER, WITH A FAKE ADAPTER. `AuthProvider` already accepts an
 * injected adapter precisely so a test need not reach a real identity service,
 * so this supplies one rather than mocking the module. The state machine under
 * test is therefore the shipped one, and a change to how the provider derives
 * `signed_in` from an identity would be caught here rather than mocked past.
 *
 * The token is a fixed string. Nothing verifies it: these tests are about what
 * the browser does once it HAS one, and the API's own suite covers what the
 * server does with it.
 */

import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { CURRENT_TERMS } from '@gradtools/shared-types';
import { AuthProvider } from '../../src/features/auth/AuthContext.js';
import type { AuthAdapter } from '../../src/repositories/cloud/supabase.js';
import type { Identity } from '../../src/domain/auth.js';

const IDENTITY: Identity = {
  userId: 'aaaaaaaa-4444-4000-8000-00000000000a',
  email: 'synthetic@example.test',
  provider: 'email',
};

function build(signedIn: boolean): AuthAdapter {
  return {
    current: async () => (signedIn ? IDENTITY : null),
    accessToken: async () => (signedIn ? 'synthetic-token' : null),
    signInWithPassword: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null, needsConfirmation: false }),
    signInWithProvider: async () => ({ error: null }),
    sendRecovery: async () => ({ error: null }),
    updatePassword: async () => ({ error: null }),
    completeDeepLink: async () => ({ error: null }),
    signOut: async () => {
      /* Nothing to sign out of. */
    },
    onChange: () => () => {
      /* No cross-tab events in a test. */
    },
    onPasswordRecovery: () => () => {
      /* No recovery events in a test. */
    },
  };
}

/*
 * STABLE IDENTITIES, ONE PER STATE.
 *
 * `AuthProvider` memoises on the adapter it is given, so handing it a freshly
 * built object on every render invalidates that memo every render — the effects
 * re-run, the callbacks change, and a test that waits for state to settle waits
 * forever. Two constants, built once.
 */
const SIGNED_IN = build(true);
const SIGNED_OUT = build(false);

export function fakeAdapter(signedIn: boolean): AuthAdapter {
  return signedIn ? SIGNED_IN : SIGNED_OUT;
}

export function AuthContextValueProvider({
  signedIn,
  children,
}: {
  readonly signedIn: boolean;
  readonly children: ReactNode;
}) {
  return <AuthProvider adapter={fakeAdapter(signedIn)}>{children}</AuthProvider>;
}

/* -------------------------------------------------------------------------- */
/* Scenario matrix for authenticated onboarding tests                         */
/* -------------------------------------------------------------------------- */

/** The synthetic signed-in identity these fixtures model (matches `IDENTITY`). */
export const SYNTHETIC_IDENTITY = IDENTITY;

/**
 * An adapter whose session never finishes restoring (`current()` never
 * resolves), so `AuthProvider` stays in the `restoring` state. For the
 * "session being restored" scenario. Built fresh but used once per render, so
 * the provider's adapter memo stays stable within a test.
 */
export function restoringAdapter(): AuthAdapter {
  return { ...build(true), current: () => new Promise<Identity>(() => {}) };
}

/**
 * The slice of `GET /api/v1/me` the onboarding gate and pages read. Defaults
 * model a freshly-authenticated user: no terms accepted, no profile, not
 * onboarded. `ok: false` makes `/me` fail (recoverable error path).
 */
export interface MeState {
  readonly termsAccepted?: boolean;
  readonly onboarded?: boolean;
  readonly profile?: Record<string, unknown> | null;
  readonly ok?: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The real `/me` shape, built from a scenario. Terms are version-scoped server-side. */
function meBody(state: MeState) {
  return {
    identity: {
      userId: IDENTITY.userId,
      email: IDENTITY.email,
      provider: 'email',
      supportId: null,
    },
    profile: state.profile ?? null,
    onboarded: state.onboarded ?? false,
    termsCurrentVersion: CURRENT_TERMS.version,
    // The server only returns an acceptance for the CURRENT version, so a bumped
    // version naturally reads back as `null` — which re-gates without a profile reset.
    terms: state.termsAccepted
      ? { version: CURRENT_TERMS.version, acceptedAt: '2026-01-01T00:00:00.000Z' }
      : null,
  };
}

/** Stubs `GET /api/v1/me` for a scenario (defaults to signed-in, nothing accepted). */
export function stubMe(state: MeState = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/v1/me')) {
      return (state.ok ?? true) ? jsonResponse(meBody(state)) : new Response('error', { status: 500 });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Stubs the Terms acceptance flow: `POST …/terms-acceptance` returns `postStatus`,
 * and the follow-up `GET /me` verification returns `meAfter`. Returns a mutable
 * list of calls (`{url, method, body}`) for assertions (POST version, verify read).
 */
export function stubTermsAccept(
  postStatus: number,
  meAfter: MeState,
): { url: string; method: string; body: unknown }[] {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body });
    if (url.includes('terms-acceptance')) {
      return jsonResponse(
        { version: CURRENT_TERMS.version, acceptedAt: new Date().toISOString() },
        postStatus,
      );
    }
    if (url.includes('/api/v1/me')) return jsonResponse(meBody(meAfter));
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}
