/**
 * Starting offline (device test 2026-11-05, defect 6): a sign-in service that
 * cannot be reached is `unreachable` — not `expired`, not signed out — fails
 * fast, and says so with a retry.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/features/auth/AuthContext.js';
import { AuthUnreachable } from '../src/features/auth/AuthUnreachable.js';
import { AuthServiceUnreachable, createClerkAdapter } from '../src/repositories/cloud/clerk.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function adapterFailingWith(error: unknown): AuthAdapter {
  const noop = () => () => undefined;
  return {
    current: async () => {
      throw error;
    },
    accessToken: async () => null,
    signInWithPassword: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null, needsConfirmation: false }),
    signInWithProvider: async () => ({ error: null }),
    sendRecovery: async () => ({ error: null }),
    updatePassword: async () => ({ error: null }),
    completeDeepLink: async () => ({ error: null }),
    signOut: async () => undefined,
    onChange: noop,
    onPasswordRecovery: noop,
  };
}

function Status() {
  const { state } = useAuth();
  return <p data-testid="status">{state.status}</p>;
}

const UNREACHABLE = adapterFailingWith(new AuthServiceUnreachable());
const REFUSED = adapterFailingWith(new Error('session revoked'));

describe('a session check that cannot reach the service', () => {
  it('is unreachable, never expired, and offers a retry', async () => {
    render(
      <AuthProvider adapter={UNREACHABLE}>
        <Status />
        <AuthUnreachable />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unreachable'));
    expect(screen.getByText('Can’t reach GradTools sign-in.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(/expired/i)).toBeNull();
  });

  it('is still expired when the service answered and refused the session', async () => {
    render(
      <AuthProvider adapter={REFUSED}>
        <Status />
        <AuthUnreachable />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('expired'));
    expect(screen.queryByText('Can’t reach GradTools sign-in.')).toBeNull();
  });
});

describe('waiting for Clerk to load', () => {
  const clerk = (status: string) => ({
    loaded: false,
    status,
    client: {},
    user: null,
    session: null,
    addListener: vi.fn(() => () => undefined),
  });

  it('gives up at once when Clerk reports a load error', async () => {
    vi.useFakeTimers();
    const adapter = createClerkAdapter(clerk('error') as never);
    const result = adapter.current().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toBeInstanceOf(AuthServiceUnreachable);
  });

  it('gives up after a bounded wait when Clerk never answers', async () => {
    vi.useFakeTimers();
    const adapter = createClerkAdapter(clerk('loading') as never);
    let settled: unknown = 'pending';
    void adapter.current().catch((error: unknown) => {
      settled = error;
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBeInstanceOf(AuthServiceUnreachable);
  });
});

/* -------------------------------------------------------------------------- */
/* Signed in, then offline (offline account view)                              */
/* -------------------------------------------------------------------------- */

import { lastAccount } from '../src/features/auth/AuthContext.js';
import { scopeFor, type AuthState, type Identity } from '../src/domain/auth.js';

const ALICE: Identity = {
  userId: 'aaaaaaaa-1111-4000-8000-00000000000a',
  email: 'alice@example.test',
  provider: 'email',
};
const BOB: Identity = {
  userId: 'bbbbbbbb-2222-4000-8000-00000000000b',
  email: 'bob@example.test',
  provider: 'email',
};
const KEY = 'gradtools:v1:last-account';

function signedInAs(identity: Identity): AuthAdapter {
  return { ...adapterFailingWith(null), current: async () => identity };
}
const AS_BOB = signedInAs(BOB);
const SIGNED_OUT = { ...adapterFailingWith(null), current: async () => null } as AuthAdapter;

function Scope() {
  const { state } = useAuth();
  return (
    <p data-testid="scope">
      {state.status}:{scopeFor(state) ?? 'anon'}
    </p>
  );
}

describe('a signed-in student who goes offline', () => {
  afterEach(() => window.localStorage.removeItem(KEY));

  it('keeps their own account scope, never the guest one, and says they are offline', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ identity: ALICE, verifiedAt: Date.now() }));
    render(
      <AuthProvider adapter={UNREACHABLE}>
        <Scope />
        <AuthUnreachable />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('scope').textContent).toBe(`offline:${ALICE.userId}`),
    );
    expect(screen.getByText('You’re offline.')).toBeTruthy();
    expect(screen.getByText(/alice@example\.test/)).toBeTruthy();
  });

  it('falls back to the guest scope when no account was verified on this device', async () => {
    render(
      <AuthProvider adapter={UNREACHABLE}>
        <Scope />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('unreachable:anon'));
  });

  it('does not honour an account last verified more than a week ago', () => {
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ identity: ALICE, verifiedAt: Date.now() - eightDays }),
    );
    expect(lastAccount()).toBeNull();
  });

  it('forgets the account when the service refuses the session', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ identity: ALICE, verifiedAt: Date.now() }));
    render(
      <AuthProvider adapter={REFUSED}>
        <Scope />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('expired:anon'));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('forgets the account when the service says nobody is signed in', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ identity: ALICE, verifiedAt: Date.now() }));
    render(
      <AuthProvider adapter={SIGNED_OUT}>
        <Scope />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('signed_out:anon'));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('replaces a remembered account with whoever the service actually verifies', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ identity: ALICE, verifiedAt: Date.now() }));
    render(
      <AuthProvider adapter={AS_BOB}>
        <Scope />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('scope').textContent).toBe(`signed_in:${BOB.userId}`),
    );
    expect(lastAccount()?.userId).toBe(BOB.userId);
  });

  it('maps only signed-in and offline states to an account scope', () => {
    const states: AuthState[] = [
      { status: 'restoring' },
      { status: 'signed_out' },
      { status: 'expired' },
      { status: 'unreachable' },
    ];
    for (const state of states) expect(scopeFor(state)).toBeNull();
    expect(scopeFor({ status: 'offline', identity: ALICE })).toBe(ALICE.userId);
    expect(scopeFor({ status: 'signed_in', identity: BOB })).toBe(BOB.userId);
  });
});
