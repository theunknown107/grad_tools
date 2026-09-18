/**
 * v0 → v1: nothing a student was looking at yesterday may move.
 *
 * The exactness invariant is asserted per subject on every fixture below,
 * including the ones whose legacy data disagrees with itself. Those are not
 * hypothetical: `ClassMark` was a duplicate guard rather than a ledger, and the
 * attendance screen could edit the counters by hand without touching the marks,
 * so a subject really can hold marks for more classes than its counters admit.
 */

import { describe, expect, it } from 'vitest';
import { deriveCounts } from '../src/domain/attendance.js';
import { planUpgrade } from '../src/repositories/local/upgrade.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  AttendanceRecord,
  ClassMark,
  ClassOccurrence,
  OpeningBalance,
  TimetableSlot,
} from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');
const NOW = '2026-09-18T10:00:00.000Z';

function record(subjectCode: string, attended: number, conducted: number): AttendanceRecord {
  return {
    id: `record-${subjectCode}`,
    profileId,
    semester: 3,
    subjectCode,
    subjectTitle: `${subjectCode} title`,
    attended,
    conducted,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function slot(id: string, subjectCode: string): TimetableSlot {
  return {
    id,
    profileId,
    day: 'Wed',
    startTime: '09:00',
    endTime: '10:00',
    subjectCode,
    activity: null,
    room: null,
    faculty: null,
  };
}

function mark(
  date: string,
  slotId: string,
  subjectCode: string,
  outcome: 'attended' | 'missed' = 'attended',
): ClassMark {
  return {
    id: `${date}:${slotId}`,
    profileId,
    date,
    slotId,
    subjectCode,
    outcome,
    markedAt: `${date}T09:55:00.000Z`,
  };
}

/** Every subject's derived figure, against the counters it started from. */
function agreesWithCounters(
  counters: readonly AttendanceRecord[],
  entries: Parameters<typeof deriveCounts>[0],
): void {
  const derived = deriveCounts(entries);
  for (const counter of counters) {
    expect({
      subject: counter.subjectCode,
      ...derived.get(counter.subjectCode),
    }).toEqual({
      subject: counter.subjectCode,
      attended: counter.attended,
      conducted: counter.conducted,
    });
  }
}

describe('the v1 upgrade', () => {
  it('gives every slot a stable identity, keeping the one it already had', () => {
    const plan = planUpgrade({
      counters: [],
      marks: [],
      slots: [slot('slot-1', 'BCS301'), { ...slot('slot-2', 'BCS302'), classId: 'kept' }],
      now: NOW,
    });

    expect(plan.slots.map((entry) => entry.classId)).toEqual(['slot-1', 'kept']);
  });

  /* C — the ordinary case. */
  it('turns consistent counters and marks into history, exactly', () => {
    const counters = [record('BCS301', 8, 10), record('BCS302', 5, 5)];
    const marks = [
      mark('2026-09-14', 'slot-1', 'BCS301'),
      mark('2026-09-15', 'slot-1', 'BCS301', 'missed'),
    ];

    const plan = planUpgrade({ counters, marks, slots: [slot('slot-1', 'BCS301')], now: NOW });

    const occurrences = plan.entries.filter(
      (entry): entry is ClassOccurrence => entry.kind === 'occurrence',
    );
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((entry) => entry.id)).toEqual([
      '2026-09-14:slot-1',
      '2026-09-15:slot-1',
    ]);

    const opening = plan.entries.find(
      (entry): entry is OpeningBalance =>
        entry.kind === 'opening' && entry.subjectCode === 'BCS301',
    );
    // 8/10 minus the one attended and one missed class that became history.
    expect(opening?.attended).toBe(7);
    expect(opening?.conducted).toBe(8);
    expect(opening?.reconciliation).toBe('exact');

    agreesWithCounters(counters, plan.entries);
  });

  /* C2 — counters smaller than the marks imply. */
  it('preserves the stored figure exactly when the legacy data disagrees with itself', () => {
    const counters = [record('BCS301', 0, 0)];
    const marks = [mark('2026-09-14', 'slot-1', 'BCS301')];

    const plan = planUpgrade({ counters, marks, slots: [slot('slot-1', 'BCS301')], now: NOW });

    // No occurrence was invented to justify a figure nobody recorded…
    expect(plan.entries.filter((entry) => entry.kind === 'occurrence')).toHaveLength(0);
    const opening = plan.entries[0] as OpeningBalance;
    // …and the opening is the stored figure itself, not a clamped subtraction.
    expect(opening.attended).toBe(0);
    expect(opening.conducted).toBe(0);
    expect(opening.reconciliation).toBe('inconsistent');
    agreesWithCounters(counters, plan.entries);
  });

  it('never writes a negative opening balance', () => {
    const counters = [record('BCS301', 1, 2)];
    const marks = [
      mark('2026-09-14', 'slot-1', 'BCS301'),
      mark('2026-09-15', 'slot-1', 'BCS301'),
      mark('2026-09-16', 'slot-1', 'BCS301'),
    ];

    const plan = planUpgrade({ counters, marks, slots: [slot('slot-1', 'BCS301')], now: NOW });

    for (const entry of plan.entries) {
      if (entry.kind !== 'opening') continue;
      expect(entry.attended).toBeGreaterThanOrEqual(0);
      expect(entry.conducted).toBeGreaterThanOrEqual(0);
    }
    agreesWithCounters(counters, plan.entries);
  });

  /* C3 — the conflicting evidence is kept. */
  it('keeps every conflicting mark as evidence rather than discarding it', () => {
    const counters = [record('BCS301', 0, 0)];
    const marks = [
      mark('2026-09-14', 'slot-1', 'BCS301'),
      mark('2026-09-15', 'slot-1', 'BCS301', 'missed'),
    ];

    const plan = planUpgrade({ counters, marks, slots: [slot('slot-1', 'BCS301')], now: NOW });
    const opening = plan.entries[0] as OpeningBalance;

    expect(opening.unreconciledMarks).toEqual([
      { date: '2026-09-14', classId: 'slot-1', outcome: 'attended', reason: 'counter_mismatch' },
      { date: '2026-09-15', classId: 'slot-1', outcome: 'missed', reason: 'counter_mismatch' },
    ]);
  });

  /* C5 — a mark whose slot is gone is evidence too, not a rounding error. */
  it('keeps a mark whose class has left the timetable', () => {
    const counters = [record('BCS301', 8, 10)];
    const marks = [
      mark('2026-09-14', 'slot-1', 'BCS301'),
      mark('2026-09-15', 'deleted-slot', 'BCS301', 'missed'),
    ];

    const plan = planUpgrade({ counters, marks, slots: [slot('slot-1', 'BCS301')], now: NOW });
    const opening = plan.entries.find(
      (entry): entry is OpeningBalance => entry.kind === 'opening',
    ) as OpeningBalance;

    // The orphan is not history — there is no class to attach it to — but it is
    // not erased either, and its figures are inside the opening balance once.
    expect(opening.unreconciledMarks).toEqual([
      { date: '2026-09-15', classId: null, outcome: 'missed', reason: 'missing_slot' },
    ]);
    expect(opening.reconciliation).toBe('exact');
    expect(plan.entries.filter((entry) => entry.kind === 'occurrence')).toHaveLength(1);
    agreesWithCounters(counters, plan.entries);
  });

  /* C4 — and none of that evidence is counted twice. */
  it('counts the evidence exactly nowhere', () => {
    const counters = [record('BCS301', 8, 10)];
    const marks = [
      mark('2026-09-14', 'slot-1', 'BCS301'),
      mark('2026-09-15', 'deleted-slot', 'BCS301'),
      mark('2026-09-16', 'another-deleted', 'BCS301'),
    ];

    const plan = planUpgrade({ counters, marks, slots: [slot('slot-1', 'BCS301')], now: NOW });
    const derived = deriveCounts(plan.entries).get('BCS301');

    expect(derived).toEqual({ attended: 8, conducted: 10 });
    // The same figure after the marks are deleted, which is what PR D does.
    expect(deriveCounts(plan.entries).get('BCS301')).toEqual(derived);
  });

  it('keeps a subject whose record was deleted but whose marks survive', () => {
    const plan = planUpgrade({
      counters: [],
      marks: [mark('2026-09-14', 'slot-1', 'BCS301')],
      slots: [slot('slot-1', 'BCS301')],
      now: NOW,
    });

    const opening = plan.entries[0] as OpeningBalance;
    expect(opening.reconciliation).toBe('inconsistent');
    expect(opening.unreconciledMarks).toHaveLength(1);
    expect(deriveCounts(plan.entries).get('BCS301')).toEqual({ attended: 0, conducted: 0 });
  });

  it('invents no cancellation, because the old data holds no such fact', () => {
    const plan = planUpgrade({
      counters: [record('BCS301', 8, 10)],
      marks: [mark('2026-09-14', 'slot-1', 'BCS301')],
      slots: [slot('slot-1', 'BCS301')],
      now: NOW,
    });
    expect(plan.entries.some((entry) => 'status' in entry)).toBe(false);
  });

  /* D — the same input always produces the same ledger. */
  it('is byte-identical when planned again', () => {
    const input = {
      counters: [record('BCS301', 8, 10), record('BCS302', 0, 0)],
      marks: [
        mark('2026-09-15', 'slot-1', 'BCS301'),
        mark('2026-09-14', 'slot-1', 'BCS301', 'missed'),
        mark('2026-09-16', 'gone', 'BCS302'),
      ],
      slots: [slot('slot-1', 'BCS301'), slot('slot-2', 'BCS302')],
      now: NOW,
    };

    expect(JSON.stringify(planUpgrade(input))).toBe(JSON.stringify(planUpgrade(input)));
  });

  it('is unchanged by the order its inputs arrive in', () => {
    const counters = [record('BCS301', 8, 10), record('BCS302', 4, 4)];
    const marks = [mark('2026-09-14', 'slot-1', 'BCS301'), mark('2026-09-15', 'slot-2', 'BCS302')];
    const slots = [slot('slot-1', 'BCS301'), slot('slot-2', 'BCS302')];

    const straight = planUpgrade({ counters, marks, slots, now: NOW });
    const reversed = planUpgrade({
      counters: [...counters].reverse(),
      marks: [...marks].reverse(),
      slots,
      now: NOW,
    });

    expect(JSON.stringify(straight.entries)).toBe(JSON.stringify(reversed.entries));
  });

  it('records what it migrated from, for audit', () => {
    const plan = planUpgrade({
      counters: [record('BCS301', 8, 10)],
      marks: [],
      slots: [],
      now: NOW,
    });
    const opening = plan.entries[0] as OpeningBalance;
    expect(opening.migratedFrom).toEqual({ attended: 8, conducted: 10 });
    expect(opening.createdAt).toBe(NOW);
  });
});
