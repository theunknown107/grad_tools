/**
 * Recording that a class happened.
 *
 * Authority: docs/08 §8.9 · docs/16 §16.9 · core product §12, §32
 *
 * ---------------------------------------------------------------------------
 * THE ACTION THE PRODUCT IS USED FOR MOST, AND HAD NO BUTTON
 * ---------------------------------------------------------------------------
 *
 * Attendance is stored as two counts — attended and conducted — which is the
 * right shape (docs/08 §8.9) and gave the screen only two operations: add a
 * subject with both totals typed in, or delete it. A student who went to five
 * classes today had to retype five subject codes and ten numbers to record it.
 *
 * The daily loop is: a class happens, and it was attended or it was not. That
 * is one increment, and this is the whole of it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN @gradtools/academic-rules
 * ---------------------------------------------------------------------------
 *
 * Nothing here is a regulation. `calculateAttendance`, `calculateClassesCanMiss`
 * and `calculateClassesMustAttend` own every threshold and every percentage,
 * and they stay where they are. Adding one to a counter is bookkeeping, and
 * putting it in the rules package would mix "what the university requires" with
 * "what the student tapped".
 */

import type {
  AttendanceAdjustment,
  AttendanceOutcome,
  AttendanceRecord,
  ClassOccurrence,
  DayOverride,
  LedgerEntry,
  OccurrenceStatus,
  OpeningBalance,
  RemoteSnapshot,
} from './types.js';

/** What happened to one class. There is no third answer worth storing. */
export type ClassOutcome = 'attended' | 'missed';

/**
 * The same record, one class later.
 *
 * A missed class still HAPPENED: `conducted` rises either way, and only
 * `attended` depends on the outcome. Incrementing just `attended` on a present
 * day would quietly improve the percentage, and incrementing nothing on an
 * absent day would quietly preserve it — both are the same mistake, which is
 * treating attendance as a score rather than a ratio.
 */
