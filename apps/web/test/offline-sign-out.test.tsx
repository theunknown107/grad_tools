/**
 * Signing out without a network, and what the next connection may not undo.
 *
 * WHAT THE INSTALLED SDK DOES (read from @clerk/react 6.17.7 and the clerk-js
 * 6.x it loads): offline from a cold start clerk-js never loads, so
 * `signOut()` is only QUEUED and resolves; once loaded, clerk-js swallows the
 * `network_error` from its DELETE and clears only its memory. Either way the
 * session stays live on Clerk's server, and the next online launch restores
 * it. These prove the app does not let that undo a sign-out, against the
 * shipped AuthProvider and real account-scoped storage (fake IndexedDB). The
 * fake below models exactly that split: a session on a server, and a client
 * that can or cannot reach it.
 */

import 'fake-indexeddb/auto';
/*
 * Loaded first on purpose: @capacitor/core installs its own `window.Capacitor`
 * when it is first imported, which would replace the native stub these tests
 * set if anything on the path imported it lazily mid-test.
 */
import '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import type { ReactNode } from 'react';
import {
  AuthProvider,
  deliberateSignOutAt,
  lastAccount,
  useAuth,
} from '../src/features/auth/AuthContext.js';
import { useSync } from '../src/features/auth/useSync.js';
import { useResults } from '../src/hooks/useCollection.js';
import type { Identity } from '../src/domain/auth.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import { createClerkAdapter } from '../src/repositories/cloud/clerk.js';
import { createLocalRepositories } from '../src/repositories/local/index.js';
import { fakeAdapter } from './helpers/auth-harness.js';

const PENDING = 'gradtools:v1:sign-out-pending';
const REMEMBERED = 'gradtools:v1:last-account';

let n = 0;
function account(): Identity {
  n += 1;
  return { userId: `offline-user-${String(n)}`, email: null, provider: 'email' };
}

/** Clerk's server and this device's view of it. */
function clerkWorld(signedIn: Identity | null) {
  const world = {
    online: true,
    /** The session as the SERVER holds it: only a reachable sign-out ends it. */
    server: signedIn,
    /** When false, a reachable server still refuses to end the session. */
    revokeWorks: true,
    signOutCalls: 0,
    tokenRequests: 0,
  };
  const listeners: ((identity: Identity | null) => void)[] = [];
  const emit = (identity: Identity | null) => {
    for (const listener of listeners) listener(identity);
  };
  const adapter: AuthAdapter = {
    ...fakeAdapter(false),
    async current() {
      if (!world.online) throw new Error('Clerk did not load');
      return world.server;
    },
    async accessToken() {
      world.tokenRequests += 1;
      return world.online && world.server !== null ? 'synthetic-token' : null;
    },
    async signInWithPassword(email) {
      if (!world.online) return { error: 'Offline' };
      world.server = { userId: `signed-in-${email}`, email, provider: 'email' };
      emit(world.server);
      return { error: null };
    },
    async signOut() {
      world.signOutCalls += 1;
      // Offline: clerk-js clears its memory and emits "no session"; the server keeps it.
      emit(null);
      if (!world.online || !world.revokeWorks) return { revoked: false };
      world.server = null;
      return { revoked: true };
    },
    onChange(listener) {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  return { world, adapter };
}

/** Records every auth status the app passed through, and what it is showing. */
/** The mounted provider's sign-out, as the Account page calls it. */
let signOutHere: () => Promise<{ revoked: boolean }> = () => Promise.reject(new Error('unmounted'));

function Probe({ seen }: { seen: string[] }) {
  const { state, signOut } = useAuth();
  signOutHere = signOut;
  const { items, loading } = useResults();
  seen.push(state.status);
  return (
    <output data-testid="probe">
      {state.status}:{loading ? 'loading' : String(items.length)}
    </output>
  );
}

function launch(adapter: AuthAdapter, seen: string[] = []) {
  render(
    <AuthProvider adapter={adapter}>
      <Probe seen={seen} />
    </AuthProvider>,
  );
  return seen;
}

const probe = () => screen.getByTestId('probe').textContent;

async function seed(who: Identity): Promise<void> {
  await createLocalRepositories(who.userId).results.upsert({ id: `r-${who.userId}` } as never);
}

function asNativeApp(): void {
  (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'Capacitor');
  window.localStorage.removeItem(PENDING);
  window.localStorage.removeItem(REMEMBERED);
  window.localStorage.removeItem('gradtools:v1:signed-out-at');
});

describe('signing out with no network', () => {
  it('signs this device out at once, forgets the account, keeps the records, and says the server part is pending', async () => {
    asNativeApp();
    const who = account();
    await seed(who);
    const { world, adapter } = clerkWorld(who);
    launch(adapter);
    await waitFor(() => expect(probe()).toBe('signed_in:1'));
    await waitFor(() => expect(lastAccount()?.userId).toBe(who.userId));

    world.online = false;
    let result: { revoked: boolean } | undefined;
    await act(async () => {
      result = await signOutHere();
    });

    expect(result).toEqual({ revoked: false });
    await waitFor(() => expect(probe()).toMatch(/^signed_out:/));
    expect(window.localStorage.getItem(REMEMBERED)).toBeNull();
    expect(window.localStorage.getItem(PENDING)).toBe('1');
    /* The server still holds the session: nothing claimed otherwise. */
    expect(world.server).toEqual(who);
    /* Signing out deletes nothing (M9 §36). */
    expect(await createLocalRepositories(who.userId).results.list()).toHaveLength(1);
  });

  it('makes no authenticated request once signed out, online or not', async () => {
    const who = account();
    const { world, adapter } = clerkWorld(who);
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => ({ auth: useAuth(), sync: useSync() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider adapter={adapter}>{children}</AuthProvider>
      ),
    });
    await waitFor(() => expect(result.current.auth.state.status).toBe('signed_in'));

    world.online = false;
    await act(async () => {
      await result.current.auth.signOut();
    });
    world.online = true; // even with the network back, in this session
    fetchMock.mockClear();
    const tokens = world.tokenRequests;
    await act(async () => {
      await result.current.sync.syncNow();
    });

    expect(result.current.auth.state.status).toBe('signed_out');
    expect(result.current.sync.state.status).toBe('local_only');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(world.tokenRequests).toBe(tokens);
  });
});

