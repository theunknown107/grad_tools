/**
 * The first run on a new device: Terms, then Sign in / Sign up, then the app,
 * asked once — and never a lock-out.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_TERMS } from '@gradtools/shared-types';
import { OnboardingGate } from '../src/features/onboarding/OnboardingGate.js';
import {
  FIRST_RUN_DONE_KEY,
  TERMS_ACCEPTED_KEY,
  firstRunStep,
  markFirstRunDone,
  markTermsAccepted,
} from '../src/lib/first-run.js';

function app() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/terms" element={<p>Terms screen</p>} />
        <Route path="/sign-in" element={<p>Sign-in screen</p>} />
        <Route
          path="/"
          element={
            <OnboardingGate>
              <p>Dashboard</p>
            </OnboardingGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a new device', () => {
  beforeEach(() => {
    window.localStorage.removeItem(TERMS_ACCEPTED_KEY);
    window.localStorage.removeItem(FIRST_RUN_DONE_KEY);
  });

  it('shows the Terms first', () => {
    expect(firstRunStep()).toBe('terms');
    app();
    expect(screen.getByText('Terms screen')).toBeTruthy();
  });

  it('then Sign in / Sign up, once the Terms are accepted', () => {
    markTermsAccepted();
    expect(window.localStorage.getItem(TERMS_ACCEPTED_KEY)).toBe(CURRENT_TERMS.version);
    app();
    expect(screen.getByText('Sign-in screen')).toBeTruthy();
  });

  it('then the app, and never asks again on this device', () => {
    markTermsAccepted();
    markFirstRunDone();
    app();
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(firstRunStep()).toBeNull();
  });

  it('asks again when the Terms change version', () => {
    window.localStorage.setItem(TERMS_ACCEPTED_KEY, 'an-older-version');
    markFirstRunDone();
    expect(firstRunStep()).toBe('terms');
  });
});
