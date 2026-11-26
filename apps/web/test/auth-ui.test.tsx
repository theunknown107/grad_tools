/**
 * The auth and account screens, and account-bound local storage.
 *
 * Authority: docs/12 §12.14 · docs/28 §28.13 · M9 §23, §36, §37, §38, §62
 *
 * SYNTHETIC ACCOUNTS ONLY. No real address, no real password — and there is no
 * password anywhere in GradTools to test, because the identity provider owns
 * them entirely (M9 §66).
 *
 * The most important test in this file is the last one: two accounts on one
 * browser must not be able to see each other's records.
 */

/*
 * A real IndexedDB implementation, because these tests are about which KEYS
 * data lands under. A mocked repository would prove nothing about account
 * isolation — the isolation IS the key layout (M9 §38).
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { SignInPage } from '../src/features/auth/SignInPage.js';
import { SignUpPage } from '../src/features/auth/SignUpPage.js';
import { ResetPasswordPage } from '../src/features/auth/ResetPasswordPage.js';
import { AccountPage } from '../src/features/auth/AccountPage.js';
import { DiagnosticsPage } from '../src/features/diagnostics/DiagnosticsPage.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import type { Identity } from '../src/domain/auth.js';
import { createLocalRepositories } from '../src/repositories/local/index.js';
import { readValue, scopePrefix, writeValue } from '../src/repositories/local/store.js';

/** A stand-in provider. Records what was asked of it; verifies nothing. */
function fakeAdapter(initial: Identity | null = null): AuthAdapter & { calls: string[] } {
  let identity = initial;
  const listeners: ((identity: Identity | null) => void)[] = [];
  const calls: string[] = [];

  return {
    calls,
    async current() {
      return identity;
    },
    async accessToken() {
      return identity === null ? null : 'synthetic-token';
    },
    async signInWithPassword(email) {
      calls.push(`signIn:${email}`);
      identity = { userId: 'user-a', email, provider: 'email' };
      for (const listener of listeners) listener(identity);
      return { error: null };
    },
    async signUpWithPassword(email) {
      calls.push(`signUp:${email}`);
      return { error: null, needsConfirmation: true };
    },
    async signInWithProvider(provider) {
      calls.push(`oauth:${provider}`);
      return { error: null };
    },
    async signUpWithProvider(provider) {
      calls.push(`oauth-signup:${provider}`);
      return { error: null };
    },
    async sendRecovery(email) {
      calls.push(`recover:${email}`);
      return { error: null };
    },
    async updatePassword() {
      calls.push('updatePassword');
      return { error: null };
    },
    async completeDeepLink() {
      calls.push('completeDeepLink');
      return { error: null };
    },
    async signOut() {
      calls.push('signOut');
      identity = null;
      for (const listener of listeners) listener(null);
    },
    onChange(listener) {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    onPasswordRecovery() {
      return () => {
        /* No recovery events are simulated here; the reset test uses a session. */
      };
    },
  };
}

function renderAuth(ui: React.ReactElement, adapter: AuthAdapter | null, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider adapter={adapter}>
            <Routes>
              <Route path="*" element={ui} />
            </Routes>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Account → Settings → Data & privacy, where sign-in, sync and deletion live. */
const DATA = '/account?section=data';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Signing in                                                                 */
/* -------------------------------------------------------------------------- */

describe('the sign-in screen', () => {
  it('offers Google and email, and no longer Apple', async () => {
    renderAuth(<SignInPage />, fakeAdapter());

    expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue with Apple/i })).toBeNull();
    expect(screen.queryByText(/apple/i)).toBeNull();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('calls the Google provider when its button is used', async () => {
    const adapter = fakeAdapter();
    renderAuth(<SignInPage />, adapter);

    await userEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    expect(adapter.calls).toContain('oauth:google');
  });

  it('toggles password visibility without submitting the form', async () => {
    renderAuth(<SignInPage />, fakeAdapter());

    const password = await screen.findByLabelText('Password');
    expect(password.getAttribute('type')).toBe('password');

    const show = screen.getByRole('button', { name: 'Show password' });
    // A show/hide control must never be a submit button.
    expect(show.getAttribute('type')).toBe('button');

    await userEvent.click(show);
    expect(password.getAttribute('type')).toBe('text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.getAttribute('type')).toBe('password');
  });

  /*
   * SIGNING IN IS NOT CONSENT TO UPLOAD, and the screen says so before the
   * student acts (M9 §51, §52).
   */
  it('says plainly that nothing is uploaded by signing in', async () => {
    renderAuth(<SignInPage />, fakeAdapter());
    const explainer = await screen.findByText(/uploads nothing by itself/i);
    expect(explainer.textContent).toContain('You choose');
  });

  it('makes staying local a real, visible option (local-first: an account is optional)', async () => {
    renderAuth(<SignInPage />, fakeAdapter());
    expect(await screen.findByText(/Keep using GradTools without an account/)).toBeTruthy();
  });

  /*
   * ACCOUNT ENUMERATION (M9 §23, §48). The recovery form must answer the same
   * way whether or not the address exists.
   */
  it('never reveals whether an email has an account', async () => {
    const adapter = fakeAdapter();
    renderAuth(<SignInPage />, adapter);

    await userEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    const message = await screen.findByText(/If that address has an account/);
    expect(message.textContent).toContain('If that address has an account');
    expect(message.textContent).not.toMatch(/not found|no account|does not exist/i);
  });

  it('asks for a new password when creating an account, with no app-imposed length rule', async () => {
    renderAuth(<SignUpPage />, fakeAdapter());

    const password = await screen.findByLabelText('Password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    // No native `minlength` (it fired a browser bubble that blocked valid input)
    // and no app-invented "at least N characters" hint — the provider owns the policy.
    expect(password.getAttribute('minlength')).toBeNull();
    expect(screen.queryByText(/at least \d+ characters/i)).toBeNull();
  });

  /*
   * REGRESSION (the 15-char sign-in block). A sign-in must never be held to the
   * NEW-password minimum: an existing password shorter than the current policy
   * (14 chars here, policy 15) must still reach the authentication layer.
   */
  it('lets an existing short password sign in, unblocked by the new-password minimum', async () => {
    const adapter = fakeAdapter();
    renderAuth(<SignInPage />, adapter);

    await userEvent.type(screen.getByLabelText(/^email$/i), 'demo@example.test');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'fourteen-chars');
    expect('fourteen-chars'.length).toBe(14);
    // No native minLength attribute to block submission.
    expect(screen.getByLabelText(/^password$/i).getAttribute('minlength')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(adapter.calls).toContain('signIn:demo@example.test'));
  });

  /*
   * CREATE no longer enforces any app-side length rule: a short password is sent
   * straight to the provider, which owns the policy and returns its own error.
   */
  it('sends a short new password to the provider instead of blocking it', async () => {
    const adapter = fakeAdapter();
    renderAuth(<SignUpPage />, adapter);

    await userEvent.type(await screen.findByLabelText(/^email$/i), 'new@example.test');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'short'); // 5 chars, well under 15
    // No native minLength, no inline length gate.
    expect(screen.getByLabelText(/^password$/i).getAttribute('minlength')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));

    // The provider WAS called with the short password — the app did not block it.
    await waitFor(() => expect(adapter.calls).toContain('signUp:new@example.test'));
  });

  /* An empty password never reaches the provider — the field is `required`. */
  it('does not call the provider when the password is empty', async () => {
    const adapter = fakeAdapter();
    renderAuth(<SignUpPage />, adapter);

    await userEvent.type(await screen.findByLabelText(/^email$/i), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));

    expect(adapter.calls.some((c) => c.startsWith('signUp:'))).toBe(false);
  });

  /* A provider rejection is shown verbatim, not rephrased as local validation. */
  it("displays the provider's password rejection on sign-up", async () => {
    const rejection = 'That password was not accepted. Choose a longer or stronger one.';
    const adapter = Object.assign(fakeAdapter(), {
      signUpWithPassword: async (email: string) => {
        adapter.calls.push(`signUp:${email}`);
        return { error: rejection };
      },
    });
    renderAuth(<SignUpPage />, adapter);

    await userEvent.type(await screen.findByLabelText(/^email$/i), 'new@example.test');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));

    expect(await screen.findByText(rejection)).toBeTruthy();
  });

  /* A build with no provider says so rather than showing a form that cannot work. */
  it('says accounts are unavailable when no provider is configured', async () => {
    renderAuth(<SignInPage />, null);
    expect(await screen.findByText(/Accounts are not available in this build/)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('points new users to the separate sign-up screen', async () => {
    renderAuth(<SignInPage />, fakeAdapter());
    const link = await screen.findByRole('link', { name: 'Create account' });
    expect(link.getAttribute('href')).toBe('/sign-up');
  });
});

/* -------------------------------------------------------------------------- */
/* Signing up (the separate new-user journey)                                 */
/* -------------------------------------------------------------------------- */

describe('the sign-up screen', () => {
  it('offers a distinct "Sign up with Google" that uses the SIGN-UP provider flow', async () => {
    const adapter = fakeAdapter();
    renderAuth(<SignUpPage />, adapter);

    await userEvent.click(await screen.findByRole('button', { name: /Sign up with Google/ }));
    // The sign-up entry point, not the sign-in one — distinct from the Sign-In page.
    expect(adapter.calls).toContain('oauth-signup:google');
    expect(adapter.calls).not.toContain('oauth:google');
  });

  it('creates an account with email and password', async () => {
    const adapter = fakeAdapter();
    renderAuth(<SignUpPage />, adapter);

    await userEvent.type(await screen.findByLabelText('Email'), 'new@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'synthetic-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    await waitFor(() => expect(adapter.calls).toContain('signUp:new@example.test'));
  });

  it('links back to the sign-in screen for returning users', async () => {
    renderAuth(<SignUpPage />, fakeAdapter());
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/sign-in');
  });

  it('hides Google with a reason where the provider cannot work (Android)', async () => {
    renderAuth(
      <SignUpPage />,
      Object.assign(fakeAdapter(), {
        providerUnavailable: 'Not available in the Android app yet.',
      }),
    );
    expect(await screen.findByText('Not available in the Android app yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign up with Google/ })).toBeNull();
  });

  it('says accounts are unavailable when no provider is configured', async () => {
    renderAuth(<SignUpPage />, null);
    expect(await screen.findByText(/Accounts are not available in this build/)).toBeTruthy();
  });
});

/* A code-based provider (Clerk): confirmation and recovery finish on this card. */
describe('the sign-in screen with emailed codes', () => {
  function codeAdapter() {
    const base = fakeAdapter();
    return Object.assign(base, {
      async verifyCode(code: string) {
        base.calls.push(`verify:${code}`);
        return { error: null };
      },
      async resetWithCode(code: string) {
        base.calls.push(`reset:${code}`);
        return { error: null };
      },
    });
  }

  it('asks for the emailed code after creating an account', async () => {
    const adapter = codeAdapter();
    renderAuth(<SignUpPage />, adapter);
    await userEvent.type(await screen.findByLabelText('Email'), 'new@example.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'synthetic-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));

    const code = await screen.findByLabelText('Code from your email');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm code' }));
    await waitFor(() => expect(adapter.calls).toContain('verify:123456'));
  });

  it('resets with a code and a new password, without revealing the account', async () => {
    const adapter = codeAdapter();
    renderAuth(<SignInPage />, adapter);
    await userEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect((await screen.findByText(/If that address has an account/)).textContent).not.toMatch(
      /not found|no account/i,
    );
    await userEvent.type(screen.getByLabelText('Code from your email'), '654321');
    const password = screen.getByLabelText(/^New password/);
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    await userEvent.type(password, 'synthetic-new-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(adapter.calls).toContain('reset:654321'));
  });

  it('hides Google, with the reason, where the provider cannot work', async () => {
    renderAuth(
      <SignInPage />,
      Object.assign(fakeAdapter(), {
        providerUnavailable: 'Not available in the Android app yet.',
      }),
    );
    expect(await screen.findByText('Not available in the Android app yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Resetting a password                                                       */
/* -------------------------------------------------------------------------- */

describe('the reset-password screen', () => {
  const recovering: Identity = { userId: 'user-a', email: 'a@example.test', provider: 'email' };

  it('sets a new password from the recovery session, with a visibility toggle', async () => {
    const adapter = fakeAdapter(recovering);
    renderAuth(<ResetPasswordPage />, adapter, '/reset-password');

    const password = await screen.findByLabelText('New password');
    expect(password.getAttribute('type')).toBe('password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.getAttribute('type')).toBe('text');

    await userEvent.type(password, 'a-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(adapter.calls).toContain('updatePassword');
    });
    expect(await screen.findByText(/password has been changed/i)).toBeTruthy();
  });

  it('explains an expired link when there is no recovery session', async () => {
    renderAuth(<ResetPasswordPage />, fakeAdapter(null), '/reset-password');
    expect(await screen.findByText(/reset link is invalid or has already been used/i)).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The account screen                                                         */
/* -------------------------------------------------------------------------- */

describe('the account screen', () => {
  const identity: Identity = { userId: 'user-a', email: 'a@example.test', provider: 'google' };

  it('diagnostics: shows the real signed-in state even when the API cannot be read', async () => {
    // The API answers, but CORS hides the reply (fetch rejects; an opaque request resolves).
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.mode === 'no-cors') return new Response(null, { status: 200 });
        throw new TypeError('Failed to fetch');
      }),
    );
    renderAuth(<DiagnosticsPage />, fakeAdapter(identity));
    expect(await screen.findByText('signed_in')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Probe connectivity' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Probe authenticated /me' }));
    await waitFor(() =>
      expect(screen.getAllByText('Reachable, but CORS blocks this origin')).toHaveLength(2),
    );
    // A failed request never turns into a signed-out state.
    expect(screen.getByText('signed_in')).toBeTruthy();
    expect(screen.getByText(/refused this origin/i)).toBeTruthy();
  });

  it('diagnostics: when even an opaque request is blocked, it says the cause is ambiguous', async () => {
    // What the device saw: CORS hides the reply AND Cross-Origin-Resource-Policy
    // blocks the opaque retry, so every fetch rejects.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderAuth(<DiagnosticsPage />, fakeAdapter(identity));
    expect(await screen.findByText('signed_in')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Probe connectivity' }));
    expect(await screen.findByText('No readable reply (network, TLS or CORS)')).toBeTruthy();
    expect(
      screen.getByText(/cannot tell a network or TLS failure from a CORS refusal/i),
    ).toBeTruthy();
    expect(screen.queryByText(/Unreachable/)).toBeNull(); // never claims an outage it cannot see
    expect(screen.getByText('signed_in')).toBeTruthy();
  });

  it('diagnostics: a signed-out student has no token to send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    renderAuth(<DiagnosticsPage />, fakeAdapter(null));
    expect(await screen.findByText('signed_out')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Probe connectivity' }));
    expect(await screen.findByText('Reachable, token rejected (401)')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Probe authenticated /me' }));
    expect(await screen.findByText('No session — nothing to send')).toBeTruthy();
  });

  it('links to Authentication Diagnostics only in a diagnostic build', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity));
    await screen.findByText(/manage your academic configuration/i);
    expect(screen.queryByRole('link', { name: 'Authentication Diagnostics' })).toBeNull();
    cleanup();

    vi.stubEnv('VITE_DIAGNOSTICS', '1');
    try {
      renderAuth(<AccountPage />, fakeAdapter(identity));
      const link = await screen.findByRole('link', { name: 'Authentication Diagnostics' });
      expect(link.getAttribute('href')).toBe('/diagnostics');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('shows who is signed in, and how', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity), DATA);

    expect(await screen.findByText('Google')).toBeTruthy();
    /*
     * getAllByText: the reference rebuild puts the signed-in address in the
     * page header's metadata pill as well as in the body, so it appears twice
     * on purpose. The assertion still says the same thing — the screen shows
     * who is signed in — and no longer requires it be said exactly once.
     */
    expect(screen.getAllByText('a@example.test').length).toBeGreaterThan(0);
  });

  /*
   * THE PROMISE STUDENTS NEED BEFORE THEY DARE PRESS IT (M9 §36). Signing out
   * must not be assumed to delete anything.
   */
  it('says signing out keeps local records', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity), DATA);
    // Signing out lives in the default section, beside who is signed in.
    const text = await screen.findByText(/records saved on this device stay here/i);
    expect(text).toBeTruthy();
  });

  /*
   * WHAT DOES NOT LEAVE THIS DEVICE, SAID ON THE SCREEN THAT PROMISES SYNC.
   * The weekly timetable and the totals sync; the per-class record and
   * date-specific changes do not, in this version.
   */
  it('says which records stay on this device', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity), DATA);

    expect(
      await screen.findByText(/Per-class attendance history and date-specific timetable changes/i),
    ).toBeTruthy();
  });

  /* Deletion is never one click, and never the default (M9 §54). */
  it('requires a confirmation before deleting an account', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity), DATA);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete my account permanently/ })).toBeTruthy();
  });

  it('says deletion leaves the device copy alone', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity), DATA);
    expect(await screen.findByText(/copy on this device is not deleted/i)).toBeTruthy();
  });

  it('offers an export of the student’s own data', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity), DATA);
    expect(await screen.findByRole('button', { name: 'Download my data' })).toBeTruthy();
    expect(screen.getByText(/nobody else/i)).toBeTruthy();
  });

  /* An expired session is explained, not silently treated as a sign-out. */
  it('explains an expired session', async () => {
    const adapter = fakeAdapter();
    adapter.current = async () => {
      throw new Error('expired');
    };
    renderAuth(<AccountPage />, adapter, DATA);

    expect(await screen.findByText(/session could not be verified/i)).toBeTruthy();
  });

  it('shows no provider metadata beyond the provider’s name', async () => {
    const { container } = renderAuth(<AccountPage />, fakeAdapter(identity), DATA);
    await screen.findByText('Google');
    // The user id is an internal identifier and has no business on screen.
    expect(container.textContent).not.toContain('user-a');
    expect(container.textContent).not.toContain('synthetic-token');
  });

  /*
   * DISCOVERABILITY (the bug this covers). A signed-out student used to find
   * sign-in only inside the "Data & privacy" tab, which the page does not open
   * by default — so it was effectively invisible. Both actions must be on the
   * Account page the moment it opens, on the DEFAULT section, not a tab away.
   */
  it('shows Sign in and Create account at the top when signed out, on the default section', async () => {
    renderAuth(<AccountPage />, fakeAdapter(null));
    const signIn = await screen.findByRole('link', { name: 'Sign in' });
    expect(signIn.getAttribute('href')).toBe('/sign-in');
    const createAccount = screen.getByRole('link', { name: 'Create account' });
    expect(createAccount.getAttribute('href')).toBe('/sign-up');
  });

  it('does not offer sign-in when no provider is configured', async () => {
    renderAuth(<AccountPage />, null);
    await screen.findByText(/manage your academic configuration/i);
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull();
  });

  it('does not show the sign-in prompt to an already signed-in student', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity));
    await screen.findByText(/manage your academic configuration/i);
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Account-bound storage — the security property                              */
/* -------------------------------------------------------------------------- */