describe('the next connection does not undo it', () => {
  it('refuses the session Clerk restores, ends it on the server, and never shows it as signed in', async () => {
    asNativeApp();
    const who = account();
    await seed(who);
    const { world, adapter } = clerkWorld(who);
    launch(adapter);
    await waitFor(() => expect(probe()).toBe('signed_in:1'));
    world.online = false;
    await act(async () => {
      await signOutHere();
    });
    cleanup();

    /* Relaunch online: Clerk's client still finds the live server session. */
    world.online = true;
    const seen = launch(adapter);
    await waitFor(() => expect(world.server).toBeNull());
    await waitFor(() => expect(window.localStorage.getItem(PENDING)).toBeNull());
    expect(seen).not.toContain('signed_in');
    expect(probe()).toMatch(/^signed_out:/);
    expect(window.localStorage.getItem(REMEMBERED)).toBeNull();
    /* Still nothing deleted. */
    expect(await createLocalRepositories(who.userId).results.list()).toHaveLength(1);
  });

  it('keeps refusing, and keeps retrying, when the server will not end it yet', async () => {
    const who = account();
    const { world, adapter } = clerkWorld(who);
    world.online = false;
    window.localStorage.setItem(PENDING, '1'); // an earlier offline sign-out

    world.online = true;
    world.revokeWorks = false;
    const first = launch(adapter);
    await waitFor(() => expect(world.signOutCalls).toBe(1));
    expect(first).not.toContain('signed_in');
    expect(window.localStorage.getItem(PENDING)).toBe('1');
    cleanup();

    world.revokeWorks = true;
    const second = launch(adapter);
    await waitFor(() => expect(window.localStorage.getItem(PENDING)).toBeNull());
    expect(second).not.toContain('signed_in');
    expect(world.server).toBeNull();
  });

  it('offline with a sign-out pending: signed out — not an "unverified" account', async () => {
    const { world, adapter } = clerkWorld(account());
    world.online = false;
    window.localStorage.setItem(PENDING, '1');
    launch(adapter);
    await waitFor(() => expect(probe()).toMatch(/^signed_out:/));
  });

  it('a sign-in the student starts lifts the pending sign-out', async () => {
    const { world, adapter } = clerkWorld(null);
    window.localStorage.setItem(PENDING, '1');
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider adapter={adapter}>{children}</AuthProvider>
      ),
    });
    await waitFor(() => expect(result.current.state.status).toBe('signed_out'));
    // A fresh read with no session is the server's word: nothing left pending.
    expect(window.localStorage.getItem(PENDING)).toBeNull();

    window.localStorage.setItem(PENDING, '1'); // and even if it were still set:
    await act(async () => {
      await result.current.adapter?.signInWithPassword('b@example.test', 'synthetic');
    });
    await waitFor(() => expect(result.current.state.status).toBe('signed_in'));
    expect(window.localStorage.getItem(PENDING)).toBeNull();
    expect(world.server?.email).toBe('b@example.test');
  });
});

