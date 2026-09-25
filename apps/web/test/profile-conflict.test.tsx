/**
 * Account → Data & privacy offers a profile conflict an explicit, confirmed
 * choice: both versions' differing fields, then "Keep this device's" or
 * "Use account version" (useSync.resolveProfileConflict).
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { AccountPage } from '../src/features/auth/AccountPage.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import type { Identity } from '../src/domain/auth.js';

const resolveProfileConflict = vi.fn(() => Promise.resolve());

vi.mock('../src/features/auth/useSync.js', () => ({
  useSync: () => ({
    state: {
      status: 'conflicts',
      cursor: null,
      lastSyncedAt: null,
      error: null,
      conflicts: [
        {
          id: 'profile',
          collection: 'profile',
          reason: 'Your profile changed on another device and on this one.',
          local: { displayName: 'Edited here', admissionYear: 2022, entryRoute: 'puc' },
          server: { displayName: 'Another device', admissionYear: 2023, entryRoute: 'diploma' },
        },
      ],
    },
    syncNow: vi.fn(),
    resolveProfileConflict,
    exportData: vi.fn(),
    deleteAccount: vi.fn(),
  }),
}));

const identity: Identity = { userId: 'user-a', email: 'a@example.test', provider: 'google' };
const adapter: AuthAdapter = {
  current: async () => identity,
  accessToken: async () => 'synthetic-token',
  signInWithPassword: async () => ({ error: null }),
  signUpWithPassword: async () => ({ error: null, needsConfirmation: true }),
  signInWithProvider: async () => ({ error: null }),
  sendRecovery: async () => ({ error: null }),
  signOut: async () => {},
  onChange: () => () => {},
};

afterEach(cleanup);

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/account?section=data']}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider adapter={adapter}>
            <Routes>
              <Route path="*" element={<AccountPage />} />
            </Routes>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('a profile conflict on the account page', () => {
  it('shows both versions of each differing field with readable labels', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    for (const [label, mine, theirs] of [
      ['Name', 'Edited here', 'Another device'],
      ['Admission year', '2022', '2023'],
      ['Entry route', 'PUC', 'Diploma'],
    ] as const) {
      const row = within(table).getByRole('row', { name: new RegExp(`^${label}`) });
      expect(within(row).getByText(mine)).toBeTruthy();
      expect(within(row).getByText(theirs)).toBeTruthy();
    }
    /* Fields both sides agree on are not listed. */
    expect(within(table).queryByRole('row', { name: /^Expected passout year/ })).toBeNull();
  });

  it('asks for confirmation, then resolves with the chosen side', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Use account version' }));
    expect(resolveProfileConflict).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Use account version' }));
    expect(resolveProfileConflict).toHaveBeenCalledWith('take_theirs');

    await user.click(await screen.findByRole('button', { name: 'Keep this device’s' }));
    const second = await screen.findByRole('alertdialog');
    await user.click(within(second).getByRole('button', { name: 'Keep this device’s' }));
    expect(resolveProfileConflict).toHaveBeenLastCalledWith('keep_mine');
  });
});
