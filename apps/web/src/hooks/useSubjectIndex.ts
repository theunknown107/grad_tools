/**
 * The subject index, built once and read by every screen that needs a name.
 *
 * Authority: docs/08 §8.20 · docs/32 OQ-051
 *
 * ONE PLACE, SO THERE IS ONE ANSWER (M10A.1 §11). Before this, each feature
 * rendered whatever title its own record happened to carry — and the timetable,
 * which carries none, rendered a bare code. Letting each screen "look up the
 * other collections when it needs to" is how five slightly different resolution
 * rules end up in five components, disagreeing at the edges.
 *
 * Every read is local. The catalogue is deliberately NOT fetched here: a
 * student's own records already name their own subjects, and making a name on
 * the timetable wait for the network would break local-first for a cosmetic
 * gain (M10A.1 §21). Screens that already hold catalogue rows — the result
 * editor does — pass them to `buildSubjectIndex` themselves.
 */

import { useMemo } from 'react';
import { buildSubjectIndex, type SubjectIdentity } from '../domain/subjects.js';
import {
  useAttendance,
  useBacklogs,
  useResults,
  useSemesterSubjects,
  useTimetable,
} from './useCollection.js';

export interface SubjectIndexState {
  readonly index: ReadonlyMap<string, SubjectIdentity>;
  readonly loading: boolean;
}

export function useSubjectIndex(): SubjectIndexState {
  const results = useResults();
  const attendance = useAttendance();
  const timetable = useTimetable();
  const backlogs = useBacklogs();
  const semesterSubjects = useSemesterSubjects();

  const index = useMemo(
    () =>
      buildSubjectIndex({
        results: results.items,
        attendance: attendance.items,
        timetable: timetable.items,
        backlogs: backlogs.items,
        semesterSubjects: semesterSubjects.items,
      }),
    [results.items, attendance.items, timetable.items, backlogs.items, semesterSubjects.items],
  );

  return {
    index,
    loading:
      results.loading ||
      attendance.loading ||
      timetable.loading ||
      backlogs.loading ||
      semesterSubjects.loading,
  };
}
