/**
 * The Clerk adapter against a MOCKED Clerk instance. No key, no network.
 *
 * Proves each flow calls the right Clerk resource method and only activates a
 * session Clerk reports complete, that recovery never reveals whether an
 * address is registered, that Google opens the system browser inside the
 * Android app (WebView-safe), and that errors are worded for a student.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClerkAPIResponseError } from '@clerk/react/errors';
import { createClerkAdapter, friendlyClerkError } from '../src/repositories/cloud/clerk.js';

// Native Google opens a Custom Tab; stub the plugin so the adapter runs in jsdom.
vi.mock('@capacitor/browser', () => ({
  Browser: { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
}));

const apiError = (code: string, status = 422) =>
  new ClerkAPIResponseError('synthetic', { data: [{ code, message: code }], status });

function fakeClerk() {
  const signIn = {
    create: vi.fn(),
    prepareSecondFactor: vi.fn(async () => ({})),
    attemptSecondFactor: vi.fn(),
    attemptFirstFactor: vi.fn(),
    authenticateWithRedirect: vi.fn(async () => undefined),
    // The native flow reads the provider URL off the created sign-in resource.
    firstFactorVerification: {
      externalVerificationRedirectURL: new URL('https://big-cardinal-4283.accounts.dev/oauth'),
    },
  };
  const signUp = {
    create: vi.fn(),
    prepareEmailAddressVerification: vi.fn(async () => ({})),
    attemptEmailAddressVerification: vi.fn(),
  };
  const clerk = {
    loaded: true,
    client: { signIn, signUp },
    user: null as unknown,
    session: { getToken: vi.fn(async () => 'synthetic-session-token') } as unknown,
    setActive: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    addListener: vi.fn(() => () => undefined),
  };
  return { clerk, signIn, signUp, adapter: createClerkAdapter(clerk as never) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('email and password', () => {
  it('activates the session Clerk reports complete', async () => {
    const { adapter, signIn, clerk } = fakeClerk();
    signIn.create.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_1' });
    expect(await adapter.signInWithPassword('a@example.test', 'pw-synthetic')).toEqual({
      error: null,
      needsCode: false,
    });
    expect(signIn.create).toHaveBeenCalledWith({
      identifier: 'a@example.test',
      password: 'pw-synthetic',
    });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_1' });
  });

  it('finishes a new-device sign-in with the emailed code', async () => {
    const { adapter, signIn, clerk } = fakeClerk();
    signIn.create.mockResolvedValue({
      status: 'needs_client_trust',
      supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'idn_1' }],
      prepareSecondFactor: signIn.prepareSecondFactor,
    });
    expect((await adapter.signInWithPassword('a@example.test', 'pw')).needsCode).toBe(true);
    expect(clerk.setActive).not.toHaveBeenCalled();
    expect(signIn.prepareSecondFactor).toHaveBeenCalledWith({
      strategy: 'email_code',
      emailAddressId: 'idn_1',
    });

    signIn.attemptSecondFactor.mockResolvedValue({
      status: 'complete',
      createdSessionId: 'sess_2',
    });
    expect(await adapter.verifyCode!('123456')).toEqual({ error: null });
    expect(signIn.attemptSecondFactor).toHaveBeenCalledWith({
      strategy: 'email_code',
      code: '123456',
    });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_2' });
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const { adapter, signIn } = fakeClerk();
    signIn.create.mockRejectedValueOnce(apiError('form_password_incorrect'));
    const wrong = await adapter.signInWithPassword('a@example.test', 'pw');
    signIn.create.mockRejectedValueOnce(apiError('form_identifier_not_found'));
    const unknown = await adapter.signInWithPassword('nobody@example.test', 'pw');
    expect(wrong.error).toBe(unknown.error);
    expect(wrong.error).toMatch(/do not match an account/);
  });
});

describe('creating an account', () => {
  it('confirms the address with an emailed code, then activates', async () => {
    const { adapter, signUp, clerk } = fakeClerk();
    signUp.create.mockResolvedValue({
      status: 'missing_requirements',
      prepareEmailAddressVerification: signUp.prepareEmailAddressVerification,
    });
    expect(await adapter.signUpWithPassword('new@example.test', 'pw-synthetic')).toEqual({
      error: null,
      needsConfirmation: true,
    });
    expect(signUp.prepareEmailAddressVerification).toHaveBeenCalledWith({ strategy: 'email_code' });

    signUp.attemptEmailAddressVerification.mockRejectedValueOnce(apiError('form_code_incorrect'));
    expect((await adapter.verifyCode!('000000')).error).toMatch(/code is not right/);
    expect(clerk.setActive).not.toHaveBeenCalled();

    signUp.attemptEmailAddressVerification.mockResolvedValue({
      status: 'complete',
      createdSessionId: 'sess_3',
    });
    expect(await adapter.verifyCode!('123456')).toEqual({ error: null });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_3' });
  });

  it('rejects a breached password in words', async () => {
    const { adapter, signUp } = fakeClerk();
    signUp.create.mockRejectedValue(apiError('form_password_pwned'));
    expect((await adapter.signUpWithPassword('new@example.test', 'password')).error).toMatch(
      /data breach/,
    );
  });
});

describe('recovery', () => {
  it('never reveals whether the address is registered', async () => {
    const { adapter, signIn } = fakeClerk();
    signIn.create.mockRejectedValue(apiError('form_identifier_not_found'));
    expect(await adapter.sendRecovery('nobody@example.test')).toEqual({ error: null });
    expect(signIn.create).toHaveBeenCalledWith({
      strategy: 'reset_password_email_code',
      identifier: 'nobody@example.test',
    });
  });

  it('reports a rate limit, which reveals nothing about the account', async () => {
    const { adapter, signIn } = fakeClerk();
    signIn.create.mockRejectedValue(apiError('too_many_requests', 429));
    expect((await adapter.sendRecovery('a@example.test')).error).toMatch(/Too many attempts/);
  });

  it('resets with the emailed code and the new password', async () => {
    const { adapter, signIn, clerk } = fakeClerk();
    signIn.attemptFirstFactor.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_4' });
    expect(await adapter.resetWithCode!('123456', 'new-pw-synthetic')).toEqual({ error: null });
    expect(signIn.attemptFirstFactor).toHaveBeenCalledWith({
      strategy: 'reset_password_email_code',
      code: '123456',
      password: 'new-pw-synthetic',
    });
    expect(clerk.setActive).toHaveBeenCalledWith({ session: 'sess_4' });
  });
});

describe('Google', () => {
  it('redirects on the web, returning through /sso-callback', async () => {
    const { adapter, signIn } = fakeClerk();
    expect(await adapter.signInWithProvider('google')).toEqual({ error: null });
    expect(signIn.authenticateWithRedirect).toHaveBeenCalledWith({
      strategy: 'oauth_google',
      redirectUrl: `${window.location.origin}/sso-callback`,
      redirectUrlComplete: `${window.location.origin}/account`,
    });
    expect(adapter.providerUnavailable).toBeUndefined();
  });

  it('opens the system browser for Google inside the Android app (WebView-safe)', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    const { adapter, signIn } = fakeClerk();
    signIn.create.mockResolvedValue(undefined);
    const { Browser } = await import('@capacitor/browser');

    expect(await adapter.signInWithProvider('google')).toEqual({ error: null });
    // Creates the OAuth sign-in with the custom-scheme deep link as its return…
    expect(signIn.create).toHaveBeenCalledWith({
      strategy: 'oauth_google',
      redirectUrl: 'gradtools://auth/callback',
      actionCompleteRedirectUrl: 'gradtools://auth/callback',
    });
    // …and opens Clerk's provider URL in the SYSTEM browser, never the WebView.
    expect(Browser.open).toHaveBeenCalledWith({
      url: 'https://big-cardinal-4283.accounts.dev/oauth',
    });
    expect(signIn.authenticateWithRedirect).not.toHaveBeenCalled();
    // A native OAuth was started, so the callback guard's pending marker is set.
    expect(localStorage.getItem('gradtools:v1:oauth-pending')).not.toBeNull();
    expect(adapter.providerUnavailable).toBeUndefined();
  });
});

describe('the session', () => {
  it('hands the API Clerk’s session token, and nothing when signed out', async () => {
    const { adapter, clerk } = fakeClerk();
    expect(await adapter.accessToken()).toBe('synthetic-session-token');
    clerk.session = undefined;
    expect(await adapter.accessToken()).toBeNull();
  });

  it('reduces the Clerk user to an identity', async () => {
    const { adapter, clerk } = fakeClerk();
    clerk.user = {
      id: 'user_2synth',
      primaryEmailAddress: { emailAddress: 'a@example.test' },
      externalAccounts: [{ provider: 'google' }],
    };
    expect(await adapter.current()).toEqual({
      userId: 'user_2synth',
      email: 'a@example.test',
      provider: 'google',
    });
  });

  it('signs out cleanly even when the session was already revoked (account deleted)', async () => {
    const { adapter, clerk } = fakeClerk();
    clerk.signOut.mockRejectedValue(apiError('session_not_found', 404));
    await expect(adapter.signOut()).resolves.toBeUndefined();
  });

  it('reports a Clerk that never loads instead of hanging', async () => {
    vi.useFakeTimers();
    const { adapter, clerk } = fakeClerk();
    clerk.loaded = false;
    const pending = adapter.current();
    vi.advanceTimersByTime(15_000);
    await expect(pending).rejects.toThrow(/did not load/);
    vi.useRealTimers();
  });
});

it('words a network failure as a connection problem', () => {
  expect(friendlyClerkError(new TypeError('Failed to fetch'))).toMatch(/Check your connection/);
});
