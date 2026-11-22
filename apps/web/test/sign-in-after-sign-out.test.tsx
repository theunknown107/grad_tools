/**
 * Starting a sign-in is not signing in.
 *
 * A pending sign-out (see AuthContext SIGN_OUT_PENDING) used to be cleared the
 * moment Google was pressed, so cancelling, a failure or a restart let the session
 * the student had signed out of come back. These run the shipped AuthProvider
 * against a fake that keeps the server's session apart from what the button did.
 */

import 'fake-indexeddb/auto';
import '@capacitor/core';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { AuthProvider, useAuth, type AuthContextValue } from '../src/features/auth/AuthContext.js';
import type { Identity } from '../src/domain/auth.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import { fakeAdapter } from './helpers/auth-harness.js';

const PENDING = 'gradtools:v1:sign-out-pending';
const OLD: Identity = { userId: 'old-session', email: null, provider: 'google' };
const NEW: Identity = { userId: 'new-session', email: null, provider: 'google' };

type Outcome = 'success' | 'cancelled' | 'failed' | 'interrupted';

function world(session: Identity | null, online = true) {
  const w = { online, session, outcome: 'success' as Outcome, started: 0, ended: 0 };
  const listeners = new Set<(identity: Identity | null) => void>();
  const provider = async () => {
    w.started += 1;
    if (w.outcome === 'failed') return { error: 'Google said no' };
    if (w.outcome === 'success') {
      w.session = NEW;
      for (const listener of listeners) listener(NEW);
    }
    return { error: null }; // cancelled or interrupted: nothing further happens
  };
  const adapter: AuthAdapter = {
    ...fakeAdapter(false),
    current: async () => w.session,
    signInWithProvider: provider,
    signUpWithProvider: provider,
    signOut: async () => {
      w.ended += 1;
      if (!w.online) return { revoked: false };
      w.session = null;
      return { revoked: true };
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { w, adapter };
}

let auth: AuthContextValue;
function Probe() {
  auth = useAuth();
  return <output data-testid="status">{auth.state.status}</output>;
}

const launch = (adapter: AuthAdapter) =>
  render(
    <AuthProvider adapter={adapter}>
      <Probe />
    </AuthProvider>,
  );
const status = () => screen.getByTestId('status').textContent;
const pending = () => window.localStorage.getItem(PENDING);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Google after a sign-out the server has not confirmed', () => {
  it('success: the old session is ended first, and the new one is accepted', async () => {
    window.localStorage.setItem(PENDING, '1');
    const { w, adapter } = world(OLD, false);
    launch(adapter);
    await waitFor(() => expect(status()).toBe('signed_out'));

    w.online = true;
    await act(async () => {
      await auth.adapter!.signInWithProvider('google');
    });

    expect(w.ended).toBeGreaterThan(0);
    expect(status()).toBe('signed_in');
    expect(auth.state).toMatchObject({ identity: { userId: 'new-session' } });
    expect(pending()).toBeNull();
  });

  it.each(['cancelled', 'failed', 'interrupted'] as const)(
    '%s: the old session is gone and stays gone after a restart',
    async (outcome) => {
      window.localStorage.setItem(PENDING, '1');
      const { w, adapter } = world(OLD, false);
      const first = launch(adapter);
      await waitFor(() => expect(status()).toBe('signed_out'));

      w.online = true;
      w.outcome = outcome;
      await act(async () => {
        await auth.adapter!.signInWithProvider('google');
      });
      first.unmount();

      launch(adapter);
      await waitFor(() => expect(status()).toBe('signed_out'));
      expect(w.session).toBeNull();
    },
  );

  it('offline: Google never opens, and the sign-out stays pending', async () => {
    window.localStorage.setItem(PENDING, '1');
    const { w, adapter } = world(OLD, false);
    launch(adapter);
    await waitFor(() => expect(status()).toBe('signed_out'));

    let result: { error: string | null } = { error: null };
    await act(async () => {
      result = await auth.adapter!.signInWithProvider('google');
    });

    expect(w.started).toBe(0);
    expect(result.error).toMatch(/connection/i);
    expect(pending()).toBe('1');
  });

  it('restart with Google unfinished: the restored session is still refused', async () => {
    window.localStorage.setItem(PENDING, '1');
    const { w, adapter } = world(OLD, false);
    launch(adapter);
    await waitFor(() => expect(status()).toBe('signed_out'));
    await waitFor(() => expect(w.ended).toBeGreaterThan(0));
    expect(status()).toBe('signed_out');
    expect(pending()).toBe('1');
  });

  it('a repeated tap ends the session once and opens one sign-in per completed attempt', async () => {
    window.localStorage.setItem(PENDING, '1');
    const { w, adapter } = world(null, true);
    let release: (revoked: { revoked: boolean }) => void = () => undefined;
    let ended = 0;
    const slow: AuthAdapter = {
      ...adapter,
      signOut: () => {
        ended += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };
    launch(slow);
    await waitFor(() => expect(ended).toBe(1));

    const taps = [
      auth.adapter!.signInWithProvider('google'),
      auth.adapter!.signInWithProvider('google'),
    ];
    release({ revoked: true });
    await act(async () => {
      await Promise.all(taps);
    });
    expect(ended).toBe(1);
    expect(w.started).toBe(2); // the screen's busy state stops the second one for real
  });

  it('a sign-out in another context cannot be undone by a "no session here" read', async () => {
    window.localStorage.setItem(PENDING, '1');
    // Clerk cleared its memory offline: nothing here, but the server still holds it.
    const { adapter } = world(null, false);
    launch(adapter);
    await waitFor(() => expect(status()).toBe('signed_out'));
    await act(async () => {
      await auth.refresh();
    });
    expect(pending()).toBe('1');
  });
});

describe('ordinary sign-in', () => {
  it('signs in with nothing pending, and switches accounts through a sign-out', async () => {
    const { w, adapter } = world(OLD, true);
    launch(adapter);
    await waitFor(() => expect(status()).toBe('signed_in'));

    await act(async () => {
      await auth.signOut();
    });
    expect(status()).toBe('signed_out');
    expect(pending()).toBeNull();

    await act(async () => {
      await auth.adapter!.signInWithProvider('google');
    });
    expect(auth.state).toMatchObject({ identity: { userId: 'new-session' } });
    expect(w.ended).toBe(1);
  });

  it('a failed Google sign-in after a confirmed sign-out leaves the student signed out', async () => {
    const { w, adapter } = world(OLD, true);
    launch(adapter);
    await waitFor(() => expect(status()).toBe('signed_in'));
    await act(async () => {
      await auth.signOut();
    });
    w.outcome = 'failed';
    await act(async () => {
      await auth.adapter!.signInWithProvider('google');
    });
    expect(status()).toBe('signed_out');
  });
});
