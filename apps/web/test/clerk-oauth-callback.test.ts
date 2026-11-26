/**
 * The return leg of native Google sign-in.
 *
 * `gradtools://auth/callback` is a BROWSABLE deep link any installed app can
 * fire, so the adapter honours a callback ONLY when THIS app recently started an
 * OAuth, and exactly once. An honoured callback re-reads the attempt this client
 * owns and activates only a session Clerk reports complete.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClerkAdapter } from '../src/repositories/cloud/clerk.js';

// The Custom Tab close is a native call; stub it so the adapter runs in jsdom.
vi.mock('@capacitor/browser', () => ({
  Browser: {
    close: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    addListener: vi.fn(async (name: string, listener: () => void) => {
      listeners.set(name, listener);
      return {
        remove: async () => {
          released.count += 1;
        },
      };
    }),
    removeAllListeners: vi.fn(async () => undefined),
  },
}));

const { listeners, released } = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  released: { count: 0 },
}));

const OAUTH_PENDING_KEY = 'gradtools:v1:oauth-pending';
const CALLBACK = 'gradtools://auth/callback';

function fakeClerk() {
  const signIn = { reload: vi.fn(), create: vi.fn() };
  const signUp = { reload: vi.fn(), create: vi.fn() };
  const clerk = {
    loaded: true,
    client: { signIn, signUp },
    setActive: vi.fn(async () => undefined),
    addListener: () => () => undefined,
  };
  return {
    clerk,
    signIn,
    signUp,
    adapter: createClerkAdapter(clerk as unknown as Parameters<typeof createClerkAdapter>[0]),
  };
}

const markPending = (flow = 'sign_in', ageMs = 0) =>
  localStorage.setItem(OAUTH_PENDING_KEY, `${flow}:${String(Date.now() - ageMs)}`);

beforeEach(() => {
  localStorage.clear();
  listeners.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('native OAuth callback guard', () => {
  it('ignores an unsolicited callback (no OAuth was started)', async () => {
    const { adapter, signIn, clerk } = fakeClerk();
    expect(await adapter.completeDeepLink(CALLBACK)).toEqual({ error: null });
    expect(signIn.reload).not.toHaveBeenCalled();
    expect(clerk.setActive).not.toHaveBeenCalled();
  });

  it('rejects a replay: the pending marker is single-use', async () => {
    const { adapter, signIn } = fakeClerk();
    signIn.reload.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_1' });
    markPending();
    await adapter.completeDeepLink(CALLBACK);
    await adapter.completeDeepLink(CALLBACK);
    expect(signIn.reload).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale callback past the expiry window', async () => {
    const { adapter, signIn } = fakeClerk();
    markPending('sign_in', 11 * 60_000);
    await adapter.completeDeepLink(CALLBACK);
    expect(signIn.reload).not.toHaveBeenCalled();
  });

  it('rejects a malformed marker', async () => {
    const { adapter, signIn } = fakeClerk();
    localStorage.setItem(OAUTH_PENDING_KEY, String(Date.now()));
    await adapter.completeDeepLink(CALLBACK);
    expect(signIn.reload).not.toHaveBeenCalled();
  });

  it('ignores a deep link that is not our auth callback, keeping the marker', async () => {
    const { adapter, signIn } = fakeClerk();
    markPending();
    await adapter.completeDeepLink('gradtools://elsewhere?x=1');
    expect(signIn.reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(OAUTH_PENDING_KEY)).not.toBeNull();
  });
});

describe('finishing native Google', () => {
  const verified = { firstFactorVerification: { status: 'verified' } };

  it('activates the session of a completed sign-in', async () => {
    const { adapter, signIn, clerk } = fakeClerk();
    signIn.reload.mockResolvedValue({
      ...verified,
      status: 'complete',
      createdSessionId: 'sess_1',
    });
    markPending();
    expect(await adapter.completeDeepLink(CALLBACK)).toEqual({ error: null, handled: true });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_1' });
  });

  it('activates the session of a completed sign-up', async () => {
    const { adapter, signUp, clerk } = fakeClerk();
    signUp.reload.mockResolvedValue({
      status: 'complete',
      createdSessionId: 'sess_2',
      verifications: { externalAccount: { status: 'verified' } },
    });
    markPending('sign_up');
    expect(await adapter.completeDeepLink(CALLBACK)).toEqual({ error: null, handled: true });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_2' });
  });

  it('creates the account when Google sign-in finds no account', async () => {
    const { adapter, signIn, signUp, clerk } = fakeClerk();
    signIn.reload.mockResolvedValue({
      status: 'needs_identifier',
      firstFactorVerification: { status: 'transferable' },
    });
    signUp.create.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_3' });
    markPending();
    await adapter.completeDeepLink(CALLBACK);
    expect(signUp.create).toHaveBeenCalledWith({ transfer: true });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_3' });
  });

  it('signs in when Google sign-up finds an existing account', async () => {
    const { adapter, signIn, signUp, clerk } = fakeClerk();
    signUp.reload.mockResolvedValue({
      status: 'missing_requirements',
      verifications: { externalAccount: { status: 'transferable' } },
    });
    signIn.create.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_4' });
    markPending('sign_up');
    await adapter.completeDeepLink(CALLBACK);
    expect(signIn.create).toHaveBeenCalledWith({ transfer: true });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_4' });
  });

  it('says so, and activates nothing, when the attempt did not complete', async () => {
    const { adapter, signIn, clerk } = fakeClerk();
    signIn.reload.mockResolvedValue({
      status: 'needs_identifier',
      firstFactorVerification: { status: 'unverified' },
    });
    markPending();
    expect((await adapter.completeDeepLink(CALLBACK)).error).toMatch(/did not finish/i);
    expect(clerk.setActive).not.toHaveBeenCalled();
  });
});

describe('watching the attempt while the Custom Tab is open', () => {
  const started = async (status: string) => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    const fake = fakeClerk();
    fake.signIn.create.mockResolvedValue({
      firstFactorVerification: { externalVerificationRedirectURL: new URL('https://google.test') },
    });
    fake.signIn.reload.mockResolvedValue({
      status,
      createdSessionId: 'sess_5',
      firstFactorVerification: { status: 'verified' },
    });
    await fake.adapter.signInWithProvider('google');
    return fake;
  };

  it('activates the session and closes the tab when the attempt completes', async () => {
    const { clerk } = await started('complete');
    listeners.get('browserPageLoaded')?.();
    await vi.waitFor(() => expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_5' }));
    const { Browser } = await import('@capacitor/browser');
    await vi.waitFor(() => expect(Browser.close).toHaveBeenCalled());
  });

  it('lets a second tap replace the first watch without losing its marker', async () => {
    const fake = await started('needs_identifier');
    released.count = 0;
    await fake.adapter.signInWithProvider('google');
    expect(released.count).toBe(2); // the first watch's two listeners, and only those
    expect(localStorage.getItem(OAUTH_PENDING_KEY)).toMatch(/^sign_in:/);
  });

  it('treats a tab closed before finishing as a cancel: no session, marker cleared', async () => {
    const { clerk, signIn } = await started('needs_identifier');
    listeners.get('browserFinished')?.();
    await vi.waitFor(() => expect(signIn.reload).toHaveBeenCalled());
    await vi.waitFor(() => expect(localStorage.getItem(OAUTH_PENDING_KEY)).toBeNull());
    expect(clerk.setActive).not.toHaveBeenCalled();
  });
});
