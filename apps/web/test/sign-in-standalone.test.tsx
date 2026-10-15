/**
 * The sign-in screen is the standalone gate (CLERK-AUTH-MIGRATION-V1).
 *
 * When a provider is configured the app is locked behind sign-in, so the screen
 * must not offer a "keep using GradTools without an account" escape — that link
 * led to a page the gate immediately bounced back, and it contradicts a build
 * whose features require an account. The real `SignInPage` is rendered with a
 * signed-out adapter (the shipped component, not a mock).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { SignInPage } from '../src/features/auth/SignInPage.js';
import { fakeAdapter } from './helpers/auth-harness.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';

afterEach(cleanup);

function renderSignIn(adapter: AuthAdapter = fakeAdapter(false)) {
  return render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <AuthProvider adapter={adapter}>
        <SignInPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** A signed-out adapter that advertises a 15-char new-password policy (Clerk). */
const POLICY_15: AuthAdapter = { ...fakeAdapter(false), passwordMinLength: 15 };

describe('standalone sign-in', () => {
  it('shows the sign-in form', async () => {
    renderSignIn();
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });

  it('offers a local-first way back to the app (an account is optional)', () => {
    renderSignIn();
    expect(screen.getByRole('link', { name: /keep using gradtools/i })).toBeTruthy();
  });
});

describe('password guidance reflects the provider policy', () => {
  it('states the real minimum when creating an account (15, not 8)', async () => {
    const user = userEvent.setup();
    renderSignIn(POLICY_15);
    await user.click(screen.getByRole('radio', { name: /create/i }));
    expect(await screen.findByText(/at least 15 characters/i)).toBeTruthy();
    expect(screen.queryByText(/eight characters/i)).toBeNull();
  });

  it('does NOT hold an existing password to the new-password minimum on sign-in', () => {
    renderSignIn(POLICY_15); // default mode is sign_in
    const password = screen.getByLabelText<HTMLInputElement>(/^password$/i);
    // No client-side 15-char gate on an existing credential (it may predate the policy).
    expect(password.getAttribute('minlength')).not.toBe('15');
  });

  it('falls back to a sensible default when the provider states no policy', async () => {
    const user = userEvent.setup();
    renderSignIn(); // fakeAdapter has no passwordMinLength
    await user.click(screen.getByRole('radio', { name: /create/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeTruthy();
  });
});
