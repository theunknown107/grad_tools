/**
 * Which recurring class is which, across imports.
 *
 * ---------------------------------------------------------------------------
 * WHY A SLOT ID IS NOT AN IDENTITY
 * ---------------------------------------------------------------------------
 *
 * Saving an imported timetable DELETES every stored slot and writes new ones
 * with fresh ids (features/import/DocumentImport). Attendance keyed on `id`
 * would therefore lose its entire history the first time a student re-imported
 * the same document — nothing about the class changed, but every id did.
 *
 * Nor can identity be derived from the printed row. Two different sessions of
 * the same course can legitimately share a day, a start time and a code: the
 * importer records that pair as a conflict and saves both, and the manual form
 * allows it too. Room, faculty and batch cannot break the tie either — batch is
 * dropped at save, and the other two are mutable presentation that a revised
 * timetable changes freely.
 *
 * So identity is an explicit `classId`, minted once and CARRIED only where the
 * old and new rows match unambiguously.
 *
 * ---------------------------------------------------------------------------
 * DECISIONS ARE PURE; IDS ARE ALLOCATED
 * ---------------------------------------------------------------------------
 *
 * `planReconciliation` is a pure function of the two slot arrays: no clock, no
 * randomness, no module state, so the same inputs always produce the same
 * decisions. Minting an id is the impure part, and it lives in
 * `reconcileTimetable`, which takes the allocator as an argument — production
 * passes `newId`, tests pass a counter.
 */

import type { TimetableSlot } from './types.js';
import { slotKind } from './day-schedule.js';

/** The identity a stored slot carries, falling back for pre-v1 records. */
export function slotClassId(slot: TimetableSlot): string {
  return slot.classId ?? slot.id;
}

/**
 * The identity-relevant PERSISTED representation of a row.
 *
 * `id`, `classId`, `room` and `faculty` are excluded: the first two are
 * re-minted on every import, and the last two are mutable presentation. Using
 * them here would be inventing identity out of fields that change on their own.
 */
export function canonicalKey(slot: TimetableSlot): string {
  return JSON.stringify([
    slot.day,
    slot.startTime,
    slot.endTime,
    slot.subjectCode,
    slot.activity,
    slotKind(slot),
  ]);
}

/** A row, and the identity it should keep. `carry: null` means "needs a new one". */
export interface ReconciliationDecision {
  readonly row: TimetableSlot;
  readonly carry: string | null;
}

function groupBy(
  slots: readonly TimetableSlot[],
  key: (slot: TimetableSlot) => string,
  unmatched: ReadonlySet<number>,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  slots.forEach((slot, index) => {
    if (!unmatched.has(index)) return;
    const value = key(slot);
    const bucket = groups.get(value);
    if (bucket === undefined) groups.set(value, [index]);
    else bucket.push(index);
  });
  return groups;
}

/** A corrected code: the hour did not move. */
function dayStartKey(slot: TimetableSlot): string {
  return JSON.stringify([slot.day, slot.startTime]);
}

/** A corrected time: the course did not change. */
function daySubjectKey(slot: TimetableSlot): string {
  return JSON.stringify([slot.day, slot.subjectCode, slot.activity]);
}

/**
 * Which new rows inherit which `classId`, deterministically.
 *
 * Three passes, each deciding on CARDINALITY before anything is carried, so the
 * result cannot depend on iteration order:
 *
 *   0. the same canonical row on both sides, in the same number — carry the
 *      whole SET of ids, dealt out in a canonical order;
 *   1. one row on each side sharing (day, start) — a corrected code;
 *   2. one row on each side sharing (day, subject) — a corrected time.
 *
 * Anything else is AMBIGUOUS and is never guessed. Two sessions of one course
 * at one time have two candidates on each side at every key, so neither
 * inherits the other's history and neither is merged into it; they take fresh
 * ids and the old rows remain as orphaned history, still attributed to the
 * dates they were recorded on.
 *
 * Step 0 is what makes an unchanged re-import idempotent. Its guarantee is
 * deliberately SET-level: for rows nothing in the stored data distinguishes,
 * the plan does not claim that this new row is that old one — only that the set
 * of ids survives intact.
 */
export function planReconciliation(
  oldSlots: readonly TimetableSlot[],
  newSlots: readonly TimetableSlot[],
): readonly ReconciliationDecision[] {
  const carried = new Array<string | null>(newSlots.length).fill(null);
  const freeOld = new Set(oldSlots.map((_, index) => index));
  const freeNew = new Set(newSlots.map((_, index) => index));

  const take = (oldIndex: number, newIndex: number): void => {
    carried[newIndex] = slotClassId(oldSlots[oldIndex] as TimetableSlot);
    freeOld.delete(oldIndex);
    freeNew.delete(newIndex);
  };

  /* Step 0: indistinguishable rows, preserved as a set. */
  const oldCanonical = groupBy(oldSlots, canonicalKey, freeOld);
  const newCanonical = groupBy(newSlots, canonicalKey, freeNew);
  for (const [key, newIndexes] of newCanonical) {
    const oldIndexes = oldCanonical.get(key);
    if (oldIndexes === undefined || oldIndexes.length !== newIndexes.length) continue;
    /*
     * The ids are sorted rather than taken in array order, so shuffling the
     * stored slots cannot change which SET comes out. Within a set of rows the
     * data cannot tell apart, which row gets which id carries no claim.
     */
    const ids = oldIndexes
      .map((index) => slotClassId(oldSlots[index] as TimetableSlot))
      .sort((a, b) => a.localeCompare(b));
    newIndexes.forEach((newIndex, position) => {
      const oldIndex = oldIndexes[position] as number;
      take(oldIndex, newIndex);
      carried[newIndex] = ids[position] as string;
    });
  }

  /* Steps 1 and 2: a single corrected field, on what is left. */
  for (const key of [dayStartKey, daySubjectKey]) {
    const oldGroups = groupBy(oldSlots, key, freeOld);
    const newGroups = groupBy(newSlots, key, freeNew);
    for (const [value, newIndexes] of newGroups) {
      const oldIndexes = oldGroups.get(value);
      if (oldIndexes === undefined) continue;
      if (oldIndexes.length !== 1 || newIndexes.length !== 1) continue;
      take(oldIndexes[0] as number, newIndexes[0] as number);
    }
  }

  return newSlots.map((row, index) => ({ row, carry: carried[index] ?? null }));
}

/**
 * The new week, with identities carried where they could be.
 *
 * The allocator is called once per row that needs an id, in CANONICAL order
 * rather than array order, so an injected counter produces the same ids however
 * the input happens to be sorted.
 */
export function reconcileTimetable(
  oldSlots: readonly TimetableSlot[],
  newSlots: readonly TimetableSlot[],
  mintClassId: () => string,
): TimetableSlot[] {
  const decisions = planReconciliation(oldSlots, newSlots);

  const minted = new Map<number, string>();
  decisions
    .map((decision, index) => ({ decision, index }))
    .filter(({ decision }) => decision.carry === null)
    .sort((a, b) => {
      const keyed = canonicalKey(a.decision.row).localeCompare(canonicalKey(b.decision.row));
      return keyed === 0 ? a.index - b.index : keyed;
    })
    .forEach(({ index }) => {
      minted.set(index, mintClassId());
    });

  return decisions.map((decision, index) => ({
    ...decision.row,
    classId: decision.carry ?? (minted.get(index) as string),
  }));
}
