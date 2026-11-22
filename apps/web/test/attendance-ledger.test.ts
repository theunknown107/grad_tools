/**
 * The attendance ledger: two axes, one aggregate.
 *
 * The transitions below are asserted against the literal table rather than
 * re-derived, so a change of implementation has to agree with the numbers a
 * student would work out by hand. The point of the table is the last six rows:
 * "cancelled" is a fact about the SCHEDULE, and what it does to the aggregate
 * depends on what the student had recorded underneath it — which is exactly why
 * the two cannot be collapsed into one state machine.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ADOPT_UNDO_MS,
  adoptSnapshot,
  adoptable,
  committed,
  contributionOf,
  deriveCounts,
  effectiveState,
  noteSnapshot,
  occurrenceId,
  openingId,
  reconcile,
  snapshotId,
  type Counts,
} from '../src/domain/attendance.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  AttendanceOutcome,
  AttendanceRecord,
  ClassOccurrence,
  DayOverride,
  LedgerEntry,
  OccurrenceStatus,
  OpeningBalance,
  RemoteSnapshot,
} from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');
const DATE = '2026-09-16';
const CLASS = 'class-1';
const CODE = 'BCS301';

function occurrence(outcome: AttendanceOutcome, date = DATE, classId = CLASS): ClassOccurrence {
  return {
    kind: 'occurrence',
    id: occurrenceId(date, classId),
    classId,
    date,
    subjectCode: CODE,
    subjectTitle: 'Data Structures',
    startTime: '09:00',
    endTime: '10:00',
    outcome,
    markedAt: `${date}T09:55:00.000Z`,
  };
}

function opening(attended: number, conducted: number, subjectCode = CODE): OpeningBalance {
  return {
    kind: 'opening',
    id: openingId(subjectCode),
    subjectCode,
    attended,
    conducted,
    migratedFrom: null,
    reconciliation: 'exact',
    unreconciledMarks: [],
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function override(status: OccurrenceStatus, date = DATE, classId = CLASS): DayOverride {
  return {
    id: occurrenceId(date, classId),
    profileId,
    date,
    classId,
    status,
    addition: null,
    replacedBy: null,
    createdAt: `${date}T08:00:00.000Z`,
  };
}

/** The aggregate for one subject, from a state expressed as the two axes. */
function aggregate(
  outcome: AttendanceOutcome | null,
  status: OccurrenceStatus,
  base: LedgerEntry[] = [],
): Counts {
  const entries: LedgerEntry[] = [...base];
  if (outcome !== null) entries.push(occurrence(outcome));
  const overrides = status === 'scheduled' ? [] : [override(status)];
  return deriveCounts(entries, overrides).get(CODE) ?? { attended: 0, conducted: 0 };
}

/* -------------------------------------------------------------------------- */
/* A — the transition table, as the oracle                                    */
/* -------------------------------------------------------------------------- */

