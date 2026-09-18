/**
 * v0 → v1: from two counters per subject to a ledger.
 *
 * ---------------------------------------------------------------------------
 * NOTHING A STUDENT WAS LOOKING AT YESTERDAY MAY MOVE
 * ---------------------------------------------------------------------------
 *
 * The upgrade's one hard guarantee is that `deriveCounts(ledger)` equals the
 * stored counters, for EVERY subject. A student who opens the app after the
 * update sees the same percentages they saw before it, whatever the state of
 * their old data.
 *
 * That is harder than it sounds, because the old data can disagree with itself.
 * `ClassMark` was a duplicate guard rather than a ledger, and the attendance
 * screen could edit the counters by hand without touching the marks, so a
 * subject can hold marks for more classes than its counters admit. The earlier
 * draft of this migration promised both "the counters are preserved exactly"
 * and "every surviving mark becomes counted history", which for such a subject
 * are not simultaneously satisfiable: 0/0 counters with one attended mark
 * derive 1/1 however the opening balance is clamped.
 *
 * So the upgrade branches, per subject:
 *
 *   CONSISTENT    counters >= what the marks imply
 *                 -> the marks become occurrences, and the opening balance is
 *                    the remainder. Exact, and the history is real.
 *
 *   INCONSISTENT  counters < what the marks imply
 *                 -> the counters stand as the opening balance, EXACTLY. None
 *                    of that subject's conflicting marks becomes an occurrence,
 *                    because converting some of them would be choosing which
 *                    classes were real. They are kept as evidence instead,
 *                    counted nowhere, and the subject says so.
 *
 * No clamping, no negative opening, no invented history, no double count, and
 * nothing thrown away — including marks whose slot no longer exists, which are
 * kept as evidence too rather than absorbed into a number and forgotten.
 */

import { openingId } from '../../domain/attendance.js';
import { slotClassId } from '../../domain/timetable-identity.js';
import type {
  AttendanceRecord,
  ClassMark,
  ClassOccurrence,
  LedgerEntry,
  OpeningBalance,
  TimetableSlot,
  UnreconciledLegacyMark,
} from '../../domain/types.js';
import { readValue, writeValue, type AccountScope } from './store.js';

export const SCHEMA_VERSION = 1;

export interface UpgradeInput {
  readonly counters: readonly AttendanceRecord[];
  readonly marks: readonly ClassMark[];
  readonly slots: readonly TimetableSlot[];
  readonly now: string;
}

export interface UpgradePlan {
  /** The weekly template, every row carrying a stable identity. */
  readonly slots: readonly TimetableSlot[];
  readonly entries: readonly LedgerEntry[];
}

function contribution(marks: readonly ClassMark[]): { attended: number; conducted: number } {
  return {
    attended: marks.filter((mark) => mark.outcome === 'attended').length,
    conducted: marks.length,
  };
}

/**
 * The whole upgrade, as a value.
 *
 * PURE: no clock of its own, no storage, no randomness, and every id is derived
 * from the data. Running it twice on the same input produces byte-identical
 * output, which is what makes a retry after a failed write safe.
 */
