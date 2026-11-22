/**
 * A deep link the app did not start must not count as the student signing in.
 *
 * `gradtools://auth/...` is a BROWSABLE link any app or web page can fire. It
 * used to mark a sign-in as started before anything checked it, which let a
 * stray link revive a session the student had signed out of while offline.
 */

import 'fake-indexeddb/auto';
import '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { AuthProvider, useAuth } from '../src/features/auth/AuthContext.js';
import type { Identity } from '../src/domain/auth.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import { fakeAdapter } from './helpers/auth-harness.js';

const { launchUrl } = vi.hoisted(() => ({ launchUrl: { url: 'gradtools://auth/callback' } }));
vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: async () => launchUrl,
    addListener: async () => ({ remove: async () => undefined }),
  },
}));

const PENDING = 'gradtools:v1:sign-out-pending';
const restored: Identity = { userId: 'deep-link-user', email: null, provider: 'google' };

function Probe() {
  return <output data-testid="probe">{useAuth().state.status}</output>;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'Capacitor');
  window.localStorage.removeItem(PENDING);
});

describe('a deep link after an offline sign-out', () => {
  it('does not revive the session when the app did not start a sign-in', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    window.localStorage.setItem(PENDING, '1');
    let ended = 0;
    const adapter: AuthAdapter = {
      ...fakeAdapter(false),
      // Clerk restores the session the server still holds.
      current: async () => restored,
      completeDeepLink: async () => ({ error: null }),
      // The server refuses to end it yet, so the pending sign-out stays.
      signOut: async () => {
        ended += 1;
        return { revoked: false };
      },
    };

    render(
      <AuthProvider adapter={adapter}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(ended).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('probe').textContent).toBe('signed_out');
    expect(window.localStorage.getItem(PENDING)).toBe('1');
  });
});
