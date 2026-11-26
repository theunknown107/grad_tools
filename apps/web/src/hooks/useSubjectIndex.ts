/**
 * The subject index, built once and read by every screen that needs a name.
 *
 * Authority: docs/08 §8.20 · docs/32 OQ-051 · SUBJECT_METADATA_AUDIT (2026-10-25)
 *
 * ONE PLACE, SO THERE IS ONE ANSWER (M10A.1 §11). Before this, each feature
 * rendered whatever title its own record happened to carry — and the timetable,
 * which carries none, rendered a bare code. Letting each screen "look up the
 * other collections when it needs to" is how five slightly different resolution
 * rules end up in five components, disagreeing at the edges.
 *
 * THE VERIFIED CATALOGUE IS CONSULTED, because it SHIPS WITH THE APP. It is a
 * bundled JSON (`@gradtools/vtu-catalogue/data`), read synchronously with no
 * network — the same source the result editor already passes in. Omitting it
 * only made every screen ask the student to confirm a name and credits the
 * official scheme already states (PE, Indian Constitution, Communicative
 * English, …). It is scoped to the student's own branch so a code shared across
 * programmes resolves to THEIR credits, and `buildSubjectIndex`'s conflict-aware
 * rule still refuses to guess when the branch is unknown or the rows disagree.
 */

import { useMemo } from 'react';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import { coursesForBranch } from '@gradtools/vtu-catalogue/data';
import {
  buildSubjectIndex,
  type CatalogueSubject,
  type SubjectIdentity,
} from '../domain/subjects.js';
import {
  useAttendance,
  useBacklogs,
  useProfile,
  useResults,
  useSchemeCourses,
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
  const schemeCourses = useSchemeCourses();
  const { profile } = useProfile();

  const schemeId = profile?.schemeId ?? vtu2022RuleSet.schemeId;
  const branch = profile?.branch ?? null;

  const catalogue: readonly CatalogueSubject[] = useMemo(
    () => [
      ...coursesForBranch(schemeId, branch).map((course) => ({
        code: course.code,
        title: course.title,
        semester: course.semester,
        credits: course.credits,
        hasSee: null,
      })),
      ...schemeCourses.items.map((course) => ({
        code: course.code,
        title: course.title,
        semester: course.semester,
        credits: course.credits,
        hasSee: null,
      })),
    ],
    [schemeId, branch, schemeCourses.items],
  );

  const index = useMemo(
    () =>
      buildSubjectIndex({
        catalogue,
        results: results.items,
        attendance: attendance.items,
        timetable: timetable.items,
        backlogs: backlogs.items,
        semesterSubjects: semesterSubjects.items,
      }),
    [
      catalogue,
      results.items,
      attendance.items,
      timetable.items,
      backlogs.items,
      semesterSubjects.items,
    ],
  );

  return {
    index,
    loading:
      results.loading ||
      attendance.loading ||
      timetable.loading ||
      backlogs.loading ||
      semesterSubjects.loading ||
      schemeCourses.loading,
  };
}