export function markClass(record: AttendanceRecord, outcome: ClassOutcome): AttendanceRecord {
  return {
    ...record,
    attended: record.attended + (outcome === 'attended' ? 1 : 0),
    conducted: record.conducted + 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The first class of a subject that has no record yet.
 *
 * Reached from today's timetable, where the student is looking at a class for a
 * subject they have never opened the attendance screen for. Refusing to record
 * it — or making them go and create the subject first — is how a one-tap action
 * becomes a three-screen errand.
 *
 * The title comes from the caller, which resolves it through the subject index
 * (M10A.1) rather than asking the student to type a name they have already
 * entered somewhere else.
 */
export function startRecord(
  seed: {
    readonly id: string;
    readonly profileId: AttendanceRecord['profileId'];
    readonly semester: number;
    readonly subjectCode: string;
    readonly subjectTitle: string;
  },
  outcome: ClassOutcome,
): AttendanceRecord {
  return {
    id: seed.id,
    profileId: seed.profileId,
    semester: seed.semester,
    subjectCode: seed.subjectCode,
    subjectTitle: seed.subjectTitle,
    attended: outcome === 'attended' ? 1 : 0,
    conducted: 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Whether a record could have come from counting real classes.
 *
 * `attended > conducted` is not a rounding problem, it is a corrupt record: it
 * says a student went to more classes than were held, and every percentage
 * derived from it is above 100. The entry form already refuses it; this exists
 * so an increment path cannot introduce it either, and so a record that arrived
 * from sync or from an older build can be recognised rather than rendered.
 */
export function isCountable(record: AttendanceRecord): boolean {
  return (
    Number.isInteger(record.attended) &&
    Number.isInteger(record.conducted) &&
    record.attended >= 0 &&
    record.conducted >= 0 &&
    record.attended <= record.conducted
  );
}

/* -------------------------------------------------------------------------- */
/* The daily loop: one scheduled class, one decision                          */
/* -------------------------------------------------------------------------- */

/**
 * What moving one class from `before` to `after` does to the two counters.
 *
 * `null` means "the student has not said". Every transition falls out of two
 * facts — a class that was marked at all was CONDUCTED, and a class marked
 * attended was ATTENDED — so this is subtraction rather than six cases:
 *
 *   unmarked → attended     +1 attended   +1 conducted
 *   unmarked → missed        0            +1 conducted
 *   attended → missed       -1 attended    0
 *   missed   → attended     +1 attended    0
 *   attended → unmarked     -1 attended   -1 conducted   (undo)
 *   missed   → unmarked      0            -1 conducted   (undo)
 *
 * Undo is the same arithmetic backwards, which is why nothing needs to store a
 * copy of the record it replaced.
 */
export function countDelta(
  before: ClassOutcome | null,
  after: ClassOutcome | null,
): { readonly attended: number; readonly conducted: number } {
  const attendedOf = (outcome: ClassOutcome | null) => (outcome === 'attended' ? 1 : 0);
  const conductedOf = (outcome: ClassOutcome | null) => (outcome === null ? 0 : 1);
  return {
    attended: attendedOf(after) - attendedOf(before),
    conducted: conductedOf(after) - conductedOf(before),
  };
}

/**
 * The record, moved by a delta.
 *
 * CLAMPED, because the counts are also editable by hand: a student who marks a
 * class attended, then opens the attendance screen and types the totals down to
 * zero, would otherwise undo their way to a negative record. Clamping keeps
 * every result countable (`isCountable`) rather than trusting the arithmetic to
 * be the only writer.
 */
export function applyDelta(
  record: AttendanceRecord,
  delta: { readonly attended: number; readonly conducted: number },
): AttendanceRecord {
  const conducted = Math.max(0, record.conducted + delta.conducted);
  return {
    ...record,
    attended: Math.min(conducted, Math.max(0, record.attended + delta.attended)),
    conducted,
    updatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* The ledger (v1): the authority behind the two counters                     */
/* -------------------------------------------------------------------------- */

/**
 * ---------------------------------------------------------------------------
 * WHY THE COUNTERS ARE NO LONGER THE TRUTH
 * ---------------------------------------------------------------------------
 *
 * Two integers per subject cannot say whether you were in Programming on the
 * 16th, cannot express a class the institution cancelled, and cannot be
 * reconciled between devices without one of them guessing. So on a device that
 * has upgraded, `AttendanceRecord.attended/conducted` becomes a DERIVED CACHE:
 * the ledger below is the only thing that creates or changes an attendance
 * fact, and `deriveCounts` produces the numbers every screen already reads.
 *
 * The counting rule is one line, and it is the whole safety property:
 *
 *     a non-`scheduled` occurrence contributes NOTHING
 *
 * not because a third outcome value is filtered out, but because the loop never
 * counts it. A cancelled class therefore cannot reach the denominator by
 * construction, and the mark underneath it is left exactly as the student made
 * it — counting again, unchanged, the moment the cancellation is reversed.
 */

export interface Counts {
  readonly attended: number;
  readonly conducted: number;
}

export const NO_COUNTS: Counts = { attended: 0, conducted: 0 };

/** One class on one date is one ledger row, whatever the caller does. */
export function occurrenceId(date: string, classId: string): string {
  return `${date}:${classId}`;
}

/** One subject has at most one opening balance, so the upgrade is idempotent. */
export function openingId(subjectCode: string): string {
  return `opening:${subjectCode}`;
}

/** The observation id for a synced row at a revision. Derived, never random. */
export function snapshotId(remoteRecordId: string, revision: number): string {
  return `snapshot:${remoteRecordId}:${String(revision)}`;
}

/** Where one occurrence stands on the SCHEDULE axis, on its own date. */
export function statusOf(
  overrides: readonly DayOverride[],
  date: string,
  classId: string,
): OccurrenceStatus {
  const id = occurrenceId(date, classId);
  return overrides.find((override) => override.id === id)?.status ?? 'scheduled';
}

/**
 * What one occurrence contributes, given what the schedule did to it.
 *
 * THE ONE PLACE THE TWO AXES MEET. Everything else in the product reads one
 * axis or the other, and this is the only function that combines them.
 */
export function contributionOf(
  occurrence: ClassOccurrence | undefined,
  status: OccurrenceStatus,
): Counts {
  if (status !== 'scheduled') return NO_COUNTS;
  if (occurrence === undefined) return NO_COUNTS;
  return { attended: occurrence.outcome === 'attended' ? 1 : 0, conducted: 1 };
}

/**
 * Every subject's figures, from the ledger alone.
 *
 * openings + scheduled occurrences + committed and pending adjustments. A
 * subject that has an opening always appears, so a subject whose classes were
 * all cancelled reads 0 of 0 rather than disappearing.
 */
export function deriveCounts(
  entries: readonly LedgerEntry[],
  overrides: readonly DayOverride[] = [],
): ReadonlyMap<string, Counts> {
  const status = new Map(overrides.map((override) => [override.id, override.status]));
  const totals = new Map<string, { attended: number; conducted: number }>();

  const bucket = (subjectCode: string) => {
    const existing = totals.get(subjectCode);
    if (existing !== undefined) return existing;
    const created = { attended: 0, conducted: 0 };
    totals.set(subjectCode, created);
    return created;
  };

  for (const entry of entries) {
    const into = bucket(entry.subjectCode);
    if (entry.kind === 'opening') {
      into.attended += entry.attended;
      into.conducted += entry.conducted;
      continue;
    }
    if (entry.kind === 'adjustment') {
      into.attended += entry.attendedDelta;
      into.conducted += entry.conductedDelta;
      continue;
    }
    const contribution = contributionOf(entry, status.get(entry.id) ?? 'scheduled');
    into.attended += contribution.attended;
    into.conducted += contribution.conducted;
  }

  /*
   * Clamped at the aggregate, never at the entry: an individual opening or
   * adjustment is kept exactly as recorded, but no subject is ever displayed as
   * having attended more classes than were held, or a negative number of them.
   */
  const derived = new Map<string, Counts>();
  for (const [subjectCode, { attended, conducted }] of totals) {
    const held = Math.max(0, conducted);
    derived.set(subjectCode, { attended: Math.min(held, Math.max(0, attended)), conducted: held });
  }
  return derived;
}

/**
 * The cache, brought back in line with the ledger.
 *
 * A record the ledger knows nothing about is LEFT ALONE rather than zeroed: a
 * failed or partial ledger read must not be able to wipe a student's figures,
 * and every subject the upgrade saw has an opening balance to be found under.
 */
export function reconcile(
  records: readonly AttendanceRecord[],
  derived: ReadonlyMap<string, Counts>,
  now: string = new Date().toISOString(),
): AttendanceRecord[] {
  return records.map((record) => {
    const counts = derived.get(record.subjectCode);
    if (counts === undefined) return record;
    if (counts.attended === record.attended && counts.conducted === record.conducted) return record;
    return { ...record, attended: counts.attended, conducted: counts.conducted, updatedAt: now };
  });
}

/* -------------------------------------------------------------------------- */
/* Adopting a synced figure — the only way a remote number enters the ledger  */
/* -------------------------------------------------------------------------- */

/** How long the student has to take an adoption back. */
export const ADOPT_UNDO_MS = 8_000;

/**
 * Whether a figure could be a real attendance aggregate.
 *
 * Checked on the TARGET — what the ledger will derive afterwards — and not on
 * the deltas, which are legitimately negative when a figure comes down. A
 * synced row that fails this is never adopted, because adopting it would put an
 * impossible percentage on the screen.
 */
export function adoptable(target: Counts): boolean {
  return (
    Number.isInteger(target.attended) &&
    Number.isInteger(target.conducted) &&
    target.attended >= 0 &&
    target.conducted >= 0 &&
    target.attended <= target.conducted
  );
}

/**
 * The adjustment that lands a subject exactly on a snapshot's figure.
 *
 * Returns null where the snapshot could not be a real aggregate; the caller
 * marks the observation rejected rather than writing anything. NEVER called
 * automatically: an adoption is an explicit decision, because the synced figure
 * cannot know about a class this device recorded as cancelled.
 */
export function adoptSnapshot(
  snapshot: RemoteSnapshot,
  derived: Counts,
  id: string,
  now: Date = new Date(),
): AttendanceAdjustment | null {
  const target: Counts = { attended: snapshot.attended, conducted: snapshot.conducted };
  if (!adoptable(target)) return null;
  return {
    kind: 'adjustment',
    id,
    subjectCode: snapshot.subjectCode,
    attendedDelta: target.attended - derived.attended,
    conductedDelta: target.conducted - derived.conducted,
    reason: 'adopt_remote_snapshot',
    /* Sync proves no provenance, so none is claimed. */
    sourceDevice: null,
    fromSnapshot: snapshot.id,
    createdAt: now.toISOString(),
    commitAfter: new Date(now.getTime() + ADOPT_UNDO_MS).toISOString(),
  };
}

/**
 * Whether an adjustment has passed its undo window.
 *
 * DERIVED FROM THE CLOCK rather than stored, so the row is written once and
 * never edited — which is what makes "committed adjustments are immutable" true
 * of the data and not merely of the intention. Undo inside the window rolls the
 * whole adoption back; after it, the repository refuses to touch the row.
 */
export function committed(
  adjustment: AttendanceAdjustment,
  now: Date | number = Date.now(),
): boolean {
  const at = typeof now === 'number' ? now : now.getTime();
  return at >= new Date(adjustment.commitAfter).getTime();
}

/** The occurrence for one class on one date, or undefined where unmarked. */
export function occurrenceFor(
  entries: readonly LedgerEntry[],
  date: string,
  classId: string,
): ClassOccurrence | undefined {
  const id = occurrenceId(date, classId);
  return entries.find(
    (entry): entry is ClassOccurrence => entry.kind === 'occurrence' && entry.id === id,
  );
}

/** Every opening balance, which is one per subject the upgrade saw. */
export function openings(entries: readonly LedgerEntry[]): readonly OpeningBalance[] {
  return entries.filter((entry): entry is OpeningBalance => entry.kind === 'opening');
}

/**
 * What the student effectively sees for one class: three states, two facts.
 *
 * `cancelled` is shown when the SCHEDULE says so, whatever the ledger holds
 * underneath — and the ledger row is still there, which is why reversing a
 * cancellation needs nothing restored.
 */
export function effectiveState(
  occurrence: ClassOccurrence | undefined,
  status: OccurrenceStatus,
): 'unmarked' | AttendanceOutcome | 'cancelled' {
  if (status !== 'scheduled') return 'cancelled';
  return occurrence?.outcome ?? 'unmarked';
}

/* -------------------------------------------------------------------------- */
/* Observing a synced aggregate without adopting it                           */
/* -------------------------------------------------------------------------- */

/** A synced attendance row, as the pull saw it. */
export interface ObservedAggregate {
  readonly remoteRecordId: string;
  readonly subjectCode: string;
  readonly attended: number;
  readonly conducted: number;
  readonly revision: number;
}

/**
 * Records that a synced row disagreed with this device, exactly once.
 *
 * ---------------------------------------------------------------------------
 * WHY SEEING THE SAME ROW TEN TIMES IS ONE OBSERVATION
 * ---------------------------------------------------------------------------
 *
 * Every sync re-reads the same rows. If each sighting created an observation,
 * the student would be asked the same question every few minutes, and a
 * dismissed one would come back. The id is therefore DERIVED from the record
 * and its revision, so a repeat sighting updates `lastSeenAt` and nothing else
 * — a duplicate is impossible by construction rather than by convention.
 *
 * A decision the student made is never undone by a sync: `kept`, `adopted` and
 * `rejected` survive any number of them. Only a NEW revision asks again, and it
 * supersedes the open observation it replaces rather than piling up beside it.
 */
export function noteSnapshot(
  existing: readonly RemoteSnapshot[],
  observed: ObservedAggregate,
  derived: Counts | undefined,
  now: string,
): readonly RemoteSnapshot[] {
  const id = snapshotId(observed.remoteRecordId, observed.revision);
  const agrees =
    derived !== undefined &&
    derived.attended === observed.attended &&
    derived.conducted === observed.conducted;

  const seen = existing.find((snapshot) => snapshot.id === id);
  if (seen !== undefined) {
    return existing.map((snapshot) =>
      snapshot.id === id
        ? {
            ...snapshot,
            lastSeenAt: now,
            /* The figures have converged, so there is nothing left to decide. */
            status: agrees && snapshot.status === 'open' ? 'superseded' : snapshot.status,
          }
        : snapshot,
    );
  }

  const superseded = existing.map((snapshot) =>
    snapshot.remoteRecordId === observed.remoteRecordId && snapshot.status === 'open'
      ? { ...snapshot, status: 'superseded' as const }
      : snapshot,
  );
  if (agrees) return superseded;

  return [
    ...superseded,
    {
      id,
      remoteRecordId: observed.remoteRecordId,
      subjectCode: observed.subjectCode,
      attended: observed.attended,
      conducted: observed.conducted,
      revision: observed.revision,
      status: 'open',
      firstSeenAt: now,
      lastSeenAt: now,
      adjustmentId: null,
    },
  ];
}

/** The student's decision about one observation. Sync never changes it back. */
export function decideSnapshot(
  snapshot: RemoteSnapshot,
  status: 'kept' | 'adopted' | 'rejected',
  adjustmentId: string | null = null,
): RemoteSnapshot {
  return { ...snapshot, status, adjustmentId };
}

/** Observations still waiting on the student, newest first. */
export function openSnapshots(snapshots: readonly RemoteSnapshot[]): readonly RemoteSnapshot[] {
  return snapshots
    .filter((snapshot) => snapshot.status === 'open')
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/* -------------------------------------------------------------------------- */
/* Counted, but not dated                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A subject's opening balance, created empty where it has none yet.
 *
 * Two things are genuinely undated: what a student types in when they start
 * tracking a course mid-semester, and the quick mark on the course list, which
 * says "one more class" without saying which. Both belong in the opening
 * balance — it is the entry kind that means "counted, with no date attached" —
 * and putting them there keeps `deriveCounts` equal to what the screen shows,
 * which is what stops a later sync quietly re-deriving them away.
 *
 * Dated marking is the other path entirely: it writes a `ClassOccurrence` for
 * one class on one date, and never touches this.
 */
export function openingFor(
  entries: readonly LedgerEntry[],
  subjectCode: string,
  now: string = new Date().toISOString(),
): OpeningBalance {
  const existing = entries.find(
    (entry): entry is OpeningBalance =>
      entry.kind === 'opening' && entry.subjectCode === subjectCode,
  );
  return (
    existing ?? {
      kind: 'opening',
      id: openingId(subjectCode),
      subjectCode,
      attended: 0,
      conducted: 0,
      migratedFrom: null,
      reconciliation: 'exact',
      unreconciledMarks: [],
      createdAt: now,
    }
  );
}

/** The same opening balance, moved by a delta. Never taken below zero. */
export function shiftOpening(
  opening: OpeningBalance,
  delta: { readonly attended: number; readonly conducted: number },
): OpeningBalance {
  const conducted = Math.max(0, opening.conducted + delta.conducted);
  return {
    ...opening,
    attended: Math.min(conducted, Math.max(0, opening.attended + delta.attended)),
    conducted,
  };
}

/** An opening balance holding exactly the figures the student typed. */
export function openingOf(
  subjectCode: string,
  counts: Counts,
  now: string = new Date().toISOString(),
): OpeningBalance {
  return {
    kind: 'opening',
    id: openingId(subjectCode),
    subjectCode,
    attended: counts.attended,
    conducted: counts.conducted,
    migratedFrom: null,
    reconciliation: 'exact',
    unreconciledMarks: [],
    createdAt: now,
  };
}
