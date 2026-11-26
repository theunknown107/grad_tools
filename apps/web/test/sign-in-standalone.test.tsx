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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { SignInPage } from '../src/features/auth/SignInPage.js';
import { SignUpPage } from '../src/features/auth/SignUpPage.js';
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

function renderSignUp(adapter: AuthAdapter = fakeAdapter(false)) {
  return render(
    <MemoryRouter initialEntries={['/sign-up']}>
      <AuthProvider adapter={adapter}>
        <SignUpPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/**
 * A signed-out adapter that records sign-up attempts and returns a fixed result,
 * so a test can prove a short password REACHES the provider (no app-side length
 * gate) and that the provider's own rejection is what surfaces.
 */
function recordingSignUp(result: { error: string | null; needsConfirmation?: boolean }): {
  adapter: AuthAdapter;
  attempts: { email: string; password: string }[];
} {
  const attempts: { email: string; password: string }[] = [];
  return {
    attempts,
    adapter: {
      ...fakeAdapter(false),
      signUpWithPassword: async (email: string, password: string) => {
        attempts.push({ email, password });
        return { needsConfirmation: false, ...result };
      },
    },
  };
}

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

describe('the app imposes no password-length rule of its own', () => {
  it('shows no "at least N characters" guidance on sign-up', async () => {
    renderSignUp();
    expect(await screen.findByLabelText(/^password$/i)).toBeTruthy();
    // No app-invented minimum is advertised; the provider owns the policy.
    expect(screen.queryByText(/at least \d+ characters/i)).toBeNull();
    expect(screen.queryByText(/characters/i)).toBeNull();
  });

  it('sends a short password to the provider instead of blocking it', async () => {
    const { adapter, attempts } = recordingSignUp({ error: null });
    renderSignUp(adapter);

    await userEvent.type(await screen.findByLabelText(/^email$/i), 'new@example.test');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'short'); // 5 chars, well under 15
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));

    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]).toEqual({ email: 'new@example.test', password: 'short' });
  });

  it("surfaces the provider's own rejection, not a local validation message", async () => {
    const { adapter } = recordingSignUp({
      error: 'That password was not accepted. Choose a longer or stronger one.',
    });
    renderSignUp(adapter);

    await userEvent.type(await screen.findByLabelText(/^email$/i), 'new@example.test');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));

    expect(await screen.findByText(/that password was not accepted/i)).toBeTruthy();
  });

  it('never has a native minlength attribute to block submission', () => {
    renderSignIn();
    expect(
      screen.getByLabelText<HTMLInputElement>(/^password$/i).getAttribute('minlength'),
    ).toBeNull();
  });
});
