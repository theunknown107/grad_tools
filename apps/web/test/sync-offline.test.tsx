/**
 * Signed in, then offline: sync sends nothing, says it is offline, and keeps
 * the account's own bookkeeping; back online, the same account syncs again.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/features/auth/AuthContext.js';
import { useSync } from '../src/features/auth/useSync.js';
import { AuthServiceUnreachable } from '../src/repositories/cloud/clerk.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import type { Identity } from '../src/domain/auth.js';

const KEY = 'gradtools:v1:last-account';
const ALICE: Identity = {
  userId: 'aaaaaaaa-1111-4000-8000-00000000000a',
  email: 'alice@example.test',
  provider: 'email',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.removeItem(KEY);
});

const OFFLINE: AuthAdapter = {
  current: async () => {
    throw new AuthServiceUnreachable();
  },
  accessToken: async () => {
    throw new AuthServiceUnreachable();
  },
  signInWithPassword: async () => ({ error: null }),
  signUpWithPassword: async () => ({ error: null, needsConfirmation: false }),
  signInWithProvider: async () => ({ error: null }),
  sendRecovery: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  completeDeepLink: async () => ({ error: null }),
  signOut: async () => undefined,
  onChange: () => () => undefined,
  onPasswordRecovery: () => () => undefined,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider adapter={OFFLINE}>{children}</AuthProvider>
);

describe('sync while a signed-in account is offline', () => {
  it('contacts no server and reports offline, never synced', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ identity: ALICE, verifiedAt: Date.now() }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => ({ auth: useAuth(), sync: useSync() }), { wrapper });
    await waitFor(() => expect(result.current.auth.state.status).toBe('offline'));
    await act(async () => {
      await result.current.sync.syncNow();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.sync.state.status).toBe('offline');
    expect(result.current.sync.state.status).not.toBe('synced');
  });
});
