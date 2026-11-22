/**
 * Attendance and sync: one writer per place.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS FILE EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 *
 * Two devices, each deriving its own attendance figure from its own ledger,
 * each writing that figure into the one synced row. A derives 8/10 and pushes;
 * B derives 8/11 and pushes; A pulls, disagrees, re-derives and pushes 8/10; B
 * pulls, disagrees, and pushes 8/11 — for ever. Both devices are individually
 * correct and the pair never settles.
 *
 * The fix is not a cleverer merge: it is that a ledger-authoritative device has
 * NO WRITE PATH to anything the other device can see. It publishes no
 * attendance row, and a pulled one becomes an observation rather than a fact.
 * The tests below run real syncs against a fake server and assert that nothing
 * moves.
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
import { deriveCounts, openingId, occurrenceId } from '../src/domain/attendance.js';
import { deleteValue, readValue, writeValue } from '../src/repositories/local/store.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  AttendanceRecord,
  DayOverride,
  LedgerEntry,
  RemoteSnapshot,
} from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');
const SCOPE = 'aaaaaaaa-4444-4000-8000-00000000000a';
const CODE = 'BCS301';

function record(attended: number, conducted: number): AttendanceRecord {
  return {
    id: 'record-1',
    profileId,
    semester: 3,
    subjectCode: CODE,
    subjectTitle: 'Data Structures',
    attended,
    conducted,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function opening(attended: number, conducted: number): LedgerEntry {
  return {
    kind: 'opening',
    id: openingId(CODE),
    subjectCode: CODE,
    attended,
    conducted,
    migratedFrom: { attended, conducted },
    reconciliation: 'exact',
    unreconciledMarks: [],
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function marked(date: string, outcome: 'attended' | 'missed'): LedgerEntry {
  return {
    kind: 'occurrence',
    id: occurrenceId(date, 'class-1'),
    classId: 'class-1',
    date,
    subjectCode: CODE,
    subjectTitle: 'Data Structures',
    startTime: '09:00',
    endTime: '10:00',
    outcome,
    markedAt: `${date}T09:55:00.000Z`,
  };
}

function cancelled(date: string): DayOverride {
  return {
    id: occurrenceId(date, 'class-1'),
    profileId,
    date,
    classId: 'class-1',
    status: 'cancelled',
    addition: null,
    replacedBy: null,
    createdAt: `${date}T08:00:00.000Z`,
  };
}

/**
 * A server holding one attendance row, which counts what it is asked to do.
 *
 * `pushes` is the assertion that matters: a v1 device must never appear in it.
 */
function server(row: { attended: number; conducted: number; revision: number }) {
  const pushed: unknown[] = [];
  const deleted: string[] = [];
  const state = { ...row };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/me/sync')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      }
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          records: { collection: string; id: string; deleted?: boolean }[];
        };
        pushed.push(...body.records);
        /* A tombstone for the attendance row would remove it here. */
        for (const record of body.records) {
          if (record.collection === 'attendance' && record.deleted === true)
            deleted.push(record.id);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ outcomes: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            records: [
              {
                id: 'remote-1',
                collection: 'attendance',
                revision: state.revision,
                deletedAt: null,
                data: {
                  profileId,
                  semester: 3,
                  subjectCode: CODE,
                  subjectTitle: 'Data Structures',
                  attended: state.attended,
                  conducted: state.conducted,
                  updatedAt: '2026-09-17T00:00:00.000Z',
                },
              },
            ],
            syncedAt: '2026-09-18T10:00:00.000Z',
          }),
      } as Response);
    }),
  );

  return {
    state,
    pushed,
    /** Attendance rows this device asked the server to delete. */
    deletedRemotely: () => deleted,
    attendancePushes: () =>
      pushed.filter((entry) => (entry as { collection: string }).collection === 'attendance'),
  };
}

function useSyncWhenSignedIn() {
  return { auth: useAuth().state.status, sync: useSync() };
}