export function planUpgrade(input: UpgradeInput): UpgradePlan {
  const slots = input.slots.map((slot) => ({ ...slot, classId: slotClassId(slot) }));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  /* Marks are grouped by subject, and split by whether their slot survives. */
  const bySubject = new Map<string, { mapped: ClassMark[]; orphaned: ClassMark[] }>();
  const bucket = (subjectCode: string) => {
    const existing = bySubject.get(subjectCode);
    if (existing !== undefined) return existing;
    const created = { mapped: [] as ClassMark[], orphaned: [] as ClassMark[] };
    bySubject.set(subjectCode, created);
    return created;
  };
  for (const mark of input.marks) {
    const into = bucket(mark.subjectCode);
    if (slotById.has(mark.slotId)) into.mapped.push(mark);
    else into.orphaned.push(mark);
  }

  const titles = new Map(input.counters.map((record) => [record.subjectCode, record.subjectTitle]));
  const subjects = [...new Set([...titles.keys(), ...bySubject.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );

  const openings: OpeningBalance[] = [];
  const occurrences: ClassOccurrence[] = [];

  for (const subjectCode of subjects) {
    const record = input.counters.find((candidate) => candidate.subjectCode === subjectCode);
    const stored = { attended: record?.attended ?? 0, conducted: record?.conducted ?? 0 };
    const { mapped = [], orphaned = [] } = bySubject.get(subjectCode) ?? {};
    const implied = contribution(mapped);

    const consistent = stored.attended >= implied.attended && stored.conducted >= implied.conducted;

    const evidence: UnreconciledLegacyMark[] = orphaned.map((mark) => ({
      date: mark.date,
      classId: null,
      outcome: mark.outcome,
      reason: 'missing_slot',
    }));

    if (consistent) {
      for (const mark of mapped) {
        const slot = slotById.get(mark.slotId) as TimetableSlot;
        const classId = slotClassId(slot);
        occurrences.push({
          kind: 'occurrence',
          id: `${mark.date}:${classId}`,
          classId,
          date: mark.date,
          subjectCode: mark.subjectCode,
          subjectTitle: titles.get(mark.subjectCode) ?? null,
          startTime: slot.startTime,
          endTime: slot.endTime,
          outcome: mark.outcome,
          markedAt: mark.markedAt,
        });
      }
    } else {
      /*
       * The conflicting marks are kept whole, and none of them is counted: the
       * opening balance below is the stored figure exactly, so the evidence and
       * the aggregate cannot both be added in.
       */
      for (const mark of mapped) {
        evidence.push({
          date: mark.date,
          classId: slotClassId(slotById.get(mark.slotId) as TimetableSlot),
          outcome: mark.outcome,
          reason: 'counter_mismatch',
        });
      }
    }

    openings.push({
      kind: 'opening',
      id: openingId(subjectCode),
      subjectCode,
      attended: consistent ? stored.attended - implied.attended : stored.attended,
      conducted: consistent ? stored.conducted - implied.conducted : stored.conducted,
      migratedFrom: stored,
      reconciliation: consistent ? 'exact' : 'inconsistent',
      /* Sorted so a retry produces the same array, byte for byte. */
      unreconciledMarks: evidence.sort((a, b) => a.date.localeCompare(b.date)),
      createdAt: input.now,
    });
  }

  occurrences.sort((a, b) => a.id.localeCompare(b.id));
  return { slots, entries: [...openings, ...occurrences] };
}

/**
 * Applies the plan, writing the version marker LAST.
 *
 * Order matters and is the whole failure story: if the ledger write fails the
 * version is not written, so the next start plans the same upgrade again from
 * the same untouched inputs and produces the same rows. A device is never left
 * half-migrated AND behaving as though it had finished — which also means it
 * never stops publishing its attendance counters until the ledger is really
 * there (features/auth/useSync).
 */
export async function runUpgrade(scope: AccountScope): Promise<number> {
  const version = (await readValue<number>(scope, 'schemaVersion')) ?? 0;
  if (version >= SCHEMA_VERSION) return version;

  const [counters, marks, slots] = await Promise.all([
    readValue<AttendanceRecord[]>(scope, 'attendance'),
    readValue<ClassMark[]>(scope, 'classMarks'),
    readValue<TimetableSlot[]>(scope, 'timetable'),
  ]);

  const plan = planUpgrade({
    counters: counters ?? [],
    marks: marks ?? [],
    slots: slots ?? [],
    now: new Date().toISOString(),
  });

  if (plan.slots.length > 0) {
    const wroteSlots = await writeValue(scope, 'timetable', plan.slots);
    if (!wroteSlots) return version;
  }
  const wroteLedger = await writeValue(scope, 'attendanceLedger', plan.entries);
  if (!wroteLedger) return version;

  const wroteVersion = await writeValue(scope, 'schemaVersion', SCHEMA_VERSION);
  return wroteVersion ? SCHEMA_VERSION : version;
}
