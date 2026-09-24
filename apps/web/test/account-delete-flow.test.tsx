/**
 * Export and deletion are two actions with two outcomes, and each outcome is
 * shown where its action lives: an export failure in the "Your data" card, a
 * deletion failure inside the confirmation dialog, which stays open so the
 * person can retry or cancel. Only a successful deletion closes the dialog.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor, within } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import type { Identity } from '../src/domain/auth.js';

const sync = vi.hoisted(() => ({
  exportData: vi.fn<() => Promise<boolean>>(),
  deleteAccount: vi.fn<() => Promise<{ error: string | null }>>(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../src/features/auth/useSync.js', () => ({
  useSync: () => ({
    state: { status: 'synced', conflicts: [], cursor: null, lastSyncedAt: null, error: null },
    syncNow: async () => undefined,
    exportData: sync.exportData,
    deleteAccount: sync.deleteAccount,
  }),
}));
vi.mock('../src/components/ui/feedback.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}));

const { AuthProvider } = await import('../src/features/auth/AuthContext.js');
const { ThemeProvider } = await import('../src/hooks/useTheme.js');
const { TooltipProvider } = await import('../src/components/ui/tooltip.js');
const { AccountPage } = await import('../src/features/auth/AccountPage.js');

const identity: Identity = { userId: 'user-a', email: 'a@example.test', provider: 'google' };
const signOut = vi.fn(async () => {});

const adapter: AuthAdapter = {
  current: async () => identity,
  accessToken: async () => 'synthetic-token',
  signInWithPassword: async () => ({ error: null }),
  signUpWithPassword: async () => ({ error: null, needsConfirmation: true }),
  signInWithProvider: async () => ({ error: null }),
  sendRecovery: async () => ({ error: null }),
  signOut,
  onChange: () => () => {},
};

const DELETE_ERROR = 'Could not delete your account. Nothing was changed.';
const EXPORT_ERROR = 'Could not build your export. Try again.';

beforeEach(() => {
  sync.exportData.mockReset();
  sync.deleteAccount.mockReset();
  toast.mockReset();
  signOut.mockClear();
});
afterEach(cleanup);

async function page() {
  const user = userEvent.setup();
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
  const exportButton = await screen.findByRole('button', { name: 'Download my data' });
  const exportCard = exportButton.closest('.p-6');
  if (!(exportCard instanceof HTMLElement)) throw new Error('no export card');
  return { user, exportCard };
}

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Delete my account permanently' }));
  return dialog;
}

describe('deleting an account', () => {
  it('on success, toasts, signs out and closes the dialog', async () => {
    sync.deleteAccount.mockResolvedValue({ error: null });
    const { user } = await page();

    await confirmDelete(user);

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toast).toHaveBeenCalledWith('Account deleted', { tone: 'neutral' });
    expect(signOut).toHaveBeenCalled();
  });

  it('signs out while the dialog is still open, so focus is not returned to a vanishing button', async () => {
    /*
     * Signing out removes the card that opened the dialog. Closing first sent
     * focus back to its button, which then disappeared and left focus on
     * <body>. Closed after sign-out, the dialog finds its trigger gone and
     * return-focus falls back to <main> (measured in the browser; this pins
     * the ORDER, which is what the fallback depends on).
     */
    sync.deleteAccount.mockResolvedValue({ error: null });
    let openAtSignOut: boolean | null = null;
    signOut.mockImplementationOnce(async () => {
      /*
       * Sample after React has had a turn to render: the old code called
       * signOut in the same tick it asked the dialog to close, so an
       * immediate check could not tell the two orders apart.
       */
      await new Promise((resolve) => setTimeout(resolve, 0));
      openAtSignOut = screen.queryByRole('alertdialog') !== null;
    });
    const { user } = await page();

    await confirmDelete(user);

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(openAtSignOut).toBe(true);
  });

  it('on failure, keeps the dialog open with the error inside it', async () => {
    sync.deleteAccount.mockResolvedValue({ error: DELETE_ERROR });
    const { user, exportCard } = await page();

    const dialog = await confirmDelete(user);

    expect((await within(dialog).findByRole('alert')).textContent).toContain(DELETE_ERROR);
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    expect(within(exportCard).queryByText(DELETE_ERROR)).toBeNull();
    expect(within(exportCard).queryByRole('alert')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('after a failure, Cancel closes the dialog and reopening shows no stale error', async () => {
    sync.deleteAccount.mockResolvedValue({ error: DELETE_ERROR });
    const { user } = await page();

    const dialog = await confirmDelete(user);
    await within(dialog).findByText(DELETE_ERROR);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    const reopened = await screen.findByRole('alertdialog');
    expect(within(reopened).queryByText(DELETE_ERROR)).toBeNull();
  });

  it('after a failure, retrying can succeed', async () => {
    sync.deleteAccount
      .mockResolvedValueOnce({ error: DELETE_ERROR })
      .mockResolvedValueOnce({ error: null });
    const { user } = await page();

    const dialog = await confirmDelete(user);
    await within(dialog).findByText(DELETE_ERROR);
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account permanently' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(sync.deleteAccount).toHaveBeenCalledTimes(2);
    expect(signOut).toHaveBeenCalled();
  });
});

describe('exporting data', () => {
  it('shows an export failure in the export card, not in the delete dialog', async () => {
    sync.exportData.mockResolvedValue(false);
    const { user, exportCard } = await page();

    await user.click(within(exportCard).getByRole('button', { name: 'Download my data' }));
    expect((await within(exportCard).findByRole('alert')).textContent).toContain(EXPORT_ERROR);

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(EXPORT_ERROR)).toBeNull();
  });
});
