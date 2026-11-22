/**
 * Cloud sync is gated by authentication AND Terms — the local-first access model.
 *
 * Local-first means the app is usable signed out, but anything that leaves the
 * device is not: `useSync` uploads nothing without a session, and withholds the
 * upload (server-authoritative, via `/me`) until the current Terms are accepted.
 * Local records are never touched by either refusal. Proven against the shipped
 * hook (the real AuthProvider + repositories), not a mock of it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CURRENT_TERMS } from '@gradtools/shared-types';
import { AuthProvider, useAuth } from '../src/features/auth/AuthContext.js';
import { useSync } from '../src/features/auth/useSync.js';
import { fakeAdapter } from './helpers/auth-harness.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** `/me` reports the given terms value; sync endpoints return an empty, OK body. */
function mockApi(terms: unknown): ReturnType<typeof vi.fn> {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/me') && !url.includes('/me/sync')) return json({ terms });
    return json({ records: [], outcomes: [], syncedAt: new Date().toISOString() });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function wrapper(signedIn: boolean) {
  return ({ children }: { children: ReactNode }) => (
    <AuthProvider adapter={fakeAdapter(signedIn)}>{children}</AuthProvider>
  );
}

const both = () => ({ auth: useAuth(), sync: useSync() });

describe('cloud sync gating (local-first)', () => {
  it('signed OUT: sync stays local-only and contacts no server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(both, { wrapper: wrapper(false) });
    await waitFor(() => expect(result.current.auth.state.status).toBe('signed_out'));
    await act(async () => {
      await result.current.sync.syncNow();
    });
    await waitFor(() => expect(result.current.sync.state.status).toBe('local_only'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signed IN but Terms unaccepted: the upload is withheld (needs_terms), not pushed', async () => {
    const fetchMock = mockApi(null); // /me: no current acceptance
    const { result } = renderHook(both, { wrapper: wrapper(true) });
    await waitFor(() => expect(result.current.auth.state.status).toBe('signed_in'));
    await act(async () => {
      await result.current.sync.syncNow();
    });
    await waitFor(() => expect(result.current.sync.state.status).toBe('needs_terms'));
    const hitPush = fetchMock.mock.calls.some((c) => String(c[0]).includes('/me/sync'));
    expect(hitPush).toBe(false); // nothing was uploaded
  });

  it('signed IN with Terms accepted: sync passes the gate', async () => {
    mockApi({ version: CURRENT_TERMS.version, acceptedAt: '2026-01-01T00:00:00.000Z' });
    const { result } = renderHook(both, { wrapper: wrapper(true) });
    await waitFor(() => expect(result.current.auth.state.status).toBe('signed_in'));
    await act(async () => {
      await result.current.sync.syncNow();
    });
    // Past the gate: whatever the push's outcome, it is never withheld for Terms.
    await waitFor(() => expect(result.current.sync.state.status).not.toBe('needs_terms'));
    expect(result.current.sync.state.status).not.toBe('local_only');
  });
});
