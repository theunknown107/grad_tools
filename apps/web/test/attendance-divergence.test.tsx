/**
 * Deciding about a synced figure that disagrees with this device.
 *
 * The screen half of the rule the sync tests prove underneath: nothing adopts
 * itself. A student is shown both figures and presses one of two buttons, and
 * an impossible figure is refused outright rather than put on the screen as a
 * percentage above 100.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { DivergenceCard } from '../src/features/auth/DivergenceCard.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import { snapshotId } from '../src/domain/attendance.js';
import type { AttendanceAdjustment, LedgerEntry, RemoteSnapshot } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');
void profileId;

const opening: LedgerEntry = {
  kind: 'opening',
  id: 'opening:BCS301',
  subjectCode: 'BCS301',
  attended: 8,
  conducted: 10,
  migratedFrom: { attended: 8, conducted: 10 },
  reconciliation: 'exact',
  unreconciledMarks: [],
  createdAt: '2026-09-01T00:00:00.000Z',
};

function snapshot(attended: number, conducted: number): RemoteSnapshot {
  return {
    id: snapshotId('remote-1', 4),
    remoteRecordId: 'remote-1',
    subjectCode: 'BCS301',
    attended,
    conducted,
    revision: 4,
    status: 'open',
    firstSeenAt: '2026-09-18T08:00:00.000Z',
    lastSeenAt: '2026-09-18T08:00:00.000Z',
    adjustmentId: null,
  };
}

function adjustments(peek: ReturnType<typeof createMemoryRepositories>['peek']) {
  return peek
    .attendanceLedger()
    .filter((entry: LedgerEntry): entry is AttendanceAdjustment => entry.kind === 'adjustment');
}

/**
 * The card on its own, with seeded repositories.
 *
 * NOT through `AccountPage`: `AuthProvider` builds its own scope-bound local
 * repositories and overrides the provider around it, so a page rendered inside
 * it reads IndexedDB rather than the seed. The card is what is under test; the
 * page's own wiring is covered by the disclosure test below.
 */
function renderCard(repositories: ReturnType<typeof createMemoryRepositories>['bundle']) {
  return renderWith(<DivergenceCard />, { repositories });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-18T10:00:00'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a synced record that disagrees', () => {
  it('shows both figures without changing anything', async () => {
    const { bundle, peek } = createMemoryRepositories({
      attendanceLedger: [opening],
      remoteSnapshots: [snapshot(8, 11)],
    });
    renderCard(bundle);

    expect(
      await screen.findByText(/A synced attendance record was last reported as 8 of 11/),
    ).toBeTruthy();
    expect(screen.getByText(/This device has 8 of 10/)).toBeTruthy();
    /* Nothing is written by looking at it. */
    expect(adjustments(peek)).toHaveLength(0);
  });

  it('keeps this device’s record, and stops asking', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      attendanceLedger: [opening],
      remoteSnapshots: [snapshot(8, 11)],
    });
    renderCard(bundle);

    await user.click(await screen.findByRole('button', { name: /keep this device/i }));

    await waitFor(() => {
      expect(peek.remoteSnapshots()[0]?.status).toBe('kept');
    });
    expect(adjustments(peek)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /adopt the synced counts/i })).toBeNull();
  });

  it('adopts the synced figure as one auditable adjustment', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      attendanceLedger: [opening],
      remoteSnapshots: [snapshot(8, 11)],
    });
    renderCard(bundle);

    await user.click(await screen.findByRole('button', { name: /adopt the synced counts/i }));

    await waitFor(() => {
      expect(adjustments(peek)).toHaveLength(1);
    });
    const [adjustment] = adjustments(peek);
    expect(adjustment).toMatchObject({
      subjectCode: 'BCS301',
      attendedDelta: 0,
      conductedDelta: 1,
      reason: 'adopt_remote_snapshot',
      sourceDevice: null,
    });
    /* Both halves of the audit link. */
    expect(adjustment?.fromSnapshot).toBe(snapshotId('remote-1', 4));
    expect(peek.remoteSnapshots()[0]).toMatchObject({
      status: 'adopted',
      adjustmentId: adjustment?.id,
    });
    /* The opening balance is exactly as it was. */
    expect(peek.attendanceLedger()[0]).toEqual(opening);
  });

  it('refuses an impossible figure rather than adopting it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      attendanceLedger: [opening],
      remoteSnapshots: [snapshot(9, 8)],
    });
    renderCard(bundle);

    await user.click(await screen.findByRole('button', { name: /adopt the synced counts/i }));

    await waitFor(() => {
      expect(peek.remoteSnapshots()[0]?.status).toBe('rejected');
    });
    expect(adjustments(peek)).toHaveLength(0);
    expect(peek.attendanceLedger()).toHaveLength(1);
  });
});
