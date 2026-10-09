/**
 * `/sso-callback`, where Clerk finishes the web Google redirect.
 *
 * With a publishable key the route renders Clerk's callback handler, pointed
 * back at /account; without one the route does not exist. Clerk's component is
 * mocked — what it does with Google is Clerk's, and is verified live, not here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { App } from '../src/App.js';
import { renderWith } from './helpers.js';

vi.mock('@clerk/react', () => ({
  AuthenticateWithRedirectCallback: (props: Record<string, string>) => (
    <p>
      clerk-callback {props.signInFallbackRedirectUrl} {props.signUpFallbackRedirectUrl}
    </p>
  ),
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useClerk: () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('/sso-callback', () => {
  it('hands the Google redirect to Clerk, returning to /account', async () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_synthetic');
    renderWith(<App />, { route: '/sso-callback' });
    expect(await screen.findByText('clerk-callback /account /account')).toBeTruthy();
  });

  it('does not exist without Clerk configured', async () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    renderWith(<App />, { route: '/sso-callback' });
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.queryByText(/clerk-callback/)).toBeNull();
  });
});
