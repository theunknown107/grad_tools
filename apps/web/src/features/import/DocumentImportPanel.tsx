/**
 * The one place a student hands GradTools an academic document.
 *
 * Authority: docs/08 §8.23 · M10A.9 §6, §7, §9, §11
 *
 * ---------------------------------------------------------------------------
 * ONE SURFACE, THREE DOCUMENTS
 * ---------------------------------------------------------------------------
 *
 * A result card, an academic calendar and a class timetable arrive the same
 * way: dropped in, identified from their own contents, and routed. The student
 * is never asked which parser to use, because the document already answers
 * that.
 *
 * This holds the wiring — which repositories the review screens read and
 * write — so the same panel can appear on Results, where a student who came to
 * look at marks may as well be able to add some, and at `/import`, which is
 * where the product points anyone who simply has documents to give it.
 * Duplicating the wiring in both places is how the two would drift.
 */

import { asStudentProfileId } from '../../domain/identity.js';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import type { TimetableSlot } from '../../domain/types.js';
import {
  useCalendars,
  useProfile,
  useResults,
  useTimetable,
  useTimetableImports,
} from '../../hooks/useCollection.js';
import { ResultImport } from '../results/ResultImport.js';

export function DocumentImportPanel({ onDone }: { readonly onDone: () => void }) {
  const { profile } = useProfile();
  const { items: results, save: saveResult } = useResults();
  const { items: calendars, save: saveCalendar } = useCalendars();
  const { items: timetable, save: saveSlot, remove: removeSlot } = useTimetable();
  const { items: timetableImports, save: saveImport } = useTimetableImports();

  /*
   * ONE ACTIVE TIMETABLE. A confirmed import REPLACES the stored classes rather
   * than adding to them: merging a revision into what is already there leaves a
   * week that is partly last month's, which is the failure where a student
   * turns up to a class that moved (M10A.8 §31).
   */
  const replaceTimetable = async (
    slots: readonly TimetableSlot[],
    record: Parameters<typeof saveImport>[0],
  ) => {
    for (const slot of timetable) await removeSlot(slot.id);
    for (const slot of slots) await saveSlot(slot);
    await saveImport(record);
  };

  return (
    <ResultImport
      profileId={profile?.id ?? asStudentProfileId('local')}
      schemeId={profile?.schemeId ?? vtu2022RuleSet.schemeId}
      savedSemesters={results.map((result) => result.semester)}
      savedCalendars={calendars}
      savedTimetables={timetableImports}
      onSave={(result) => {
        void saveResult(result);
      }}
      onSaveCalendar={(calendar) => {
        void saveCalendar(calendar);
      }}
      onSaveTimetable={(slots, record) => {
        void replaceTimetable(slots, record);
      }}
      onCancel={onDone}
    />
  );
}
