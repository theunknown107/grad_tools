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
import type { SchemeCourse, TimetableSlot } from '../../domain/types.js';
import {
  useCalendars,
  useProfile,
  useResults,
  useSchemeCourses,
  useSemesterSubjects,
  useTimetable,
  useTimetableImports,
} from '../../hooks/useCollection.js';
import { ResultImport } from '../results/ResultImport.js';

export function DocumentImportPanel({
  onDone,
  title,
}: {
  readonly onDone: () => void;
  /** Omitted where the page heading already says it. */
  readonly title?: string | undefined;
}) {
  const { profile } = useProfile();
  const { items: results, save: saveResult } = useResults();
  /*
   * The student's own semester plan, read so the importer can reuse credits
   * they have already given rather than asking for them a second time. See
   * `creditsFor` in domain/subjects.
   */
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: calendars, save: saveCalendar } = useCalendars();
  const { items: timetable, save: saveSlot, remove: removeSlot } = useTimetable();
  const { items: timetableImports, save: saveImport } = useTimetableImports();
  const {
    items: schemeCourses,
    save: saveSchemeCourse,
    remove: removeSchemeCourse,
  } = useSchemeCourses();

  /*
   * A RE-IMPORTED SCHEME REPLACES THE CODES IT COVERS.
   *
   * Two catalogue credit figures for one course code is a state nothing can
   * resolve — both would carry the same "VTU catalogue" label and neither
   * would be more recent than the other from the reading's point of view. A
   * corrected or reissued scheme is the usual reason to import one twice, so
   * the codes it names are dropped first and written fresh.
   *
   * Codes it does NOT name are left alone: a student may hold the first-year
   * scheme and the third-to-eighth one, and importing the second must not
   * erase the first.
   */
  const replaceScheme = async (courses: readonly SchemeCourse[]) => {
    const incoming = new Set(courses.map((course) => course.code));
    for (const existing of schemeCourses) {
      if (incoming.has(existing.code)) await removeSchemeCourse(existing.id);
    }
    for (const course of courses) await saveSchemeCourse(course);
  };

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
      title={title}
      profileId={profile?.id ?? asStudentProfileId('local')}
      schemeId={profile?.schemeId ?? vtu2022RuleSet.schemeId}
      savedSemesters={results.map((result) => result.semester)}
      savedResults={results}
      semesterSubjects={semesterSubjects}
      savedCalendars={calendars}
      savedTimetables={timetableImports}
      /*
       * THE PROMISES ARE RETURNED, NOT VOIDED.
       *
       * Each of these was `void save(...)`, which threw the result away twice
       * over: the review could not wait for the write, so it announced success
       * before anything had reached storage — and a REJECTED write became an
       * unhandled rejection nobody saw, leaving a record that looked saved,
       * was only in memory, and vanished on the next reload.
       */
      onSave={saveResult}
      onSaveCalendar={saveCalendar}
      onSaveTimetable={replaceTimetable}
      onSaveScheme={replaceScheme}
      onCancel={onDone}
    />
  );
}