describe('the deliberate sign-out marker (read by diagnostics)', () => {
  it('is set by signing out and cleared by the next sign-in — a timestamp, nothing else', async () => {
    const { world, adapter } = clerkWorld(account());
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider adapter={adapter}>{children}</AuthProvider>
      ),
    });
    await waitFor(() => expect(result.current.state.status).toBe('signed_in'));
    expect(deliberateSignOutAt()).toBeNull();

    world.online = false;
    await act(async () => {
      await result.current.signOut();
    });
    const at = deliberateSignOutAt();
    expect(at).not.toBeNull();
    expect(Number.isNaN(Date.parse(at ?? ''))).toBe(false);

    world.online = true;
    await act(async () => {
      await result.current.adapter?.signInWithPassword('a@example.test', 'synthetic');
    });
    await waitFor(() => expect(result.current.state.status).toBe('signed_in'));
    expect(deliberateSignOutAt()).toBeNull();
  });
});

describe('switching accounts never shows one account’s records to another', () => {
  it('A signs out offline; B signs in later and sees only B’s scope', async () => {
    asNativeApp();
    const a = account();
    await seed(a);
    const { world, adapter } = clerkWorld(a);
    launch(adapter);
    await waitFor(() => expect(probe()).toBe('signed_in:1'));
    world.online = false;
    await act(async () => {
      await signOutHere();
    });
    cleanup();

    world.online = true;
    const { result } = renderHook(() => ({ auth: useAuth(), results: useResults() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider adapter={adapter}>{children}</AuthProvider>
      ),
    });
    await waitFor(() => expect(result.current.auth.state.status).toBe('signed_out'));
    await waitFor(() => expect(world.server).toBeNull());
    await act(async () => {
      await result.current.auth.adapter?.signInWithPassword('b@example.test', 'synthetic');
    });
    await waitFor(() => expect(result.current.auth.state.status).toBe('signed_in'));
    await waitFor(() => expect(result.current.results.loading).toBe(false));

    expect(result.current.results.items.some((r) => r.id === `r-${a.userId}`)).toBe(false);
    expect(lastAccount()?.userId).toBe('signed-in-b@example.test');
    expect(await createLocalRepositories(a.userId).results.list()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The Clerk adapter's sign-out against a fake clerk-js                        */
/* -------------------------------------------------------------------------- */

function fakeClerk(options: {
  loaded: boolean;
  reload?: () => Promise<{ signedInSessions: unknown[] }>;
}) {
  const signOut = vi.fn(() => Promise.resolve());
  const clerk = {
    loaded: options.loaded,
    user: null,
    session: null,
    client: options.reload === undefined ? undefined : { reload: options.reload },
    signOut,
    addListener: () => () => undefined,
  };
  return { clerk, signOut };
}

describe('the Clerk adapter reports only a revocation the server confirmed', () => {
  it('not loaded (offline cold start): reports nothing ended, and does not queue a call', async () => {
    const { clerk, signOut } = fakeClerk({ loaded: false });
    expect(await createClerkAdapter(clerk as never).signOut()).toEqual({ revoked: false });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('loaded, and the server confirms no session remains: revoked', async () => {
    const { clerk, signOut } = fakeClerk({
      loaded: true,
      reload: () => Promise.resolve({ signedInSessions: [] }),
    });
    expect(await createClerkAdapter(clerk as never).signOut()).toEqual({ revoked: true });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('loaded, but the server cannot be reached to confirm: not revoked', async () => {
    const { clerk } = fakeClerk({
      loaded: true,
      reload: () => Promise.reject(new Error('network_error')),
    });
    expect(await createClerkAdapter(clerk as never).signOut()).toEqual({ revoked: false });
  });

  it('loaded, and the server still holds a session: not revoked', async () => {
    const { clerk } = fakeClerk({
      loaded: true,
      reload: () => Promise.resolve({ signedInSessions: [{}] }),
    });
    expect(await createClerkAdapter(clerk as never).signOut()).toEqual({ revoked: false });
  });

  it('Clerk’s script failing to arrive is reported at once, not after the 15 s timer', async () => {
    const { clerk } = fakeClerk({ loaded: false });
    const started = Date.now();
    const pending = createClerkAdapter(clerk as never).current();
    // What the WebView does offline: the CDN <script> fires `error` at once.
    const script = document.createElement('script');
    script.src = 'https://clerk.example.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js';
    document.body.append(script);
    script.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow(/could not be reached/);
    expect(Date.now() - started).toBeLessThan(1000);
    // And a later read does not wait at all.
    await expect(createClerkAdapter(clerk as never).current()).rejects.toThrow();
    script.remove();
  });

  it('a device with no network is reported at once, not after the load timeout', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const { clerk } = fakeClerk({ loaded: false });
    const started = Date.now();
    await expect(createClerkAdapter(clerk as never).current()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
