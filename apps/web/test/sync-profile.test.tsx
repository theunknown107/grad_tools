/**
 * The profile and sync (Step 15, OQ-062).
 *
 * The server refuses a push from an account with no cloud profile ("Set up
 * your profile before syncing academic records.", services/api/src/routes/me.ts).
 * So the first sync uploads one — the student's, or an empty anchor when they
 * skipped setup — and after that a profile edit is PUT against the revision this
 * device last agreed with. A stale edit is a conflict, never an overwrite.
 *
 * The fake cloud below enforces what the real one does: the push refusal, a
 * create when no profile exists, and a 409 with the server's copy when a profile
 * exists and `baseRevision` is missing or stale. Each accepted PUT bumps the
 * revision.
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
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { SemesterResult, StudentProfile } from '../src/domain/types.js';

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

/** What a student who skipped setup uploads: the scheme, nothing stated. */
const ANCHOR = {
  displayName: null,
  usn: null,
  collegeName: null,
  schemeId: 'vtu-2022',
  programme: null,
  branch: null,
  currentSemester: null,
  admissionYear: null,
  expectedPassoutYear: null,
  entryRoute: null,
  identityConfirmedAt: null,
};

const RESULT: SemesterResult = {
  id: 'result-1',
  profileId: PROFILE.id,
  semester: 3,
  schemeId: 'vtu-2022',
  ruleSetId: null,
  sgpaAsserted: null,
  subjects: [
    normalizeResultSubject({
      id: 's1',
      subjectCode: 'BCS301',
      subjectTitle: 'BCS301',
      internal: 40,
      external: 40,
      total: 80,
      resultStatus: 'P',
      credits: 4,
      gradeLetter: 'O',
      hasSee: true,
      provenance: 'manual',
    }),
  ],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

interface Pushed {
  id: string;
  collection: string;
  deleted: boolean;
  data: Record<string, unknown>;
}

function cloudRow(fields: Record<string, unknown>, revision: number) {
  return {
    ...ANCHOR,
    ...fields,
    id: 'cloud-profile',
    revision,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function cloud(initial: Record<string, unknown> | null) {
  const state = {
    profile: initial,
    puts: [] as Record<string, unknown>[],
    pushes: [] as Pushed[][],
  };
  let revision = 0;
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
        const { baseRevision, ...fields } = body;
        if (state.profile !== null) {
          /* The check routes/me.ts makes: a missing or stale base is a conflict. */
          if (baseRevision !== state.profile.revision) {
            return json({ error: { code: 'CONFLICT' }, server: state.profile }, 409);
          }
          revision = state.profile.revision as number;
        }
        state.profile = cloudRow(fields, (revision += 1));
        return json(state.profile);
      }
      if (url.endsWith('/api/v1/me')) return json({ profile: state.profile });
      if (url.includes('/me/sync') && method === 'POST') {
        /* The refusal routes/me.ts makes. */
        if (state.profile === null) return json({ error: { code: 'VALIDATION_FAILED' } }, 400);
        const { records } = JSON.parse(String(init?.body)) as { records: Pushed[] };
        state.pushes.push(records);
        return json({
          outcomes: records.map((r) => ({
            id: r.id,
            collection: r.collection,
            status: 'applied',
            reason: null,
            server: r.deleted ? null : { revision: 1, data: r.data, deletedAt: null },
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

const localProfile = () => readValue<StudentProfile>(SCOPE, 'profile');
const editProfile = (patch: Partial<StudentProfile>) =>
  writeValue(SCOPE, 'profile', { ...PROFILE, ...patch });

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
  await deleteValue(SCOPE, 'results');
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
    expect(server.pushes).toHaveLength(1);
  });

  it('never overwrites a cloud profile this device has not agreed with', async () => {
    await writeValue(SCOPE, 'profile', PROFILE);
    const server = cloud(cloudRow({ displayName: 'Another device' }, 4));

    const state = await sync();

    expect(server.puts).toEqual([]);
    expect(state.status).toBe('conflicts');
    expect(state.conflicts.map((c) => c.collection)).toEqual(['profile']);
    expect(server.profile).toMatchObject({ displayName: 'Another device', revision: 4 });
    expect(await localProfile()).toMatchObject({ displayName: 'Synthetic Student' });
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

    const local = await localProfile();
    expect(local).toMatchObject({ id: 'cloud-profile', displayName: 'From another device' });
    expect(local).not.toHaveProperty('revision');
  });
});

describe('profile edits after the first sync (OQ-062)', () => {
  it('PUTs an edit against the revision this device agreed with', async () => {
    await writeValue(SCOPE, 'profile', PROFILE);
    const server = cloud(null);
    await sync();

    await editProfile({ displayName: 'Edited' });
    const state = await sync();

    expect(state.status).toBe('synced');
    expect(server.puts).toHaveLength(2);
    expect(server.puts[1]).toMatchObject({ displayName: 'Edited', baseRevision: 1 });
    expect(server.profile).toMatchObject({ displayName: 'Edited', revision: 2 });

    /* Converged: a third sync sends nothing. */
    await sync();
    expect(server.puts).toHaveLength(2);
  });

  it('uploads an empty anchor for a student who skipped setup, and keeps them local-empty', async () => {
    const server = cloud(null);

    const state = await sync();

    expect(state.status).toBe('synced');
    expect(server.puts).toEqual([ANCHOR]);
    expect(server.pushes).toHaveLength(1);
    /* The Dashboard's "set up your profile" prompt depends on this. */
    expect(await localProfile()).toBeNull();

    await sync();
    expect(server.puts).toHaveLength(1);
    expect(await localProfile()).toBeNull();
  });

  it('PUTs a profile completed later against the anchor', async () => {
    const server = cloud(null);
    await sync();

    await writeValue(SCOPE, 'profile', PROFILE);
    const state = await sync();

    expect(state.status).toBe('synced');
    expect(server.puts[1]).toMatchObject({ displayName: 'Synthetic Student', baseRevision: 1 });
    expect(server.profile).toMatchObject({ displayName: 'Synthetic Student', revision: 2 });
  });

  it('reports a stale edit as a conflict and keeps both copies', async () => {
    await writeValue(SCOPE, 'profile', PROFILE);
    const server = cloud(null);
    await sync();

    server.profile = cloudRow({ displayName: 'Another device' }, 3);
    await editProfile({ displayName: 'Edited here' });
    await writeValue(SCOPE, 'timetable', [
      {
        id: '22222222-2222-4222-8222-222222222222',
        day: 'Mon',
        startTime: '09:00',
        endTime: '10:00',
        subjectCode: 'BCS301',
        activity: null,
        room: 'A-101',
        faculty: null,
      },
    ]);
    const state = await sync();

    expect(state.status).toBe('conflicts');
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0]).toMatchObject({
      collection: 'profile',
      local: { displayName: 'Edited here' },
      server: { displayName: 'Another device' },
    });
    expect(server.profile).toMatchObject({ displayName: 'Another device', revision: 3 });
    expect(await localProfile()).toMatchObject({ displayName: 'Edited here' });
    /* The record push is not held hostage by the profile. */
    expect(server.pushes).toHaveLength(2);
  });

  it('adopts a newer cloud profile when this device has not edited its own', async () => {
    await writeValue(SCOPE, 'profile', PROFILE);
    const server = cloud(null);
    await sync();

    server.profile = cloudRow({ displayName: 'Newer elsewhere' }, 2);
    const state = await sync();

    expect(state.status).toBe('synced');
    expect(server.puts).toHaveLength(1);
    expect(await localProfile()).toMatchObject({ displayName: 'Newer elsewhere' });
  });

  it('does not turn a cloud anchor into a local profile on a new device', async () => {
    const server = cloud(cloudRow({}, 1));

    const state = await sync();

    expect(state.status).toBe('synced');
    expect(server.puts).toEqual([]);
    expect(await localProfile()).toBeNull();
  });

  it('pushes no deletions and keeps results when only the profile changed', async () => {
    await writeValue(SCOPE, 'profile', PROFILE);
    await writeValue(SCOPE, 'results', [RESULT]);
    const server = cloud(null);
    await sync();

    await editProfile({ displayName: 'Edited' });
    await sync();

    expect(server.puts[1]).toMatchObject({ baseRevision: 1 });
    expect(server.pushes.flat().filter((record) => record.deleted)).toEqual([]);
    const results = await readValue<SemesterResult[]>(SCOPE, 'results');
    expect(results?.[0]?.subjects).toHaveLength(1);
  });
});