describe('attendance transitions', () => {
  /* A pool of ten prior classes, so a subtraction has somewhere to go. */
  const base = [opening(8, 10)];

  const OUTCOME_TRANSITIONS: readonly [
    AttendanceOutcome | null,
    AttendanceOutcome | null,
    number,
    number,
  ][] = [
    [null, 'attended', +1, +1],
    [null, 'missed', 0, +1],
    ['attended', null, -1, -1],
    ['missed', null, 0, -1],
    ['attended', 'missed', -1, 0],
    ['missed', 'attended', +1, 0],
  ];

  it.each(OUTCOME_TRANSITIONS)(
    'moves %s -> %s by %d attended and %d conducted',
    (before, after, attended, conducted) => {
      const from = aggregate(before, 'scheduled', base);
      const to = aggregate(after, 'scheduled', base);
      expect(to.attended - from.attended).toBe(attended);
      expect(to.conducted - from.conducted).toBe(conducted);
    },
  );

  /*
   * THE CASE THE OLD SINGLE-AXIS TABLE COULD NOT EXPRESS. "Cancelled" is not
   * one transition: what it costs depends on what was recorded underneath, and
   * the record itself is never touched.
   */
  const CANCELLATION: readonly [AttendanceOutcome | null, number, number][] = [
    [null, 0, 0],
    ['attended', -1, -1],
    ['missed', 0, -1],
  ];

  it.each(CANCELLATION)(
    'cancelling a %s class moves the aggregate by %d / %d',
    (outcome, attended, conducted) => {
      const scheduled = aggregate(outcome, 'scheduled', base);
      const cancelled = aggregate(outcome, 'cancelled', base);
      expect(cancelled.attended - scheduled.attended).toBe(attended);
      expect(cancelled.conducted - scheduled.conducted).toBe(conducted);
    },
  );

  it.each(CANCELLATION)(
    'restoring a cancelled %s class puts back exactly %d / %d',
    (outcome, attended, conducted) => {
      const cancelled = aggregate(outcome, 'cancelled', base);
      const restored = aggregate(outcome, 'scheduled', base);
      /* `0 -` rather than unary minus: -0 and 0 are not the same value. */
      expect(restored.attended - cancelled.attended).toBe(0 - attended + 0);
      expect(restored.conducted - cancelled.conducted).toBe(0 - conducted + 0);
    },
  );

  it('counts removed and replaced exactly as cancelled does', () => {
    for (const status of ['cancelled', 'removed', 'replaced'] as const) {
      expect(aggregate('attended', status, base)).toEqual({ attended: 8, conducted: 10 });
    }
  });

  it('never lets a non-scheduled occurrence reach the denominator', () => {
    for (const outcome of ['attended', 'missed'] as const) {
      for (const status of ['cancelled', 'removed', 'replaced'] as const) {
        expect(contributionOf(occurrence(outcome), status)).toEqual({
          attended: 0,
          conducted: 0,
        });
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A2 — the axes are separate, and the ledger row is never rewritten          */
/* -------------------------------------------------------------------------- */

describe('schedule status and attendance outcome', () => {
  it('leaves the mark byte-identical when the class is cancelled', () => {
    const marked = occurrence('attended');
    const entries: LedgerEntry[] = [opening(8, 10), marked];

    const cancelled = deriveCounts(entries, [override('cancelled')]).get(CODE);

    expect(cancelled).toEqual({ attended: 8, conducted: 10 });
    // The entry array is the ledger; nothing in it moved.
    expect(entries[1]).toBe(marked);
    expect(marked.outcome).toBe('attended');
  });

  it('counts the original mark again when the cancellation is reversed', () => {
    const entries: LedgerEntry[] = [opening(8, 10), occurrence('attended')];
    expect(deriveCounts(entries, [override('cancelled')]).get(CODE)).toEqual({
      attended: 8,
      conducted: 10,
    });
    /* Reversing a cancellation removes the override. Nothing is restored,
       because nothing was destroyed. */
    expect(deriveCounts(entries, []).get(CODE)).toEqual({ attended: 9, conducted: 11 });
  });

  it('shows three states while storing two facts', () => {
    expect(effectiveState(undefined, 'scheduled')).toBe('unmarked');
    expect(effectiveState(occurrence('attended'), 'scheduled')).toBe('attended');
    expect(effectiveState(occurrence('missed'), 'scheduled')).toBe('missed');
    expect(effectiveState(occurrence('attended'), 'cancelled')).toBe('cancelled');
    expect(effectiveState(undefined, 'cancelled')).toBe('cancelled');
  });

  it('keeps a replacement apart from the class it replaced', () => {
    const original = occurrence('attended');
    const replacement: ClassOccurrence = {
      ...occurrence('missed'),
      id: occurrenceId(DATE, 'class-2'),
      classId: 'class-2',
      subjectCode: 'BCS302',
      subjectTitle: 'Operating Systems',
    };
    const derived = deriveCounts([opening(8, 10), original, replacement], [override('replaced')]);

    // The original subject is untouched and simply stops counting…
    expect(derived.get(CODE)).toEqual({ attended: 8, conducted: 10 });
    expect(original.subjectCode).toBe(CODE);
    // …and the replacement counts on its own, under its own subject.
    expect(derived.get('BCS302')).toEqual({ attended: 0, conducted: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/* B — derivation against random sequences                                    */
/* -------------------------------------------------------------------------- */

describe('derivation', () => {
  it('equals the sum of its parts for any sequence of marks', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 28 }),
            outcome: fc.constantFrom<AttendanceOutcome>('attended', 'missed'),
            cancelled: fc.boolean(),
          }),
          { maxLength: 40 },
        ),
        (marks) => {
          /* One occurrence per date: the id is derived, so later marks replace. */
          const byDate = new Map(marks.map((mark) => [mark.day, mark]));
          const entries: LedgerEntry[] = [opening(0, 0)];
          const overrides: DayOverride[] = [];
          for (const [day, mark] of byDate) {
            const date = `2026-09-${String(day).padStart(2, '0')}`;
            entries.push(occurrence(mark.outcome, date));
            if (mark.cancelled) overrides.push(override('cancelled', date));
          }

          const counted = [...byDate.values()].filter((mark) => !mark.cancelled);
          const derived = deriveCounts(entries, overrides).get(CODE);
          expect(derived).toEqual({
            attended: counted.filter((mark) => mark.outcome === 'attended').length,
            conducted: counted.length,
          });
        },
      ),
    );
  });

  it('never produces an impossible aggregate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 20 }),
        fc.integer({ min: -5, max: 20 }),
        (attended, conducted) => {
          const derived = deriveCounts([opening(attended, conducted)]).get(CODE) as Counts;
          expect(derived.attended).toBeGreaterThanOrEqual(0);
          expect(derived.conducted).toBeGreaterThanOrEqual(0);
          expect(derived.attended).toBeLessThanOrEqual(derived.conducted);
        },
      ),
    );
  });

  it('keeps a subject with nothing but cancellations visible at 0 of 0', () => {
    const derived = deriveCounts([opening(0, 0), occurrence('attended')], [override('cancelled')]);
    expect(derived.get(CODE)).toEqual({ attended: 0, conducted: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* The derived cache                                                          */
/* -------------------------------------------------------------------------- */

function record(attended: number, conducted: number, subjectCode = CODE): AttendanceRecord {
  return {
    id: `record-${subjectCode}`,
    profileId,
    semester: 3,
    subjectCode,
    subjectTitle: 'Data Structures',
    attended,
    conducted,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('the derived cache', () => {
  it('rewrites a record to what the ledger derives', () => {
    const derived = deriveCounts([opening(8, 10), occurrence('attended')]);
    const [updated] = reconcile([record(99, 99)], derived, '2026-09-16T10:00:00.000Z');
    expect(updated?.attended).toBe(9);
    expect(updated?.conducted).toBe(11);
  });

  it('leaves a record the ledger knows nothing about alone', () => {
    const untouched = record(5, 6, 'BMA302');
    const [same] = reconcile([untouched], deriveCounts([opening(8, 10)]));
    // A failed or partial ledger read must never be able to zero a figure.
    expect(same).toBe(untouched);
  });

  it('does not rewrite a record that already agrees', () => {
    const agreeing = record(8, 10);
    const [same] = reconcile([agreeing], deriveCounts([opening(8, 10)]));
    expect(same).toBe(agreeing);
  });
});

/* -------------------------------------------------------------------------- */
/* M — adopting a synced figure                                               */
/* -------------------------------------------------------------------------- */

function snapshot(attended: number, conducted: number, revision = 4): RemoteSnapshot {
  return {
    id: snapshotId('remote-1', revision),
    remoteRecordId: 'remote-1',
    subjectCode: CODE,
    attended,
    conducted,
    revision,
    status: 'open',
    firstSeenAt: '2026-09-16T08:00:00.000Z',
    lastSeenAt: '2026-09-16T08:00:00.000Z',
    adjustmentId: null,
  };
}

describe('adopting a synced aggregate', () => {
  const now = new Date('2026-09-18T10:00:00.000Z');

  it('creates exactly one adjustment, landing on the adopted figure', () => {
    const entries: LedgerEntry[] = [opening(8, 10)];
    const derived = deriveCounts(entries).get(CODE) as Counts;

    const adjustment = adoptSnapshot(snapshot(8, 11), derived, 'adj-1', now);

    expect(adjustment).not.toBeNull();
    expect(adjustment?.attendedDelta).toBe(0);
    expect(adjustment?.conductedDelta).toBe(1);
    expect(adjustment?.reason).toBe('adopt_remote_snapshot');
    expect(adjustment?.fromSnapshot).toBe(snapshot(8, 11).id);
    /* Provenance is not claimed, because sync cannot prove it. */
    expect(adjustment?.sourceDevice).toBeNull();

    const after = deriveCounts([...entries, adjustment as LedgerEntry]).get(CODE);
    expect(after).toEqual({ attended: 8, conducted: 11 });
    /* The opening balance and every occurrence are exactly as they were. */
    expect(entries[0]).toEqual(opening(8, 10));
  });

  it('counts an adjustment exactly once, however often the figure is derived', () => {
    const adjustment = adoptSnapshot(snapshot(8, 11), { attended: 8, conducted: 10 }, 'adj-1', now);
    const entries: LedgerEntry[] = [opening(8, 10), adjustment as LedgerEntry];
    expect(deriveCounts(entries).get(CODE)).toEqual({ attended: 8, conducted: 11 });
    expect(deriveCounts(entries).get(CODE)).toEqual({ attended: 8, conducted: 11 });
    expect((entries[0] as OpeningBalance).conducted).toBe(10);
  });

  it('sums two adoptions rather than replacing the first', () => {
    const first = adoptSnapshot(snapshot(8, 11), { attended: 8, conducted: 10 }, 'adj-1', now);
    const second = adoptSnapshot(
      snapshot(9, 12, 5),
      { attended: 8, conducted: 11 },
      'adj-2',
      new Date('2026-09-19T10:00:00.000Z'),
    );
    const entries: LedgerEntry[] = [opening(8, 10), first as LedgerEntry, second as LedgerEntry];
    expect(deriveCounts(entries).get(CODE)).toEqual({ attended: 9, conducted: 12 });
  });

  /* M8 — an impossible figure is refused, not clamped into something plausible. */
  it.each([
    [9, 8],
    [-1, 10],
    [8, -1],
    [8.5, 10],
  ])('refuses to adopt %s of %s', (attended, conducted) => {
    expect(adoptable({ attended, conducted })).toBe(false);
    expect(
      adoptSnapshot(snapshot(attended, conducted), { attended: 8, conducted: 10 }, 'x', now),
    ).toBeNull();
  });

  it('accepts a figure that could be real, including zero', () => {
    expect(adoptable({ attended: 0, conducted: 0 })).toBe(true);
    expect(adoptable({ attended: 10, conducted: 10 })).toBe(true);
  });

  it('commits when its undo window closes, and not before', () => {
    const adjustment = adoptSnapshot(snapshot(8, 11), { attended: 8, conducted: 10 }, 'adj-1', now);
    expect(committed(adjustment as never, now)).toBe(false);
    expect(committed(adjustment as never, new Date(now.getTime() + ADOPT_UNDO_MS - 1))).toBe(false);
    expect(committed(adjustment as never, new Date(now.getTime() + ADOPT_UNDO_MS))).toBe(true);
  });

  it('counts a pending adjustment, so the figure moves the moment it is adopted', () => {
    const adjustment = adoptSnapshot(snapshot(8, 11), { attended: 8, conducted: 10 }, 'adj-1', now);
    expect(committed(adjustment as never, now)).toBe(false);
    expect(deriveCounts([opening(8, 10), adjustment as LedgerEntry]).get(CODE)).toEqual({
      attended: 8,
      conducted: 11,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Observations: one per record revision, whatever a sync does                */
/* -------------------------------------------------------------------------- */

describe('remote observations', () => {
  const observed = {
    remoteRecordId: 'remote-1',
    subjectCode: CODE,
    attended: 8,
    conducted: 11,
    revision: 4,
  };
  const local: Counts = { attended: 8, conducted: 10 };

  it('records one observation however many times the same row is seen', () => {
    let snapshots: readonly RemoteSnapshot[] = [];
    for (let sync = 0; sync < 10; sync += 1) {
      snapshots = noteSnapshot(
        snapshots,
        observed,
        local,
        `2026-09-18T10:0${String(sync)}:00.000Z`,
      );
    }
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.id).toBe(snapshotId('remote-1', 4));
    expect(snapshots[0]?.firstSeenAt).toBe('2026-09-18T10:00:00.000Z');
    expect(snapshots[0]?.lastSeenAt).toBe('2026-09-18T10:09:00.000Z');
    expect(snapshots[0]?.status).toBe('open');
  });

  it('never re-opens a decision the student made', () => {
    const first = noteSnapshot([], observed, local, 'now');
    const kept = first.map((snapshot) => ({ ...snapshot, status: 'kept' as const }));
    const again = noteSnapshot(kept, observed, local, 'later');
    expect(again).toHaveLength(1);
    expect(again[0]?.status).toBe('kept');
    expect(again[0]?.lastSeenAt).toBe('later');
  });

  it('asks again when the row genuinely changes, superseding the old question', () => {
    const first = noteSnapshot([], observed, local, 'now');
    const next = noteSnapshot(first, { ...observed, conducted: 12, revision: 5 }, local, 'later');
    expect(next).toHaveLength(2);
    expect(next[0]?.status).toBe('superseded');
    expect(next[1]?.status).toBe('open');
    expect(next[1]?.revision).toBe(5);
  });

  it('leaves an adopted observation alone when its revision comes round again', () => {
    const adopted = noteSnapshot([], observed, local, 'now').map((snapshot) => ({
      ...snapshot,
      status: 'adopted' as const,
      adjustmentId: 'adj-1',
    }));
    const again = noteSnapshot(adopted, observed, local, 'later');
    expect(again).toHaveLength(1);
    expect(again[0]?.status).toBe('adopted');
    expect(again[0]?.adjustmentId).toBe('adj-1');
  });

  it('keeps a rejected observation rejected', () => {
    const impossible = { ...observed, attended: 9, conducted: 8 };
    const rejected = noteSnapshot([], impossible, local, 'now').map((snapshot) => ({
      ...snapshot,
      status: 'rejected' as const,
    }));
    const again = noteSnapshot(rejected, impossible, local, 'later');
    expect(again).toHaveLength(1);
    expect(again[0]?.status).toBe('rejected');
  });

  it('asks nothing at all when the figures agree', () => {
    expect(noteSnapshot([], observed, { attended: 8, conducted: 11 }, 'now')).toHaveLength(0);
  });

  it('closes an open question once the figures converge', () => {
    const open = noteSnapshot([], observed, local, 'now');
    const converged = noteSnapshot(open, observed, { attended: 8, conducted: 11 }, 'later');
    expect(converged[0]?.status).toBe('superseded');
  });
});
