/**
 * The ONE path that changes an attendance fact.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS ONLY ONE
 * ---------------------------------------------------------------------------
 *
 * Before this, two screens incremented the counters independently: the
 * timetable wrote a `ClassMark` and adjusted the totals, and the attendance
 * page adjusted the totals without writing a mark. The same class could
 * therefore be counted twice — once from each screen — and nothing in the data
 * could tell that it had been.
 *
 * Every write now goes through here: one ledger row per class per date, the
 * derived cache rewritten from the ledger immediately afterwards, and the
 * schedule kept on its own axis. A caller cannot get the arithmetic wrong,
 * because it does not do any.
 */

import { useCallback } from 'react';
import {
  deriveCounts,
  effectiveState,
  occurrenceFor,
  occurrenceId,
  openingOf,
  statusOf,
} from '../domain/attendance.js';
import { overrideId } from '../domain/day-schedule.js';
import { asStudentProfileId } from '../domain/identity.js';
import type {
  AttendanceOutcome,
  AttendanceRecord,
  ClassOccurrence,
  DayOverride,
  LedgerEntry,
} from '../domain/types.js';
import { newId } from '../lib/id.js';
import {
  useAttendance,
  useAttendanceLedger,
  useProfile,
  useTimetableOverrides,
} from './useCollection.js';
import { useLatest } from './useNow.js';

/** What the student sees on the control: three states, from two facts. */
export type MarkState = 'unmarked' | AttendanceOutcome | 'cancelled';

/** Everything a write needs to know about the class being marked. */
export interface MarkableClass {
  readonly classId: string;
  /** 'YYYY-MM-DD', from the clock rather than from the render (`useNow`). */
  readonly date: string;
  readonly subjectCode: string;
  readonly subjectTitle: string | null;
  readonly startTime: string;
  readonly endTime: string;
}

export interface MarkClassApi {
  /** What this class is showing now. */
  readonly stateOf: (date: string, classId: string) => MarkState;
  readonly set: (klass: MarkableClass, next: MarkState) => Promise<void>;
  readonly loading: boolean;
}

function normalise(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

export function useMarkClass(): MarkClassApi {
  const {
    items: entries,
    loading: ledgerLoading,
    save: saveEntry,
    remove: removeEntry,
  } = useAttendanceLedger();
  const { items: overrides, save: saveOverride, remove: removeOverride } = useTimetableOverrides();
  const { items: records, save: saveRecord } = useAttendance();
  const { profile } = useProfile();

  const stateOf = useCallback(
    (date: string, classId: string): MarkState =>
      effectiveState(occurrenceFor(entries, date, classId), statusOf(overrides, date, classId)),
    [entries, overrides],
  );

  /*
   * WRITES READ THE LATEST STATE, NOT THE STATE THIS RENDER CLOSED OVER.
   *
   * A toast's Undo is pressed seconds after the mark that produced it, by which
   * time the ledger has moved on. Deciding from the arrays captured when the
   * callback was built would compare the new state against the old one, see no
   * change, and do nothing at all — the undo would silently fail.
   */
  const latest = useLatest({ entries, overrides, records, profile });

  const set = useCallback(
    async (klass: MarkableClass, next: MarkState): Promise<void> => {
      const { entries, overrides, records, profile } = latest.current;
      const id = occurrenceId(klass.date, klass.classId);
      const existing = occurrenceFor(entries, klass.date, klass.classId);
      const status = statusOf(overrides, klass.date, klass.classId);
      if (effectiveState(existing, status) === next) return;

      /*
       * The two axes are written separately, and a cancellation NEVER touches
       * the student's own record: it stops counting while the schedule says the
       * class did not happen, and counts again if that is reversed.
       */
      let nextEntries: readonly LedgerEntry[] = entries;
      let nextOverrides: readonly DayOverride[] = overrides;

      if (next === 'cancelled') {
        const override: DayOverride = {
          id: overrideId(klass.date, klass.classId),
          profileId: profile?.id ?? asStudentProfileId('local'),
          date: klass.date,
          classId: klass.classId,
          status: 'cancelled',
          addition: null,
          replacedBy: null,
          createdAt: new Date().toISOString(),
        };
        nextOverrides = [
          ...overrides.filter((candidate) => candidate.id !== override.id),
          override,
        ];
        await saveOverride(override);
      } else {
        if (status !== 'scheduled') {
          nextOverrides = overrides.filter(
            (candidate) => candidate.id !== overrideId(klass.date, klass.classId),
          );
          await removeOverride(overrideId(klass.date, klass.classId));
        }

        if (next === 'unmarked') {
          nextEntries = entries.filter((entry) => entry.id !== id);
          if (existing !== undefined) await removeEntry(id);
        } else {
          const occurrence: ClassOccurrence = {
            kind: 'occurrence',
            id,
            classId: klass.classId,
            date: klass.date,
            subjectCode: normalise(klass.subjectCode),
            subjectTitle: klass.subjectTitle,
            startTime: klass.startTime,
            endTime: klass.endTime,
            outcome: next,
            markedAt: new Date().toISOString(),
          };
          nextEntries = [...entries.filter((entry) => entry.id !== id), occurrence];
          await saveEntry(occurrence);
        }
      }

      const code = normalise(klass.subjectCode);

      /*
       * A SUBJECT THE LEDGER HAS NEVER HEARD OF KEEPS ITS FIGURES.
       *
       * The upgrade gives every stored record an opening balance, but a record
       * that arrived afterwards — from a merge, or an older build — may have
       * none. Deriving that subject from the ledger alone would silently
       * replace "30 of 40" with "1 of 1" the first time a class was marked. So
       * the counters become the opening balance, exactly as the upgrade would
       * have written them.
       */
      const record = records.find((candidate) => normalise(candidate.subjectCode) === code);
      if (
        record !== undefined &&
        (record.attended > 0 || record.conducted > 0) &&
        /* What the ledger held BEFORE this mark: the row just written is not
           evidence that the subject was already being counted. */
        !entries.some((entry) => normalise(entry.subjectCode) === code)
      ) {
        const opening = openingOf(code, {
          attended: record.attended,
          conducted: record.conducted,
        });
        nextEntries = [...nextEntries, opening];
        await saveEntry(opening);
      }

      /*
       * The cache is rewritten from what the ledger now says, rather than by
       * adding a delta to what it said before: there is one arithmetic in the
       * product and it lives in `deriveCounts`.
       */
      const derived = deriveCounts(nextEntries, nextOverrides).get(code) ?? {
        attended: 0,
        conducted: 0,
      };
      const updated: AttendanceRecord =
        record === undefined
          ? {
              id: newId(),
              profileId: profile?.id ?? asStudentProfileId('local'),
              semester: profile?.currentSemester ?? 1,
              subjectCode: code,
              subjectTitle: klass.subjectTitle ?? code,
              attended: derived.attended,
              conducted: derived.conducted,
              updatedAt: new Date().toISOString(),
            }
          : {
              ...record,
              attended: derived.attended,
              conducted: derived.conducted,
              updatedAt: new Date().toISOString(),
            };
      await saveRecord(updated);
    },
    [latest, saveEntry, removeEntry, saveOverride, removeOverride, saveRecord],
  );

  return { stateOf, set, loading: ledgerLoading };
}
