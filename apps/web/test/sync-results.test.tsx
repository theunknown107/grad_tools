/**
 * Results and sync: a pulled parent must not cost a result its subjects.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS FILE EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 *
 * Locally a result CONTAINS its subjects; in the cloud they are separate rows.
 * A pull that carries the parent alone (its `sgpaAsserted` changed, or another
 * device merely re-pushed it) used to replace the local object with the pulled
 * columns, so the subjects vanished. The next push then saw them "deleted here"
 * and tombstoned them in the cloud, and every other device lost them too.
 *
 * The fake cloud below keeps what the real one keeps: only the allowlisted
 * columns (services/api/src/student/store.ts), a pull of everything whose
 * `updated_at` is after the cursor, ordered by `updated_at, id`, and a push
 * refused as a conflict when its `baseRevision` is not the row's revision.
 *
 * It also guards OQ-060: a device must not push fields the cloud never stores
 * (`profileId`, `createdAt`, a slot's `classId`), or its fingerprint never
 * matches the cloud's echo and every sync re-pushes and conflicts with itself.
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
import type { SyncState } from '../src/domain/auth.js';
import type { SemesterResult, TimetableSlot } from '../src/domain/types.js';

const SCOPE = 'aaaaaaaa-4444-4000-8000-00000000000a';

/** The columns the server stores, as fields (store.ts COLLECTION_TABLES). */
const ALLOWED: Record<string, readonly string[]> = {
  results: ['semester', 'schemeId', 'ruleSetId', 'sgpaAsserted'],
  resultSubjects: [
    'resultId',
    'subjectCode',
    'subjectTitle',
    'internal',
    'external',
    'total',
    'resultStatus',
    'announcedOn',
    'gradeLetter',
    'gradePoint',
    'credits',
    'hasSee',
    'provenance',
    'catalogueCode',
    'ordinal',
  ],
  timetable: ['day', 'startTime', 'endTime', 'subjectCode', 'activity', 'room', 'faculty'],
};

interface Row {
  id: string;
  collection: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
  data: Record<string, unknown>;
}

interface Pushed {
  id: string;
  collection: string;
  deleted: boolean;
  baseRevision: number | null;
  data: Record<string, unknown>;
}

function cloud() {
  const rows = new Map<string, Row>();
  const pushed: Pushed[] = [];
  let clock = Date.parse('2026-09-01T00:00:00.000Z');
  const tick = (): string => new Date((clock += 1000)).toISOString();
  const keep = (collection: string, data: Record<string, unknown>) =>
    Object.fromEntries((ALLOWED[collection] ?? []).map((key) => [key, data[key] ?? null]));

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const ok = (body: unknown) =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
      if (!url.includes('/me/sync')) return ok({});

      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { records: Pushed[] };
        pushed.push(...body.records);
        const outcomes = body.records.map((record) => {
          const previous = rows.get(record.id);
          const echo = (row: Row) => ({
            revision: row.revision,
            data: row.data,
            deletedAt: row.deletedAt,
          });
          /* The revision check store.ts makes: a stale or unknown base is a conflict. */
          if (
            previous === undefined
              ? record.baseRevision !== null
              : record.baseRevision !== previous.revision
          ) {
            return {
              id: record.id,
              collection: record.collection,
              status: 'conflict',
              reason: 'This record changed on another device.',
              server: previous === undefined ? null : echo(previous),
            };
          }
          const row: Row = {
            id: record.id,
            collection: record.collection,
            revision: (previous?.revision ?? 0) + 1,
            updatedAt: tick(),
            deletedAt: record.deleted ? new Date(clock).toISOString() : null,
            data: record.deleted ? (previous?.data ?? {}) : keep(record.collection, record.data),
          };
          rows.set(record.id, row);
          return {
            id: record.id,
            collection: record.collection,
            status: 'applied',
            reason: null,
            server: record.deleted ? null : echo(row),
          };
        });
        return ok({ outcomes });
      }

      const since = new URL(url, 'http://test.invalid').searchParams.get('since');
      const records = [...rows.values()]
        .filter((row) => since === null || row.updatedAt > since)
        .sort((a, b) => (a.updatedAt + a.id).localeCompare(b.updatedAt + b.id));
      return ok({ records, syncedAt: tick() });
    }),
  );

  return {
    rows,
    pushed,
    /** Another device writes one row, as its push would. */
    write(id: string, collection: string, data: Record<string, unknown>, deleted = false) {
      const previous = rows.get(id);
      rows.set(id, {
        id,
        collection,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: tick(),
        deletedAt: deleted ? new Date(clock).toISOString() : null,
        data: deleted ? (previous?.data ?? {}) : keep(collection, { ...previous?.data, ...data }),
      });
    },
  };
}