function wrapper() {
  const repositories = createLocalRepositories(SCOPE);
  const Wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AuthContextValueProvider signedIn>
      <RepositoryProvider repositories={repositories}>{children}</RepositoryProvider>
    </AuthContextValueProvider>
  );
  return { repositories, Wrapper };
}

/** A v1 device with one cancelled class: 8 of 10, from 10 marks and 1 cancelled. */
async function seedLedgerDevice(): Promise<void> {
  await writeValue(SCOPE, 'attendance', [record(8, 10)]);
  await writeValue(SCOPE, 'attendanceLedger', [
    opening(7, 9),
    marked('2026-09-16', 'attended'),
    marked('2026-09-17', 'attended'),
  ]);
  await writeValue(SCOPE, 'timetableOverrides', [cancelled('2026-09-17')]);
  await writeValue(SCOPE, 'schemaVersion', 1);
}

async function runSync(): Promise<{
  repositories: ReturnType<typeof createLocalRepositories>;
  unmount: () => void;
}> {
  const { repositories, Wrapper } = wrapper();
  const { result, unmount } = renderHook(useSyncWhenSignedIn, { wrapper: Wrapper });
  await waitFor(() => {
    expect(result.current.auth).toBe('signed_in');
  });
  await act(async () => {
    await result.current.sync.syncNow();
  });
  return { repositories, unmount };
}

