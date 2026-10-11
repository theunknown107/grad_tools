/**
 * The native OAuth callback guard (CLERK-AUTH-MIGRATION-V1, security hardening).
 *
 * `gradtools://auth/callback` is a BROWSABLE deep link any installed app can
 * fire, so the Clerk adapter honours a callback ONLY when THIS app recently
 * started an OAuth, and exactly once. An unsolicited, replayed, stale, or
 * mismatched deep link must never drive the WebView to the Clerk callback route.
 * Clerk still validates the handshake server-side — this is defence in depth in
 * front of that, proven on device and pinned here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClerkAdapter } from '../src/repositories/cloud/clerk.js';

// The Custom Tab close is a native call; stub it so the adapter runs in jsdom.
vi.mock('@capacitor/browser', () => ({
  Browser: { close: vi.fn(async () => undefined), open: vi.fn(async () => undefined) },
}));

const OAUTH_PENDING_KEY = 'gradtools:v1:oauth-pending';
const CALLBACK = 'gradtools://auth/callback?rotating_token_nonce=SERVER_ISSUED';

// completeDeepLink touches none of the Clerk client, so a minimal stub suffices.
const clerkStub = {
  loaded: true,
  addListener: () => () => undefined,
} as unknown as Parameters<typeof createClerkAdapter>[0];

let assignSpy: ReturnType<typeof vi.fn>;
let realLocation: Location;

beforeEach(() => {
  localStorage.clear();
  realLocation = window.location;
  assignSpy = vi.fn();
  // jsdom's location.assign is non-configurable, so swap the whole object.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'https://localhost/sign-in', search: '', hash: '', assign: assignSpy },
  });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  localStorage.clear();
  vi.restoreAllMocks();
});

const markPending = (ageMs = 0) =>
  localStorage.setItem(OAUTH_PENDING_KEY, String(Date.now() - ageMs));

describe('native OAuth callback guard', () => {
  it('ignores an unsolicited callback (no OAuth was started)', async () => {
    await createClerkAdapter(clerkStub).completeDeepLink(CALLBACK);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('completes a callback the app started, forwarding params to /sso-callback', async () => {
    markPending();
    await createClerkAdapter(clerkStub).completeDeepLink(CALLBACK);
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(String(assignSpy.mock.calls[0]?.[0])).toContain(
      '/sso-callback?rotating_token_nonce=SERVER_ISSUED',
    );
  });

  it('rejects a replay: the pending marker is single-use', async () => {
    markPending();
    const adapter = createClerkAdapter(clerkStub);
    await adapter.completeDeepLink(CALLBACK);
    assignSpy.mockClear();
    await adapter.completeDeepLink(CALLBACK); // same link again
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('rejects a stale callback past the expiry window', async () => {
    markPending(11 * 60_000); // older than the 10-minute TTL
    await createClerkAdapter(clerkStub).completeDeepLink(CALLBACK);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('ignores a deep link that is not our auth callback', async () => {
    markPending();
    await createClerkAdapter(clerkStub).completeDeepLink('gradtools://elsewhere?x=1');
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
