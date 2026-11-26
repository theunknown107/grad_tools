/**
 * Cold start: the dashboard says what the student's records say, or nothing.
 *
 * THE BUG. While Clerk restored a stored session, the repositories pointed at
 * the ANONYMOUS scope. Its lists answered instantly and empty, so a signed-in
 * student with a saved semester was told "No results are saved yet"; then the
 * session settled, the scope changed, every list reloaded (a skeleton), and
 * only then did their data appear. Three contradictory screens in a second.
 *
 * THE CONTRACT these prove, against the shipped AuthProvider and real
 * account-scoped storage (fake IndexedDB), not a mock of either:
 *   restoring / loading → skeleton; loaded → the records; empty → the empty
 *   state, only once the right account's storage has said so; a failed read →
 *   an error with a retry, never the empty state.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { AuthProvider, lastAccount } from '../src/features/auth/AuthContext.js';
import { AuthServiceUnreachable } from '../src/repositories/cloud/clerk.js';
import { useSync } from '../src/features/auth/useSync.js';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import { AppShell } from '../src/components/layout/AppShell.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { Identity } from '../src/domain/auth.js';
import type { SemesterResult } from '../src/domain/types.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import { createLocalRepositories } from '../src/repositories/local/index.js';
import { fakeAdapter } from './helpers/auth-harness.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const FALSE_EMPTY = /No results are saved yet/;
const SKELETON = 'Loading your dashboard';
const SKELETON_TEXT = /Loading your dashboard/;

function savedResult(): SemesterResult {
  return {
    id: 'r1',
    profileId: asStudentProfileId('11111111-1111-1111-1111-111111111111'),
    semester: 1,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: [
      normalizeResultSubject({
        id: 's-BMATS101',
        subjectCode: 'BMATS101',
        subjectTitle: 'Mathematics I',
        internal: 46,
        external: 34,
        total: 80,
        resultStatus: null,
        credits: 4,
        gradeLetter: null,
        hasSee: true,
        provenance: 'catalogue',
      }),
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * The real adapter shape, with `current()` held until the test releases it —
 * Clerk's load on a cold start, at whatever speed the network allows.
 */
function restoringAdapter(identity: Identity | null) {
  let release: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const adapter: AuthAdapter = {
    ...fakeAdapter(identity !== null),
    current: async () => {
      await settled;
      return identity;
    },
  };
  return { adapter, release };
}

