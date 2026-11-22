/**
 * Signed out is not "no results". After a sign-out the dashboard reads the
 * anonymous scope, and used to tell a student whose records were safely stored
 * under their account that "No results are saved yet". These prove it now says
 * they are signed out and their records are still here — without reading or
 * showing a single one of them (M9 §37) — and that every genuinely empty case
 * still gets the empty state. Real AuthProvider, real scoped storage.
 */

import 'fake-indexeddb/auto';
import '@capacitor/core'; // installs its own window.Capacitor first (see offline-sign-out.test)
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { MemoryRouter } from 'react-router-dom';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { Identity } from '../src/domain/auth.js';
import type { SemesterResult } from '../src/domain/types.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import { createLocalRepositories } from '../src/repositories/local/index.js';
import { fakeAdapter } from './helpers/auth-harness.js';

const EMPTY = /No results are saved yet/;
const SIGNED_OUT = /You’re signed out\./;
const A_RECORDS = /1 semester graded/;

const A: Identity = { userId: 'user_account_a', email: null, provider: 'email' };
const B: Identity = { userId: 'user_account_b', email: null, provider: 'email' };

function result(): SemesterResult {
  return {
    id: 'r1',
    profileId: asStudentProfileId('11111111-1111-1111-1111-111111111111'),
    semester: 1,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: [
      normalizeResultSubject({
        id: 's-BMATS101',
        subjectCode: 'BMATS101',
        subjectTitle: 'Mathematics I',
        internal: 46,
        external: 34,
        total: 80,
        resultStatus: null,
        credits: 4,
        gradeLetter: null,
        hasSee: true,
        provenance: 'catalogue',
      }),
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** A provider whose session is `who` (null: signed out). */
function as(who: Identity | null): AuthAdapter {
  return { ...fakeAdapter(who !== null), current: async () => who };
}

function open(adapter: AuthAdapter | null) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider adapter={adapter}>
            <DashboardPage />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.removeItem('gradtools:v1:sign-out-pending');
});

describe('signed out, with an account’s records on this device', () => {
  it('says so — not "No results are saved yet" — and offers Sign in', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    open(as(null));

    expect(await screen.findByText(SIGNED_OUT)).toBeTruthy();
    expect(screen.getByText(/records are still saved on this device/)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn.getAttribute('href')).toBe('/sign-in');
  });

  it('shows none of that account’s data, and keeps all of it', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    open(as(null));

    await screen.findByText(SIGNED_OUT);
    expect(screen.queryByText(A_RECORDS)).toBeNull();
    expect(await createLocalRepositories(A.userId).results.list()).toHaveLength(1);
  });

  it('still says so after a restart while offline, with the sign-out pending', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    window.localStorage.setItem('gradtools:v1:sign-out-pending', '1');
    open({ ...fakeAdapter(true), current: () => Promise.reject(new Error('Clerk did not load')) });

    expect(await screen.findByText(SIGNED_OUT)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('signing back in to that account shows its records again', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    open(as(A));

    expect(await screen.findByText(A_RECORDS)).toBeTruthy();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
  });
});

describe('every genuinely empty case still gets the empty state', () => {
  it('a new student with nothing saved anywhere', async () => {
    open(as(null));
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
  });

  it('a signed-in account that really has no results — even with another account’s on the device', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    open(as(B));

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
    expect(screen.queryByText(A_RECORDS)).toBeNull();
  });

  it('a build with no accounts at all', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    open(null);
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
  });
});

describe('a brand-new user is told what GradTools is', () => {
  it('shows the welcome and the first action when nothing is saved anywhere', async () => {
    open(as(null));
    expect(await screen.findByText('Welcome to GradTools')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Add your first result/ }).getAttribute('href')).toBe(
      '/import',
    );
  });

  it('does not welcome a signed-out user whose records are on the device', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    open(as(null));
    await screen.findByText(SIGNED_OUT);
    expect(screen.queryByText('Welcome to GradTools')).toBeNull();
  });

  it('does not welcome a signed-in account that already has results', async () => {
    await createLocalRepositories(A.userId).results.upsert(result());
    open(as(A));
    await screen.findByText(A_RECORDS);
    expect(screen.queryByText('Welcome to GradTools')).toBeNull();
  });
});

describe('the genuinely-new dashboard drops empty metric sections', () => {
  it('a brand-new local user sees no Academic Standing strip or Today section', async () => {
    open(as(null));
    await screen.findByText('Welcome to GradTools');
    expect(screen.queryByTestId('standing-strip')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull();
  });

  it('a signed-in empty account keeps the full dashboard (its emptiness means something else)', async () => {
    open(as(A));
    await screen.findByText(EMPTY);
    expect(screen.queryByTestId('standing-strip')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Today' })).not.toBeNull();
  });
});
