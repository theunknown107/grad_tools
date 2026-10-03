/**
 * The ledger's storage boundary.
 *
 * Two rules the rest of the app relies on and cannot enforce for itself:
 *
 * - a committed adjustment is immutable. Its undo window is a rollback, not an
 *   edit, and once the window has closed the only correction is another
 *   adjustment;
 * - a failed ledger write is an error, not a shrug. The counters can be
 *   re-derived; a class the student recorded and storage dropped cannot.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalRepositories } from '../src/repositories/local/index.js';
import { ADOPT_UNDO_MS, occurrenceId, openingId } from '../src/domain/attendance.js';
import { writeValue } from '../src/repositories/local/store.js';
import type { AttendanceAdjustment, ClassOccurrence, LedgerEntry } from '../src/domain/types.js';

const SCOPE = 'repository-test-scope';
const CODE = 'BCS301';

function adjustment(createdAt: string): AttendanceAdjustment {
  return {
    kind: 'adjustment',
    id: 'adj-1',
    subjectCode: CODE,
    attendedDelta: 0,
    conductedDelta: 1,
    reason: 'adopt_remote_snapshot',
    sourceDevice: null,
    fromSnapshot: 'snapshot:remote-1:4',
    createdAt,
    commitAfter: new Date(new Date(createdAt).getTime() + ADOPT_UNDO_MS).toISOString(),
  };
}

const occurrence: ClassOccurrence = {
  kind: 'occurrence',
  id: occurrenceId('2026-09-16', 'class-1'),
  classId: 'class-1',
  date: '2026-09-16',
  subjectCode: CODE,
  subjectTitle: 'Data Structures',
  startTime: '09:00',
  endTime: '10:00',
  outcome: 'attended',
  markedAt: '2026-09-16T09:55:00.000Z',
};

beforeEach(async () => {
  await writeValue(SCOPE, 'attendanceLedger', []);
  await writeValue(SCOPE, 'schemaVersion', 1);
  vi.useRealTimers();
});

describe('the attendance ledger repository', () => {
  it('lets an adoption be taken back inside its undo window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-18T10:00:00.000Z'));
    const repositories = createLocalRepositories(SCOPE);

    await repositories.attendanceLedger.upsert(adjustment('2026-09-18T10:00:00.000Z'));
    expect(await repositories.attendanceLedger.list()).toHaveLength(1);

    /* Undo: the whole adoption is rolled back, not edited. */
    await repositories.attendanceLedger.remove('adj-1');
    expect(await repositories.attendanceLedger.list()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('refuses to change or delete an adjustment once it is committed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-18T10:00:00.000Z'));
    const repositories = createLocalRepositories(SCOPE);
    await repositories.attendanceLedger.upsert(adjustment('2026-09-18T10:00:00.000Z'));

    vi.setSystemTime(new Date('2026-09-18T10:00:09.000Z'));

    await expect(repositories.attendanceLedger.remove('adj-1')).rejects.toThrow(/committed/i);
    await expect(
      repositories.attendanceLedger.upsert({
        ...adjustment('2026-09-18T10:00:00.000Z'),
        conductedDelta: 99,
      }),
    ).rejects.toThrow(/committed/i);

    const entries = await repositories.attendanceLedger.list();
    expect(entries).toHaveLength(1);
    expect((entries[0] as AttendanceAdjustment).conductedDelta).toBe(1);
    vi.useRealTimers();
  });

  it('still lets a later correction be recorded beside it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-18T10:00:00.000Z'));
    const repositories = createLocalRepositories(SCOPE);
    await repositories.attendanceLedger.upsert(adjustment('2026-09-18T10:00:00.000Z'));
    vi.setSystemTime(new Date('2026-09-18T10:00:09.000Z'));

    await repositories.attendanceLedger.upsert({
      ...adjustment('2026-09-18T10:00:09.000Z'),
      id: 'adj-2',
      conductedDelta: -1,
    });

    expect(await repositories.attendanceLedger.list()).toHaveLength(2);
    vi.useRealTimers();
  });

  it('leaves occurrences and openings freely editable', async () => {
    const repositories = createLocalRepositories(SCOPE);
    await repositories.attendanceLedger.upsert(occurrence);
    await repositories.attendanceLedger.upsert({ ...occurrence, outcome: 'missed' });

    const entries = await repositories.attendanceLedger.list();
    expect(entries).toHaveLength(1);
    expect((entries[0] as ClassOccurrence).outcome).toBe('missed');

    await repositories.attendanceLedger.remove(occurrence.id);
    expect(await repositories.attendanceLedger.list()).toHaveLength(0);
  });

  it('reports a write it could not persist rather than pretending', async () => {
    const repositories = createLocalRepositories(SCOPE);
    /*
     * A real IndexedDB failure, not a mocked one: a value holding a function
     * cannot be structured-cloned, so `set` rejects exactly as it does when a
     * browser is out of quota or in a blocked private window.
     */
    const unstorable = { ...occurrence, markedAt: () => 'not cloneable' } as unknown as LedgerEntry;

    await expect(repositories.attendanceLedger.upsert(unstorable)).rejects.toThrow(
      /could not save/i,
    );
  });

  it('keeps one occurrence per class per date, whatever the caller does', async () => {
    const repositories = createLocalRepositories(SCOPE);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await repositories.attendanceLedger.upsert(occurrence);
    }
    const entries: LedgerEntry[] = await repositories.attendanceLedger.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('2026-09-16:class-1');
    expect(openingId(CODE)).toBe('opening:BCS301');
  });
});