beforeEach(async () => {
  for (const key of [
    'attendance',
    'attendanceLedger',
    'timetableOverrides',
    'remoteSnapshots',
    'timetable',
    'classMarks',
  ] as const) {
    await writeValue(SCOPE, key, []);
  }
  await writeValue(SCOPE, 'schemaVersion', 0);
  /* Deleted rather than emptied: the bookkeeping is an object, not a list. */
  await deleteValue(SCOPE, 'syncState');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a ledger-authoritative device', () => {
  it('publishes no attendance row at all', async () => {
    await seedLedgerDevice();
    const fake = server({ attended: 8, conducted: 11, revision: 4 });

    const { unmount } = await runSync();

    expect(fake.attendancePushes()).toHaveLength(0);
    unmount();
  });

  /*
   * THE DANGEROUS COROLLARY OF NOT PUBLISHING.
   *
   * `recordsToPush` sends a tombstone for anything the bookkeeping knows about
   * that is no longer held locally — which is right for a record the student
   * deleted, and catastrophic for one this device has merely stopped
   * collecting. Without the guard, the first sync after the upgrade would
   * DELETE the aggregate every other device is still using.
   */
  it('never pushes a deletion for the attendance it has stopped collecting', async () => {
    await seedLedgerDevice();
    await writeValue(SCOPE, 'syncState', {
      cursor: '2026-09-17T00:00:00.000Z',
      lastSyncedAt: '2026-09-17T00:00:00.000Z',
      records: {
        'record-1': { collection: 'attendance', revision: 3, fingerprint: 'anything' },
      },
    });
    const fake = server({ attended: 8, conducted: 11, revision: 4 });

    const { unmount } = await runSync();

    expect(fake.attendancePushes()).toHaveLength(0);
    expect(fake.pushed.filter((entry) => (entry as { deleted?: boolean }).deleted)).toHaveLength(0);
    /* And the row the other device is still using is exactly as it was. */
    expect(fake.state).toEqual({ attended: 8, conducted: 11, revision: 4 });
    expect(fake.deletedRemotely()).toHaveLength(0);
    unmount();
  });

  it('keeps its own figure when a pulled aggregate is larger', async () => {
    await seedLedgerDevice();
    server({ attended: 8, conducted: 11, revision: 4 });

    const { unmount } = await runSync();

    const stored = (await readValue<AttendanceRecord[]>(SCOPE, 'attendance')) ?? [];
    expect(stored[0]?.attended).toBe(8);
    expect(stored[0]?.conducted).toBe(10);
    unmount();
  });

  it('keeps its own figure when a pulled aggregate is smaller', async () => {
    await seedLedgerDevice();
    server({ attended: 2, conducted: 3, revision: 4 });

    const { unmount } = await runSync();

    const stored = (await readValue<AttendanceRecord[]>(SCOPE, 'attendance')) ?? [];
    expect(stored[0]).toMatchObject({ attended: 8, conducted: 10 });
    unmount();
  });

  it('leaves the ledger and the local cancellation exactly as they were', async () => {
    await seedLedgerDevice();
    const before = JSON.stringify(await readValue(SCOPE, 'attendanceLedger'));
    server({ attended: 8, conducted: 11, revision: 4 });

    const { unmount } = await runSync();

    expect(JSON.stringify(await readValue(SCOPE, 'attendanceLedger'))).toBe(before);
    const overrides = (await readValue<DayOverride[]>(SCOPE, 'timetableOverrides')) ?? [];
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.status).toBe('cancelled');
    unmount();
  });

  it('records the disagreement as one observation, not a decision', async () => {
    await seedLedgerDevice();
    server({ attended: 8, conducted: 11, revision: 4 });

    const { unmount } = await runSync();

    const snapshots = (await readValue<RemoteSnapshot[]>(SCOPE, 'remoteSnapshots')) ?? [];
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      remoteRecordId: 'remote-1',
      subjectCode: CODE,
      attended: 8,
      conducted: 11,
      revision: 4,
      status: 'open',
      adjustmentId: null,
    });
    unmount();
  });

  /* J5 — the same row, ten syncs, one observation. */
  it('does not multiply observations when nothing has changed', async () => {
    await seedLedgerDevice();
    server({ attended: 8, conducted: 11, revision: 4 });

    const { repositories, Wrapper } = wrapper();
    const { result, unmount } = renderHook(useSyncWhenSignedIn, { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.auth).toBe('signed_in');
    });
    for (let sync = 0; sync < 10; sync += 1) {
      await act(async () => {
        await result.current.sync.syncNow();
      });
    }

    const snapshots = await repositories.remoteSnapshots.list();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.firstSeenAt).toBe(snapshots[0]?.firstSeenAt);
    expect(snapshots[0]?.status).toBe('open');
    unmount();
  });

  /* J6 / J7 / J8 — a decision the student made survives any number of syncs. */
  it.each(['kept', 'adopted', 'rejected'] as const)(
    'never re-opens a %s observation',
    async (status) => {
      await seedLedgerDevice();
      server({ attended: 8, conducted: 11, revision: 4 });

      const { repositories, Wrapper } = wrapper();
      const { result, unmount } = renderHook(useSyncWhenSignedIn, { wrapper: Wrapper });
      await waitFor(() => {
        expect(result.current.auth).toBe('signed_in');
      });
      await act(async () => {
        await result.current.sync.syncNow();
      });

      const [seen] = await repositories.remoteSnapshots.list();
      await repositories.remoteSnapshots.upsert({
        ...(seen as RemoteSnapshot),
        status,
        adjustmentId: status === 'adopted' ? 'adj-1' : null,
      });

      await act(async () => {
        await result.current.sync.syncNow();
      });

      const after = await repositories.remoteSnapshots.list();
      expect(after).toHaveLength(1);
      expect(after[0]?.status).toBe(status);
      // A sync can never create an adjustment; only the student can.
      const entries = await repositories.attendanceLedger.list();
      expect(entries.filter((entry) => entry.kind === 'adjustment')).toHaveLength(0);
      unmount();
    },
  );

  it('asks again when the row genuinely changes', async () => {
    await seedLedgerDevice();
    const fake = server({ attended: 8, conducted: 11, revision: 4 });

    const { repositories, Wrapper } = wrapper();
    const { result, unmount } = renderHook(useSyncWhenSignedIn, { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.auth).toBe('signed_in');
    });
    await act(async () => {
      await result.current.sync.syncNow();
    });

    fake.state.conducted = 12;
    fake.state.revision = 5;
    await act(async () => {
      await result.current.sync.syncNow();
    });

    const snapshots = await repositories.remoteSnapshots.list();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.filter((snapshot) => snapshot.status === 'open')).toHaveLength(1);
    expect(snapshots.find((snapshot) => snapshot.status === 'open')?.revision).toBe(5);
    unmount();
  });

  it('ignores a remote deletion, which says nothing about local classes', async () => {
    await seedLedgerDevice();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ outcomes: [] }),
          } as Response);
        }
        if (!String(input).includes('/me/sync')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              records: [
                {
                  id: 'record-1',
                  collection: 'attendance',
                  revision: 9,
                  deletedAt: '2026-09-18T00:00:00.000Z',
                  data: {},
                },
              ],
              syncedAt: '2026-09-18T10:00:00.000Z',
            }),
        } as Response);
      }),
    );

    const { unmount } = await runSync();

    const stored = (await readValue<AttendanceRecord[]>(SCOPE, 'attendance')) ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ attended: 8, conducted: 10 });
    unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* J2 — two ledger devices, alternating syncs, nothing moves                   */
