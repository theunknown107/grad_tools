/**
 * Sync creates the cloud profile a push needs.
 *
 * The server refuses a push from an account with no cloud profile ("Set up
 * your profile before syncing academic records.", services/api/src/routes/me.ts),
 * and the web app never created one — so a signed-in student's records never
 * left the device. The fake cloud below enforces that refusal.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSync } from '../src/features/auth/useSync.js';
import { useAuth } from '../src/features/auth/AuthContext.js';
import { AuthContextValueProvider } from './helpers/auth-harness.js';
import { RepositoryProvider } from '../src/repositories/context.js';
import { createLocalRepositories } from '../src/repositories/local/index.js';
import { deleteValue, readValue, writeValue } from '../src/repositories/local/store.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { StudentProfile } from '../src/domain/types.js';

const SCOPE = 'aaaaaaaa-4444-4000-8000-00000000000a';

const PROFILE: StudentProfile = {
  id: asStudentProfileId('11111111-1111-1111-1111-111111111111'),
  authUserId: null,
  displayName: 'Synthetic Student',
  usn: '1XX22CS001',
  collegeName: null,
  schemeId: 'vtu-2022',
  programme: null,
  branch: null,
  currentSemester: null,
  admissionYear: 2022,
  expectedPassoutYear: 2026,
  entryRoute: 'puc',
  identityConfirmedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function cloud(initial: Record<string, unknown> | null) {
  const state = { profile: initial, puts: [] as Record<string, unknown>[], pushes: 0 };
  const json = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/me/profile') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        state.puts.push(body);
        state.profile = { ...body, id: 'cloud-profile', revision: 1 };
        return json(state.profile);
      }
      if (url.endsWith('/api/v1/me')) return json({ profile: state.profile });
      if (url.includes('/me/sync') && method === 'POST') {
        /* The refusal routes/me.ts makes. */
        if (state.profile === null) return json({ error: { code: 'VALIDATION_FAILED' } }, 400);
        state.pushes += 1;
        const { records } = JSON.parse(String(init?.body)) as {
          records: { id: string; collection: string }[];
        };
        return json({
          outcomes: records.map((r) => ({
            id: r.id,
            collection: r.collection,
            status: 'applied',
            reason: null,
            server: null,
          })),
        });
      }
      return json({ profile: state.profile, records: [], syncedAt: '2026-09-02T00:00:00.000Z' });
    }),
  );
  return state;
}

async function sync() {
  const repositories = createLocalRepositories(SCOPE);
  const Wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AuthContextValueProvider signedIn>
      <RepositoryProvider repositories={repositories}>{children}</RepositoryProvider>
    </AuthContextValueProvider>
  );
  const { result, unmount } = renderHook(
    () => ({ auth: useAuth().state.status, sync: useSync() }),
    { wrapper: Wrapper },
  );
  await waitFor(() => expect(result.current.auth).toBe('signed_in'));
  await act(async () => {
    await result.current.sync.syncNow();
  });
  const state = result.current.sync.state;
  unmount();
  return state;
}

beforeEach(async () => {
  await writeValue(SCOPE, 'schemaVersion', 1);
  await writeValue(SCOPE, 'timetable', [
    {
      id: '22222222-2222-4222-8222-222222222222',
      day: 'Mon',
      startTime: '09:00',
      endTime: '10:00',
      subjectCode: 'BCS301',
      activity: null,
      room: null,
      faculty: null,
    },
  ]);
  await deleteValue(SCOPE, 'syncState');
  await deleteValue(SCOPE, 'profile');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the cloud profile a push needs', () => {
  it('is created from the local profile before the push, and the push then succeeds', async () => {
    await writeValue(SCOPE, 'profile', PROFILE);
    const server = cloud(null);

    const state = await sync();

    expect(state.status).toBe('synced');
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]).toMatchObject({
      displayName: 'Synthetic Student',
      usn: '1XX22CS001',
      schemeId: 'vtu-2022',
      admissionYear: 2022,
      expectedPassoutYear: 2026,
      entryRoute: 'puc',
      identityConfirmedAt: '2026-09-01T00:00:00.000Z',
    });
    /* Create only: no revision is claimed, and nothing local travels. */
    expect(server.puts[0]).not.toHaveProperty('baseRevision');
    expect(server.puts[0]).not.toHaveProperty('id');
    expect(server.pushes).toBe(1);
  });

  it('never overwrites a cloud profile that already exists', async () => {
    await writeValue(SCOPE, 'profile', PROFILE);
    const server = cloud({ id: 'cloud-profile', schemeId: 'vtu-2022', revision: 4 });

    expect((await sync()).status).toBe('synced');
    expect(server.puts).toEqual([]);
  });

  it('gives a device with no profile the account’s profile from the pull', async () => {
    cloud({
      ...PROFILE,
      id: 'cloud-profile',
      authUserId: undefined,
      displayName: 'From another device',
      revision: 2,
    });

    await sync();

    const local = await readValue<StudentProfile>(SCOPE, 'profile');
    expect(local).toMatchObject({ id: 'cloud-profile', displayName: 'From another device' });
    expect(local).not.toHaveProperty('revision');
  });
});
