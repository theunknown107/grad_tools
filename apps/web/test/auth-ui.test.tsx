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
import { SignInPage } from '../src/features/auth/SignInPage.js';
import { AccountPage } from '../src/features/auth/AccountPage.js';
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
    async sendRecovery(email) {
      calls.push(`recover:${email}`);
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
  };
}

function renderAuth(ui: React.ReactElement, adapter: AuthAdapter | null, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider adapter={adapter}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Signing in                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * M9.6F split the account page into sections with a navigation rail, so only
 * one concern is on screen at a time. These tests open the section they are
 * about first; every assertion below is otherwise unchanged.
 */
async function openSection(name: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name }));
}

describe('the sign-in screen', () => {
  it('offers Google, Apple and email', async () => {
    renderAuth(<SignInPage />, fakeAdapter());

    expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue with Apple/ })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  /*
   * SIGNING IN IS NOT CONSENT TO UPLOAD, and the screen says so before the
   * student acts (M9 §51, §52).
   */
  it('says plainly that nothing is uploaded by signing in', async () => {
    renderAuth(<SignInPage />, fakeAdapter());
    const explainer = await screen.findByText(/upload anything on its own/i);
    expect(explainer.textContent).toContain('not');
  });

  it('makes staying local a real, visible option', async () => {
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

    await userEvent.click(await screen.findByRole('button', { name: /Forgotten your password/ }));
    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Recover your account' }));

    const message = await screen.findByText(/If that address has an account/);
    expect(message.textContent).toContain('If that address has an account');
    expect(message.textContent).not.toMatch(/not found|no account|does not exist/i);
  });

  it('asks for a new password when creating an account', async () => {
    renderAuth(<SignInPage />, fakeAdapter());
    await userEvent.click(await screen.findByRole('button', { name: 'Create an account' }));

    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(password.getAttribute('minlength')).toBe('8');
  });

  /* A build with no provider says so rather than showing a form that cannot work. */
  it('says accounts are unavailable when no provider is configured', async () => {
    renderAuth(<SignInPage />, null);
    expect(await screen.findByText(/Accounts are not available in this build/)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The account screen                                                         */
/* -------------------------------------------------------------------------- */

describe('the account screen', () => {
  const identity: Identity = { userId: 'user-a', email: 'a@example.test', provider: 'google' };

  it('shows who is signed in, and how', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity));

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
    renderAuth(<AccountPage />, fakeAdapter(identity));
    await openSection(/^Session$/);
    const text = await screen.findByText(/records saved on this device stay here/i);
    expect(text).toBeTruthy();
  });

  /* Deletion is never one click, and never the default (M9 §54). */
  it('requires a confirmation before deleting an account', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity));

    await openSection(/^Delete account$/);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete my account permanently/ })).toBeTruthy();
  });

  it('says deletion leaves the device copy alone', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity));
    await openSection(/^Delete account$/);
    expect(await screen.findByText(/copy on this device is not deleted/i)).toBeTruthy();
  });

  it('offers an export of the student’s own data', async () => {
    renderAuth(<AccountPage />, fakeAdapter(identity));
    await openSection(/^Your data$/);
    expect(await screen.findByRole('button', { name: 'Download my data' })).toBeTruthy();
    expect(screen.getByText(/nobody else/i)).toBeTruthy();
  });

  /* An expired session is explained, not silently treated as a sign-out. */
  it('explains an expired session', async () => {
    const adapter = fakeAdapter();
    adapter.current = async () => {
      throw new Error('expired');
    };
    renderAuth(<AccountPage />, adapter);

    expect(await screen.findByText(/session has expired/i)).toBeTruthy();
  });

  it('shows no provider metadata beyond the provider’s name', async () => {
    const { container } = renderAuth(<AccountPage />, fakeAdapter(identity));
    await screen.findByText('Google');
    // The user id is an internal identifier and has no business on screen.
    expect(container.textContent).not.toContain('user-a');
    expect(container.textContent).not.toContain('synthetic-token');
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
   * SIGNING OUT DELETES NOTHING (M9 §36). The data is still under the account's
   * scope when they come back.
   */
  it('leaves an account’s records in place after signing out', async () => {
    await writeValue('user-a', 'profile', { id: 'p-a', schemeId: 'vtu-2022' });

    const adapter = fakeAdapter({ userId: 'user-a', email: null, provider: 'email' });
    renderAuth(<AccountPage />, adapter);
    await userEvent.click(await screen.findByRole('button', { name: /^Session$/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(adapter.calls).toContain('signOut');
    });
    expect(await readValue('user-a', 'profile')).not.toBeNull();
  });
});