describe('two accounts on one browser', () => {
  /*
   * THE TEST THIS FILE EXISTS FOR (M9 §37). Before M9 there was one key per
   * collection; two people sharing a laptop would have found each other's
   * semesters under it.
   */
  it('gives each account a separate key space', () => {
    expect(scopePrefix('user-a')).not.toBe(scopePrefix('user-b'));
    expect(scopePrefix(null)).not.toBe(scopePrefix('user-a'));
  });

  it('never shows one account’s records to another', async () => {
    const a = createLocalRepositories('user-a');
    const b = createLocalRepositories('user-b');

    await a.semesters.upsert({
      id: 's1',
      profileId: 'p-a',
      number: 5,
      status: 'in_progress',
      startedOn: null,
      completedOn: null,
      updatedAt: '2026-01-01T00:00:00Z',
    } as never);

    expect(await a.semesters.list()).toHaveLength(1);
    expect(await b.semesters.list()).toHaveLength(0);
  });

  /* And the anonymous scope is a third, independent one. */
  it('keeps pre-account data separate from every account', async () => {
    const anonymous = createLocalRepositories(null);
    const account = createLocalRepositories('user-a');

    await anonymous.attendance.upsert({
      id: 'a1',
      profileId: 'p',
      semester: 5,
      subjectCode: 'BCS501',
      subjectTitle: 'DBMS',
      attended: 12,
      conducted: 20,
      updatedAt: '2026-01-01T00:00:00Z',
    } as never);

    expect(await anonymous.attendance.list()).toHaveLength(1);
    expect(await account.attendance.list()).toHaveLength(0);
  });

  /*
   * B OF THE M9 BOUNDARY: AUTHENTICATION IS NOT CONSENT TO UPLOAD (M9 §52).
   *
   * Signing in establishes who somebody is. What happens to the records already
   * on the device is a separate decision they make on the first-sync screen,
   * and until they make it nothing leaves the machine.
   */
  it('uploads nothing merely because a sign-in succeeded', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );

    /* Records on the device, and a student who then signs in. */
    await writeValue(null, 'profile', { id: 'p-anon', schemeId: 'vtu-2022' });
    const adapter = fakeAdapter();
    renderAuth(<SignInPage />, adapter);

    await userEvent.type(screen.getByLabelText(/^email$/i), 'demo@example.test');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'synthetic-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(adapter.calls).toContain('signIn:demo@example.test');
    });

    /* Nothing was pushed, and the anonymous copy is untouched. */
    expect(requests.filter((call) => call.startsWith('POST') && call.includes('/me/'))).toEqual([]);
    expect(await readValue(null, 'profile')).not.toBeNull();
    vi.unstubAllGlobals();
  });

  /*
   * G AND H, AT THE STORAGE LAYER. The per-class ledger and the date-specific
   * overrides are device-local in this phase: an account changes which scope
   * they are written under, and nothing else. Adding them to the synced
   * collections would reintroduce the two-writer model the v1 attendance rule
   * exists to prevent (domain/attendance, test/auth-boundaries.test.ts).
   */
  it('keeps the attendance ledger and date overrides in their own scope', async () => {
    const anonymous = createLocalRepositories(null);
    const account = createLocalRepositories('user-a');

    await anonymous.attendanceLedger.upsert({
      kind: 'opening',
      id: 'opening:BCS501',
      subjectCode: 'BCS501',
      attended: 8,
      conducted: 10,
      migratedFrom: null,
      reconciliation: 'exact',
      unreconciledMarks: [],
      createdAt: '2026-01-01T00:00:00Z',
    } as never);
    await anonymous.timetableOverrides.upsert({
      id: '2026-09-16:class-1',
      profileId: 'p',
      date: '2026-09-16',
      classId: 'class-1',
      status: 'cancelled',
      addition: null,
      replacedBy: null,
      createdAt: '2026-09-16T08:00:00Z',
    } as never);

    expect(await anonymous.attendanceLedger.list()).toHaveLength(1);
    expect(await anonymous.timetableOverrides.list()).toHaveLength(1);
    /* An account sees its own, empty, ledger — never the other scope's. */
    expect(await account.attendanceLedger.list()).toHaveLength(0);
    expect(await account.timetableOverrides.list()).toHaveLength(0);
  });

  /*
   * SIGNING OUT DELETES NOTHING (M9 §36). The data is still under the account's
   * scope when they come back.
   */
  it('leaves an account’s records in place after signing out', async () => {
    await writeValue('user-a', 'profile', { id: 'p-a', schemeId: 'vtu-2022' });

    const adapter = fakeAdapter({ userId: 'user-a', email: null, provider: 'email' });
    renderAuth(<AccountPage />, adapter, DATA);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(adapter.calls).toContain('signOut');
    });
    expect(await readValue('user-a', 'profile')).not.toBeNull();
  });
});
