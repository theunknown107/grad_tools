/**
 * Legacy (Supabase-era) records → the new Clerk account, on this device.
 *
 * After the cutover a returning student signs in under a new id; their records
 * are still in IndexedDB under the old one. These tests prove the copy is
 * explicit, complete, refuses to overwrite, never touches the original, and
 * leaves the old account's sync bookkeeping behind so everything re-uploads.
 *
 * SYNTHETIC DATA ONLY.
 */

import 'fake-indexeddb/auto';
import { clear, keys } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { LegacyDataOffer } from '../src/features/auth/LegacyDataOffer.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import {
  copyLegacyScope,
  legacyScopesWithRecords,
  readValue,
  scopeHoldsRecords,
  writeValue,
} from '../src/repositories/local/store.js';

const LEGACY = 'aaaaaaaa-5555-4000-8000-00000000000a';
const OTHER_LEGACY = 'bbbbbbbb-5555-4000-8000-00000000000b';
const CLERK = 'user_2synthReconcile';

const PROFILE = {
  id: 'p1',
  displayName: 'Synthetic Student',
  usn: '1XX22CS000',
  schemeId: 'vtu-2022',
};
const RESULTS = [{ id: 'r1', semester: 3, subjects: [] }];
const LEDGER = [{ id: 'l1', kind: 'opening' }];

async function seedLegacy(id = LEGACY, { version = 1 as number | null } = {}) {
  await writeValue(id, 'profile', PROFILE);
  await writeValue(id, 'results', RESULTS);
  await writeValue(id, 'attendanceLedger', LEDGER);
  await writeValue(id, 'timetableOverrides', [{ date: '2026-01-05' }]);
  await writeValue(id, 'syncState', { cursor: 'old-account-cursor', pending: [] });
  await writeValue(id, 'remoteSnapshots', [{ old: true }]);
  if (version !== null) await writeValue(id, 'schemaVersion', version);
}

beforeEach(async () => {
  await clear();
});
afterEach(() => cleanup());

describe('finding legacy records', () => {
  it('finds a Supabase-era scope with records, and nothing else', async () => {
    await seedLegacy();
    await writeValue(OTHER_LEGACY, 'attendanceLedger', []); // placeholder only
    await writeValue(null, 'results', RESULTS); // signed-out data: first-sync's job
    await writeValue('user_2someoneElse', 'results', RESULTS); // another Clerk account
    expect(await legacyScopesWithRecords(CLERK)).toEqual([LEGACY]);
  });

  it('does not count empty placeholders as records', async () => {
    await writeValue(CLERK, 'attendanceLedger', []);
    await writeValue(CLERK, 'schemaVersion', 1);
    await writeValue(CLERK, 'syncState', { cursor: null });
    expect(await scopeHoldsRecords(CLERK)).toBe(false);
  });
});

describe('copying', () => {
  it('copies every record, leaves the old bookkeeping behind, and keeps the original', async () => {
    await seedLegacy();
    await writeValue(CLERK, 'attendanceLedger', []); // a page was opened before the offer

    await copyLegacyScope(LEGACY, CLERK);

    expect(await readValue(CLERK, 'profile')).toEqual(PROFILE);
    expect(await readValue(CLERK, 'results')).toEqual(RESULTS);
    expect(await readValue(CLERK, 'attendanceLedger')).toEqual(LEDGER);
    expect(await readValue(CLERK, 'timetableOverrides')).toEqual([{ date: '2026-01-05' }]);
    expect(await readValue(CLERK, 'schemaVersion')).toBe(1);
    expect(await readValue(CLERK, 'syncState')).toBeNull();
    expect(await readValue(CLERK, 'remoteSnapshots')).toBeNull();

    expect(await readValue(LEGACY, 'results')).toEqual(RESULTS);
    expect(await readValue(LEGACY, 'syncState')).toEqual({
      cursor: 'old-account-cursor',
      pending: [],
    });
  });

  it('keeps pre-ledger data pre-ledger, so its upgrade still runs', async () => {
    await seedLegacy(LEGACY, { version: null });
    await writeValue(CLERK, 'schemaVersion', 1);
    await copyLegacyScope(LEGACY, CLERK);
    expect(await readValue(CLERK, 'schemaVersion')).toBeNull();
  });

  it('refuses to overwrite an account that already holds records', async () => {
    await seedLegacy();
    await writeValue(CLERK, 'results', [{ id: 'mine', semester: 1, subjects: [] }]);
    await expect(copyLegacyScope(LEGACY, CLERK)).rejects.toThrow(/already holds records/);
    expect(await readValue(CLERK, 'results')).toEqual([{ id: 'mine', semester: 1, subjects: [] }]);
  });

  it('copies only from a legacy scope', async () => {
    await writeValue('user_2someoneElse', 'results', RESULTS);
    await expect(copyLegacyScope('user_2someoneElse', CLERK)).rejects.toThrow(/legacy/);
    expect(await keys()).toHaveLength(1);
  });
});

describe('the offer', () => {
  const adapter: AuthAdapter = {
    current: async () => ({ userId: CLERK, email: 'synthetic@example.test', provider: 'email' }),
    accessToken: async () => null,
    signInWithPassword: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null, needsConfirmation: false }),
    signInWithProvider: async () => ({ error: null }),
    sendRecovery: async () => ({ error: null }),
    updatePassword: async () => ({ error: null }),
    completeDeepLink: async () => ({ error: null }),
    signOut: async () => undefined,
    onChange: () => () => undefined,
    onPasswordRecovery: () => () => undefined,
  };
  const renderOffer = () =>
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider adapter={adapter}>
            <LegacyDataOffer />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

  it('copies only after an explicit confirmation, then offers to remove the old copy', async () => {
    await seedLegacy();
    renderOffer();

    expect(await screen.findByText(/Synthetic Student · 1XX22CS000/)).toBeTruthy();
    expect(await readValue(CLERK, 'results')).toBeNull(); // shown, not moved

    await userEvent.click(screen.getByRole('button', { name: 'Bring into this account' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, these are mine' }));
    await waitFor(async () => expect(await readValue(CLERK, 'results')).toEqual(RESULTS));
    expect(await readValue(LEGACY, 'results')).toEqual(RESULTS);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove the earlier copy' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      [...dialog.querySelectorAll('button')].find(
        (b) => b.textContent === 'Remove the earlier copy',
      )!,
    );
    await waitFor(async () => expect(await scopeHoldsRecords(LEGACY)).toBe(false));
    expect(await readValue(CLERK, 'results')).toEqual(RESULTS);
  });

  it('stays hidden when the account already has records', async () => {
    await seedLegacy();
    await writeValue(CLERK, 'results', RESULTS);
    renderOffer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/previous account/)).toBeNull();
  });
});
