/**
 * Which recurring class is which, across imports.
 *
 * The property under test is not "matching works" but "matching never lies":
 * an import must either carry an identity it can prove, or mint a new one and
 * leave the old history where it was. A wrong match is worse than no match,
 * because it silently attributes one class's attendance to another.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalKey,
  planReconciliation,
  reconcileTimetable,
  slotClassId,
} from '../src/domain/timetable-identity.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { TimetableSlot } from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function slot(overrides: Partial<TimetableSlot> & { id: string }): TimetableSlot {
  return {
    profileId,
    day: 'Mon',
    startTime: '09:00',
    endTime: '10:00',
    subjectCode: 'BCS301',
    activity: null,
    room: null,
    faculty: null,
    ...overrides,
  };
}

/** A fresh import: every id re-minted, which is what really happens. */
function reimport(slots: readonly TimetableSlot[]): TimetableSlot[] {
  return slots.map((existing, index) => {
    const { classId, ...withoutIdentity } = existing;
    void classId;
    return { ...withoutIdentity, id: `fresh-${String(index)}` };
  });
}

function allocator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `new-${String(next)}`;
  };
}

function ids(slots: readonly TimetableSlot[]): string[] {
  return slots.map((entry) => slotClassId(entry));
}

describe('timetable identity', () => {
  /* E — the ordinary case, and the one that used to lose everything. */
  it('carries every identity through an unchanged re-import', () => {
    const stored = [
      slot({ id: 'a', classId: 'class-a' }),
      slot({ id: 'b', classId: 'class-b', startTime: '11:00', endTime: '12:00' }),
      slot({ id: 'c', classId: 'class-c', day: 'Tue', subjectCode: 'BCS302' }),
    ];

    const next = reconcileTimetable(stored, reimport(stored), allocator());

    expect(ids(next)).toEqual(['class-a', 'class-b', 'class-c']);
  });

  /* E2 — including a duplicate-session pair, five times over. */
  it('keeps the same classId set when the same timetable is imported repeatedly', () => {
    let stored = [
      slot({ id: 'a', classId: 'class-a' }),
      // Two sessions of one course at one time: the importer records this as a
      // conflict and saves both, and the manual form allows it too.
      slot({ id: 'b', classId: 'class-b' }),
      slot({ id: 'c', classId: 'class-c', startTime: '14:00', endTime: '15:00' }),
    ];
    const first = [...ids(stored)].sort();

    for (let round = 0; round < 5; round += 1) {
      const mint = allocator();
      stored = reconcileTimetable(stored, reimport(stored), mint);
      expect([...ids(stored)].sort()).toEqual(first);
      // Nothing was minted, so no history was orphaned.
      expect(mint()).toBe('new-1');
    }
  });

  it('gives the same set whichever order the rows arrive in', () => {
    const stored = [
      slot({ id: 'a', classId: 'class-a' }),
      slot({ id: 'b', classId: 'class-b' }),
      slot({ id: 'c', classId: 'class-c', day: 'Wed' }),
    ];
    const incoming = reimport(stored);

    const straight = reconcileTimetable(stored, incoming, allocator());
    const shuffled = reconcileTimetable([...stored].reverse(), incoming, allocator());

    expect([...ids(straight)].sort()).toEqual([...ids(shuffled)].sort());
    // The distinguishable row keeps its own identity either way.
    expect(straight[2]?.classId).toBe('class-c');
    expect(shuffled[2]?.classId).toBe('class-c');
  });

  /* F — one field corrected, on a row nothing else matches. */
  it('keeps the identity when the end time is corrected', () => {
    const stored = [slot({ id: 'a', classId: 'class-a' })];
    const corrected = [slot({ id: 'fresh', endTime: '10:30' })];

    expect(reconcileTimetable(stored, corrected, allocator())[0]?.classId).toBe('class-a');
  });

  it('keeps the identity when the subject code is corrected', () => {
    const stored = [slot({ id: 'a', classId: 'class-a' })];
    const corrected = [slot({ id: 'fresh', subjectCode: 'BCS301X' })];

    expect(reconcileTimetable(stored, corrected, allocator())[0]?.classId).toBe('class-a');
  });

  it('does not match across days', () => {
    const stored = [slot({ id: 'a', classId: 'class-a' })];
    const moved = [slot({ id: 'fresh', day: 'Thu' })];

    expect(reconcileTimetable(stored, moved, allocator())[0]?.classId).toBe('new-1');
  });

  /* G — legitimate parallel classes stay apart. */
  it('keeps two courses at the same hour on different days distinct', () => {
    const stored = [
      slot({ id: 'a', classId: 'class-a' }),
      slot({ id: 'b', classId: 'class-b', day: 'Tue', subjectCode: 'BCS302' }),
    ];

    const next = reconcileTimetable(stored, reimport(stored), allocator());

    expect(next[0]?.classId).toBe('class-a');
    expect(next[1]?.classId).toBe('class-b');
  });

  /* G2 — duplicates cannot swap identity across a change. */
  it('mints fresh ids for duplicate sessions when one of them changes', () => {
    const stored = [slot({ id: 'a', classId: 'class-a' }), slot({ id: 'b', classId: 'class-b' })];
    // One of the pair now runs an hour longer: the rows are no longer
    // indistinguishable, and nothing says WHICH of the two it was.
    const changed = [slot({ id: 'f1' }), slot({ id: 'f2', endTime: '11:00' })];

    const next = reconcileTimetable(stored, changed, allocator());

    expect(next.map((entry) => entry.classId)).toEqual(['new-1', 'new-2']);
    expect(ids(next)).not.toContain('class-a');
    expect(ids(next)).not.toContain('class-b');
  });

  /* G3 — an ambiguous re-import never merges two histories into one. */
  it('mints a new id when two identical rows become one', () => {
    const stored = [slot({ id: 'a', classId: 'class-a' }), slot({ id: 'b', classId: 'class-b' })];
    const next = reconcileTimetable(stored, [slot({ id: 'f1' })], allocator());

    expect(next).toHaveLength(1);
    expect(next[0]?.classId).toBe('new-1');
  });

  it('mints new ids when one row becomes two identical ones', () => {
    const stored = [slot({ id: 'a', classId: 'class-a' })];
    const next = reconcileTimetable(stored, [slot({ id: 'f1' }), slot({ id: 'f2' })], allocator());

    expect(next.map((entry) => entry.classId)).toEqual(['new-1', 'new-2']);
  });

  /* G4 — decisions are pure; allocation is injected. */
  it('decides the same way every time, with no ids minted in the decision', () => {
    const stored = [slot({ id: 'a', classId: 'class-a' })];
    // One row the old week can account for, and one it cannot.
    const incoming = [slot({ id: 'f1' }), slot({ id: 'f2', day: 'Fri' })];

    const first = planReconciliation(stored, incoming);
    const second = planReconciliation(stored, incoming);

    expect(first.map((decision) => decision.carry)).toEqual(
      second.map((decision) => decision.carry),
    );
    expect(first.map((decision) => decision.carry)).toEqual(['class-a', null]);
  });

  it('calls the allocator once per row that needs an id', () => {
    const calls: string[] = [];
    const mint = (): string => {
      calls.push(`id-${String(calls.length)}`);
      return `id-${String(calls.length - 1)}`;
    };
    reconcileTimetable([], [slot({ id: 'f1' }), slot({ id: 'f2', day: 'Fri' })], mint);
    expect(calls).toHaveLength(2);
  });

  it('allocates in canonical order, so the ids do not depend on input order', () => {
    const rows = [slot({ id: 'f1', day: 'Wed' }), slot({ id: 'f2', day: 'Mon' })];

    const straight = reconcileTimetable([], rows, allocator());
    const reversed = reconcileTimetable([], [...rows].reverse(), allocator());

    const byDay = (slots: readonly TimetableSlot[]) =>
      Object.fromEntries(slots.map((entry) => [entry.day, entry.classId]));
    expect(byDay(straight)).toEqual(byDay(reversed));
  });

  /* Identity never reads a field that changes on its own. */
  it('ignores room, faculty and the slot id', () => {
    const stored = [slot({ id: 'a', classId: 'class-a', room: 'A101', faculty: 'Dr Rao' })];
    const moved = [slot({ id: 'totally-different', room: 'B202', faculty: 'Dr Iyer' })];

    expect(canonicalKey(stored[0] as TimetableSlot)).toBe(canonicalKey(moved[0] as TimetableSlot));
    expect(reconcileTimetable(stored, moved, allocator())[0]?.classId).toBe('class-a');
  });

  it('falls back to the slot id for a row written before identities existed', () => {
    expect(slotClassId(slot({ id: 'legacy' }))).toBe('legacy');
    expect(slotClassId(slot({ id: 'legacy', classId: 'class-a' }))).toBe('class-a');
  });

  it('treats an activity as its own kind of row', () => {
    const stored = [slot({ id: 'a', classId: 'class-a', subjectCode: null, activity: 'Library' })];
    const next = reconcileTimetable(stored, reimport(stored), allocator());
    expect(next[0]?.classId).toBe('class-a');
  });
});
