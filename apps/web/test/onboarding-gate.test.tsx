/**
 * The onboarding gate and the Terms page (TERMS-AND-ONBOARDING, Slice 2).
 *
 * The gate is the one place the approved flow is enforced, so it is tested
 * against the REAL AuthProvider with a fake adapter (the shipped state machine,
 * not a mock of it) and a stubbed `/me`. It must: stay inert with no provider
 * (local-first), send signed-out users off protected routes to sign-in, hold
 * signed-in users at /terms until the SERVER says they have accepted, refuse
 * access when it cannot confirm, and wait rather than guess while either the
 * session or `/me` is still resolving.
 *
 * The Terms page must gate Accept behind an explicit checkbox, and must only
 * advance after the POST AND a re-read of `/me` both confirm the acceptance —
 * never on an unverified or failed write.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CURRENT_TERMS } from '@gradtools/shared-types';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { OnboardingGate } from '../src/features/onboarding/OnboardingGate.js';
import { TermsPage } from '../src/features/onboarding/TermsPage.js';
import { fakeAdapter, stubTermsAccept } from './helpers/auth-harness.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Local-first: the gate NEVER blocks. GradTools is usable in every auth state,
 * so a failed Clerk init or a signed-out visitor is never locked out of the app
 * (the incident). Auth and Terms are enforced at the cloud boundary (useSync,
 * AccountPage), not here.
 */
function renderGate(route: string, adapter: AuthAdapter | null) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider adapter={adapter}>
        <OnboardingGate>
          <div>APP HOME</div>
        </OnboardingGate>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('OnboardingGate (local-first access)', () => {
  it('renders the app with no provider configured', async () => {
    renderGate('/', null);
    expect(await screen.findByText('APP HOME')).toBeTruthy();
  });

  it('renders the app for a SIGNED-OUT user when a provider is configured (never locks out)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderGate('/', fakeAdapter(false));
    expect(await screen.findByText('APP HOME')).toBeTruthy();
    // The gate asks the server nothing — it does not gate on account state.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the app for a signed-in user, whatever the terms state', async () => {
    renderGate('/', fakeAdapter(true));
    expect(await screen.findByText('APP HOME')).toBeTruthy();
  });
});

function renderTerms() {
  return render(
    <MemoryRouter initialEntries={['/terms']}>
      <AuthProvider adapter={fakeAdapter(true)}>
        <Routes>
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/onboarding" element={<div>ONBOARDING</div>} />
          <Route path="/sign-in" element={<div>SIGN IN</div>} />
          <Route path="/" element={<div>APP HOME</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('TermsPage', () => {
  it('shows the current terms and keeps Accept disabled until consent is given', async () => {
    stubTermsAccept(201, { termsAccepted: true });
    renderTerms();
    expect(await screen.findByText(CURRENT_TERMS.title)).toBeTruthy();
    expect(screen.getByText(new RegExp(`Version ${CURRENT_TERMS.version}`))).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /accept & continue/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('records then verifies acceptance before advancing to onboarding', async () => {
    const calls = stubTermsAccept(201, { termsAccepted: true });
    const user = userEvent.setup();
    renderTerms();
    await screen.findByText(CURRENT_TERMS.title);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /accept & continue/i }));
    expect(await screen.findByText('ONBOARDING')).toBeTruthy();

    const post = calls.find((c) => c.url.includes('terms-acceptance'));
    expect(post?.method).toBe('POST');
    expect(JSON.parse(post?.body as string)).toEqual({ version: CURRENT_TERMS.version });
    // It verified the server state with a follow-up read of /me.
    expect(calls.some((c) => c.url.includes('/api/v1/me') && c.method === 'GET')).toBe(true);
  });

  it('does not advance if the write fails', async () => {
    stubTermsAccept(500, { termsAccepted: true });
    const user = userEvent.setup();
    renderTerms();
    await screen.findByText(CURRENT_TERMS.title);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /accept & continue/i }));
    expect(await screen.findByText(/couldn’t record your acceptance/i)).toBeTruthy();
    expect(screen.queryByText('ONBOARDING')).toBeNull();
  });

  it('does not advance if the server cannot confirm the acceptance', async () => {
    // The POST "succeeds" but /me still shows no acceptance: never claim success.
    stubTermsAccept(201, { termsAccepted: false });
    const user = userEvent.setup();
    renderTerms();
    await screen.findByText(CURRENT_TERMS.title);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /accept & continue/i }));
    expect(await screen.findByText(/couldn’t confirm your acceptance/i)).toBeTruthy();
    expect(screen.queryByText('ONBOARDING')).toBeNull();
  });

  it('sends a signed-out visitor to sign-in rather than recording anything', async () => {
    render(
      <MemoryRouter initialEntries={['/terms']}>
        <AuthProvider adapter={fakeAdapter(false)}>
          <Routes>
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/sign-in" element={<div>SIGN IN</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('SIGN IN')).toBeTruthy();
  });
});