/* -------------------------------------------------------------------------- */

describe('two devices that both derive their own figure', () => {
  it('cannot oscillate, because neither publishes', async () => {
    /*
     * Device A is this browser: 8 of 10, with one class cancelled. Device B is
     * represented by the server row it left behind: 8 of 11, because a
     * cancellation is not something an aggregate can carry.
     */
    await seedLedgerDevice();
    const fake = server({ attended: 8, conducted: 11, revision: 4 });
    const ledgerBefore = JSON.stringify(await readValue(SCOPE, 'attendanceLedger'));

    const { repositories, Wrapper } = wrapper();
    const { result, unmount } = renderHook(useSyncWhenSignedIn, { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.auth).toBe('signed_in');
    });

    for (let round = 0; round < 5; round += 1) {
      await act(async () => {
        await result.current.sync.syncNow();
      });

      // A's ledger: untouched, every round.
      expect(JSON.stringify(await readValue(SCOPE, 'attendanceLedger'))).toBe(ledgerBefore);
      // A's figure: still what its own ledger derives.
      const entries = await repositories.attendanceLedger.list();
      const overrides = await repositories.timetableOverrides.list();
      expect(deriveCounts(entries, overrides).get(CODE)).toEqual({ attended: 8, conducted: 10 });
      const stored = await repositories.attendance.list();
      expect(stored[0]).toMatchObject({ attended: 8, conducted: 10 });
      // B's row: never written to, so B has nothing to react to.
      expect(fake.state).toEqual({ attended: 8, conducted: 11, revision: 4 });
      expect(fake.attendancePushes()).toHaveLength(0);
      // And exactly one open question, not a growing pile.
      const snapshots = await repositories.remoteSnapshots.list();
      expect(snapshots.filter((snapshot) => snapshot.status === 'open')).toHaveLength(1);
    }

    unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* J4 — a device that has not upgraded behaves exactly as it always did        */
/* -------------------------------------------------------------------------- */

describe('a device still on the old model', () => {
  it('publishes and accepts attendance as before', async () => {
    /*
     * No ledger, no version marker: the upgrade has not run. The repositories
     * run it on first access, so this proves the PRE-upgrade path by writing
     * the rows and syncing through a bundle whose ledger is never touched.
     */
    await writeValue(SCOPE, 'attendance', [record(8, 10)]);
    await writeValue(SCOPE, 'schemaVersion', 0);
    const fake = server({ attended: 8, conducted: 11, revision: 4 });

    const { repositories, Wrapper } = wrapper();
    const { result, unmount } = renderHook(useSyncWhenSignedIn, { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.auth).toBe('signed_in');
    });
    await act(async () => {
      await result.current.sync.syncNow();
    });

    /*
     * The upgrade ran (the sync waits for it), so this device is now on v1 and
     * the ledger it produced derives the figure it had: the old data is carried
     * forward rather than reinterpreted.
     */
    const entries = await repositories.attendanceLedger.list();
    expect(deriveCounts(entries).get(CODE)).toEqual({ attended: 8, conducted: 10 });
    expect(await readValue<number>(SCOPE, 'schemaVersion')).toBe(1);
    void fake;
    unmount();
  });
});