const subject = (id: string, code: string, ordinal: number) => ({
  record: normalizeResultSubject({
    id,
    subjectCode: code,
    subjectTitle: code,
    internal: 40,
    external: 40,
    total: 80,
    resultStatus: 'P',
    credits: 4,
    gradeLetter: 'O',
    hasSee: true,
    provenance: 'manual',
  }),
  ordinal,
});

const RESULT: SemesterResult = {
  id: 'result-1',
  profileId: asStudentProfileId('11111111-1111-1111-1111-111111111111'),
  semester: 3,
  schemeId: 'vtu-2022',
  ruleSetId: null,
  sgpaAsserted: null,
  subjects: [subject('s1', 'BCS301', 0).record, subject('s2', 'BCS302', 1).record],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

async function sync(): Promise<SyncState> {
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
  await waitFor(() => {
    expect(result.current.auth).toBe('signed_in');
  });
  await act(async () => {
    await result.current.sync.syncNow();
  });
  const state = result.current.sync.state;
  unmount();
  return state;
}

async function localResult(): Promise<SemesterResult | undefined> {
  return (await createLocalRepositories(SCOPE).results.list())[0];
}

/*
 * One account scope stands in for two devices: a "device" is a saved copy of
 * its local results and sync bookkeeping, swapped in before it syncs.
 */
interface Device {
  readonly results: unknown;
  readonly syncState: unknown;
}

async function saveDevice(): Promise<Device> {
  return {
    results: await readValue(SCOPE, 'results'),
    syncState: await readValue(SCOPE, 'syncState'),
  };
}

async function loadDevice(device: Device): Promise<void> {
  await writeValue(SCOPE, 'results', (device.results ?? []) as never);
  if (device.syncState === null || device.syncState === undefined) {
    await deleteValue(SCOPE, 'syncState');
  } else {
    await writeValue(SCOPE, 'syncState', device.syncState as never);
  }
}

/** Device A creates and syncs the result; device B then pulls it fresh. */
async function twoDevices(): Promise<{ a: Device; b: Device }> {
  await sync();
  const a = await saveDevice();
  await loadDevice({ results: [], syncState: null });
  await sync();
  const b = await saveDevice();
  return { a, b };
}

beforeEach(async () => {
  await writeValue(SCOPE, 'results', [RESULT]);
  await writeValue(SCOPE, 'timetable', []);
  await writeValue(SCOPE, 'schemaVersion', 1);
  await deleteValue(SCOPE, 'syncState');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a device holding a pulled result', () => {
  it('keeps its subjects when a pull carries only the parent', async () => {
    const server = cloud();
    await twoDevices();
    expect((await localResult())?.subjects).toHaveLength(2);

    server.write('result-1', 'results', { sgpaAsserted: 8.5 });
    await sync();

    const result = await localResult();
    expect(result?.sgpaAsserted).toBe(8.5);
    expect(result?.subjects.map((entry) => entry.subjectCode)).toEqual(['BCS301', 'BCS302']);
  });

  it('does not tombstone the subjects on its next sync', async () => {
    const server = cloud();
    await twoDevices();
    server.write('result-1', 'results', { sgpaAsserted: 8.5 });
    await sync();
    await sync();

    expect(
      server.pushed.filter((entry) => entry.collection === 'resultSubjects' && entry.deleted),
    ).toEqual([]);
    expect(
      [...server.rows.values()].filter(
        (row) => row.collection === 'resultSubjects' && row.deletedAt !== null,
      ),
    ).toEqual([]);
  });
});

describe('two devices, nobody editing', () => {
  it('the second device keeps its subjects when the first merely syncs again', async () => {
    cloud();
    const { a, b } = await twoDevices();

    await loadDevice(a);
    await sync();
    await loadDevice(b);
    await sync();

    expect((await localResult())?.subjects).toHaveLength(2);
  });
});

describe('a pull that does carry subject rows', () => {
  it('still changes, adds and removes them', async () => {
    const server = cloud();
    await twoDevices();

    server.write('s2', 'resultSubjects', { gradeLetter: 'A+' });
    server.write('s3', 'resultSubjects', {
      ...subject('s3', 'BCS303', 2).record,
      resultId: 'result-1',
      ordinal: 2,
    });
    server.write('s1', 'resultSubjects', {}, true);
    await sync();

    const subjects = (await localResult())?.subjects ?? [];
    expect(subjects.map((entry) => entry.subjectCode).sort()).toEqual(['BCS302', 'BCS303']);
    expect(subjects.find((entry) => entry.id === 's2')?.gradeLetter).toBe('A+');
  });
});

describe('a record carrying fields the cloud never stores (OQ-060)', () => {
  it('syncs once, then settles: no re-push, no conflict, local fields kept', async () => {
    const server = cloud();

    const statuses = [(await sync()).status];
    const afterFirst = server.pushed.length;
    statuses.push((await sync()).status, (await sync()).status);

    expect(statuses).toEqual(['synced', 'synced', 'synced']);
    expect(afterFirst).toBeGreaterThan(0);
    expect(server.pushed).toHaveLength(afterFirst);
    const result = await localResult();
    expect(result?.profileId).toBe(RESULT.profileId);
    expect(result?.createdAt).toBe(RESULT.createdAt);
    expect(result?.subjects.map((entry) => entry.subjectCode)).toEqual(['BCS301', 'BCS302']);
  });

  it('two devices holding the same unchanged result do not conflict', async () => {
    const server = cloud();
    const { a, b } = await twoDevices();
    const before = server.pushed.length;

    await loadDevice(a);
    const onA = await sync();
    await loadDevice(b);
    const onB = await sync();

    expect([onA.status, onB.status]).toEqual(['synced', 'synced']);
    expect(onB.conflicts).toEqual([]);
    expect(server.pushed).toHaveLength(before);
    expect((await localResult())?.subjects).toHaveLength(2);
  });

  it('a genuine divergence is still a conflict', async () => {
    cloud();
    const { a, b } = await twoDevices();
    const edited = (device: Device, sgpaAsserted: number): Device => ({
      ...device,
      results: (device.results as SemesterResult[]).map((result) => ({ ...result, sgpaAsserted })),
    });

    await loadDevice(edited(a, 8.5));
    const onA = await sync();
    await loadDevice(edited(b, 9));
    const onB = await sync();

    expect(onA.status).toBe('synced');
    expect(onB.status).toBe('conflicts');
    expect(onB.conflicts.map((conflict) => conflict.id)).toContain('result-1');
    expect((await localResult())?.subjects).toHaveLength(2);
  });

  it('a timetable slot keeps its classId and is not re-pushed after its echo', async () => {
    const server = cloud();
    await writeValue(SCOPE, 'results', []);
    const slot: TimetableSlot = {
      id: 'slot-1',
      profileId: RESULT.profileId,
      classId: 'class-1',
      day: 'Mon',
      startTime: '09:00',
      endTime: '10:00',
      subjectCode: 'BCS301',
      activity: null,
      room: null,
      faculty: null,
      kind: 'course',
    };
    await writeValue(SCOPE, 'timetable', [slot]);

    const first = await sync();
    const pushedFirst = server.pushed.length;
    const second = await sync();

    expect([first.status, second.status]).toEqual(['synced', 'synced']);
    expect(pushedFirst).toBe(1);
    expect(server.pushed).toHaveLength(1);
    expect(server.pushed[0]?.data).not.toHaveProperty('classId');
    const [stored] = await createLocalRepositories(SCOPE).timetable.list();
    expect(stored?.classId).toBe('class-1');
    expect(stored?.kind).toBe('course');
  });
});
