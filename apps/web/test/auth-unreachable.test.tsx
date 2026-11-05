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