/** Every text the screen showed, including frames that lasted one commit. */
function recordFrames(): { frames: string[]; stop: () => void } {
  const frames: string[] = [document.body.textContent];
  const observer = new MutationObserver(() => {
    frames.push(document.body.textContent);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { frames, stop: () => observer.disconnect() };
}

function SyncingDashboard() {
  const sync = useSync();
  return (
    <>
      <button type="button" onClick={() => void sync.syncNow()}>
        Sync now
      </button>
      <DashboardPage />
    </>
  );
}

function startApp(adapter: AuthAdapter | null, ui = <DashboardPage />) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider adapter={adapter}>{ui}</AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Lets every pending storage read settle without moving any test clock. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let user = 0;
/** A fresh account per test: IndexedDB outlives a test within this file. */
function identity(): Identity {
  user += 1;
  return { userId: `restore-user-${String(user)}`, email: null, provider: 'email' };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* No test here may reach a real network: the default is a device offline. */
function offline(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
}

describe('dashboard cold start, signed in with saved results', () => {
  it('shows a skeleton while the session restores — never the empty claim', async () => {
    offline();
    const who = identity();
    await createLocalRepositories(who.userId).results.upsert(savedResult());
    const { adapter, release } = restoringAdapter(who);
    const { frames, stop } = recordFrames();

    startApp(adapter);
    // Everything that can be read without the session HAS been read by now —
    // the anonymous scope included. This is the frame the bug lived in.
    await flush();
    expect(screen.getByText(SKELETON_TEXT)).toBeTruthy();
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();

    release();
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
    stop();

    expect(frames.some((text) => FALSE_EMPTY.test(text))).toBe(false);
    /* One transition: skeleton, then the records — no skeleton after data. */
    const firstData = frames.findIndex((text) => text.includes('1 semester graded'));
    expect(frames.slice(firstData).some((text) => text.includes(SKELETON))).toBe(false);
  });

  it('keeps the records on screen while a sync is slow or the network is down', async () => {
    const who = identity();
    await createLocalRepositories(who.userId).results.upsert(savedResult());
    /* A sync that never answers, then one that fails outright. */
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    startApp(fakeAdapterFor(who), <SyncingDashboard />);
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await flush();
    expect(screen.getByText(/1 semester graded/)).toBeTruthy();

    offline();
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await flush();
    expect(screen.getByText(/1 semester graded/)).toBeTruthy();
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();
    expect(await createLocalRepositories(who.userId).results.list()).toHaveLength(1);
  });
});

describe('dashboard cold start, the other paths', () => {
  it('a genuinely empty account gets the empty state — after its storage has answered', async () => {
    offline();
    const { adapter, release } = restoringAdapter(identity());
    startApp(adapter);
    await flush();
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();

    release();
    expect(await screen.findByText(FALSE_EMPTY)).toBeTruthy();
  });

  it('signed out: the device’s own records restore, Clerk or no Clerk', async () => {
    offline();
    await createLocalRepositories(null).results.upsert(savedResult());

    const { adapter, release } = restoringAdapter(null);
    startApp(adapter);
    await flush();
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();
    release();
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
    cleanup();

    /* No identity provider configured at all: nothing to wait for. */
    startApp(null);
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
  });

  it('a session that cannot be verified ends the wait instead of spinning forever', async () => {
    offline();
    const adapter: AuthAdapter = {
      ...fakeAdapter(true),
      current: () => Promise.reject(new Error('Clerk did not load')),
    };
    startApp(adapter);
    // `expired` settles on the anonymous scope (M9 §37): the wait ends and the
    // dashboard renders that scope's answer, whatever it is.
    expect(
      (await screen.findByRole('heading', { level: 1 })).closest('section')!,
    ).toBeTruthy();
    expect(screen.queryByText(SKELETON_TEXT)).toBeNull();
  });
});

describe('a failed read is not an empty account', () => {
  it('says the records could not be read, and retries', async () => {
    const memory = createMemoryRepositories({ results: [savedResult()] });
    const real = memory.bundle.results.list.bind(memory.bundle.results);
    let failing = true;
    const results = {
      ...memory.bundle.results,
      list: () => (failing ? Promise.reject(new Error('storage unavailable')) : real()),
    };
    renderWith(<DashboardPage />, { repositories: { ...memory.bundle, results } });

    expect(await screen.findByText('Your saved records could not be read')).toBeTruthy();
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
  });
});

/** An adapter already signed in as `who`. */
function fakeAdapterFor(who: Identity | null): AuthAdapter {
  return { ...fakeAdapter(who !== null), current: async () => who };
}

describe('on the phone: the account this device last verified', () => {
  const REMEMBERED = 'gradtools:v1:last-account';
  /* Production's format: the identity Clerk verified, and when. */
  const remembered = (userId: string): string =>
    JSON.stringify({ identity: { userId, email: null, provider: 'email' }, verifiedAt: Date.now() });
  function asNativeApp(): void {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  }
  afterEach(() => {
    Reflect.deleteProperty(window, 'Capacitor');
    window.localStorage.removeItem(REMEMBERED);
  });

  it('shows its records at once while Clerk is still loading — no skeleton, no empty claim', async () => {
    offline();
    asNativeApp();
    const who = identity();
    await createLocalRepositories(who.userId).results.upsert(savedResult());
    window.localStorage.setItem(REMEMBERED, remembered(who.userId));
    const { adapter, release } = restoringAdapter(who);
    const { frames, stop } = recordFrames();

    startApp(adapter);
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
    release();
    await flush();
    stop();
    expect(screen.getByText(/1 semester graded/)).toBeTruthy();
    expect(frames.some((text) => FALSE_EMPTY.test(text))).toBe(false);
    const firstData = frames.findIndex((text) => text.includes('1 semester graded'));
    expect(frames.slice(firstData).some((text) => text.includes(SKELETON))).toBe(false);
  });

  it('keeps them readable when Clerk cannot be reached (offline)', async () => {
    offline();
    asNativeApp();
    const who = identity();
    await createLocalRepositories(who.userId).results.upsert(savedResult());
    window.localStorage.setItem(REMEMBERED, remembered(who.userId));
    startApp({
      ...fakeAdapter(true),
      current: () => Promise.reject(new Error('Clerk did not load')),
    });

    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
    await flush();
    expect(screen.getByText(/1 semester graded/)).toBeTruthy();
    expect(screen.queryByText(FALSE_EMPTY)).toBeNull();
  });

  it('forgets the account once Clerk says nobody is signed in', async () => {
    offline();
    asNativeApp();
    const who = identity();
    await createLocalRepositories(who.userId).results.upsert(savedResult());
    window.localStorage.setItem(REMEMBERED, remembered(who.userId));
    startApp(fakeAdapterFor(null));

    await waitForForgotten(REMEMBERED);
    // Its records are untouched in storage — only no longer on screen.
    expect(await createLocalRepositories(who.userId).results.list()).toHaveLength(1);
  });

  it('says the account is offline when Clerk cannot be reached — and only then', async () => {
    offline();
    asNativeApp();
    const who = identity();
    await createLocalRepositories(who.userId).results.upsert(savedResult());
    window.localStorage.setItem(REMEMBERED, remembered(who.userId));
    startApp(
      { ...fakeAdapter(true), current: () => Promise.reject(new AuthServiceUnreachable()) },
      <AppShell>
        <DashboardPage />
      </AppShell>,
    );
    /* Unreachable is `offline` (production's notice), not a refused session. */
    expect(await screen.findByText(/You’re offline/)).toBeTruthy();
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
    cleanup();

    startApp(
      fakeAdapterFor(who),
      <AppShell>
        <DashboardPage />
      </AppShell>,
    );
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy();
    expect(screen.queryByText(/You’re offline/)).toBeNull();
  });

  it('a different verified account never sees the remembered one’s records', async () => {
    offline();
    asNativeApp();
    const before = identity();
    const after = identity();
    await createLocalRepositories(before.userId).results.upsert(savedResult());
    window.localStorage.setItem(REMEMBERED, remembered(before.userId));
    const { adapter, release } = restoringAdapter(after);

    startApp(adapter);
    expect(await screen.findByText(/1 semester graded/)).toBeTruthy(); // the remembered phone account
    release();
    // Clerk verifies someone else: their own (empty) scope, never the first's.
    expect(await screen.findByText(FALSE_EMPTY)).toBeTruthy();
    expect(screen.queryByText(/1 semester graded/)).toBeNull();
    expect(lastAccount()?.userId).toBe(after.userId);
    expect(await createLocalRepositories(before.userId).results.list()).toHaveLength(1);
  });

  it('a web page never remembers an account', async () => {
    offline();
    const who = identity();
    startApp(fakeAdapterFor(who));
    await flush();
    expect(window.localStorage.getItem(REMEMBERED)).toBeNull();
  });
});

async function waitForForgotten(key: string): Promise<void> {
  await flush();
  expect(window.localStorage.getItem(key)).toBeNull();
}
