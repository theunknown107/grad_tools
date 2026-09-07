/**
 * The one academic reading every screen shares.
 *
 * Authority: Phase 7C §18, §19, §30
 *
 * ---------------------------------------------------------------------------
 * ONE STATE, FOUR SCREENS
 * ---------------------------------------------------------------------------
 *
 * The dashboard, the results page, the degree page and the analytics page each
 * read the same three collections and each derived their own answers from
 * them. Four readings of one record set is four chances for a student's CGPA
 * to be right on one screen and wrong on another, and no test can catch a
 * disagreement that only exists between two files (§18).
 *
 * So the derivation happens once, here, and the screens render it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS NEEDS NO CACHE OF ITS OWN (§19, §30)
 * ---------------------------------------------------------------------------
 *
 * `useCollection` holds its records in React state and updates that state
 * optimistically BEFORE awaiting storage, so a save re-renders every consumer
 * without a refetch and without a browser reload. This memoises on the arrays
 * it is given, which means the whole derivation re-runs exactly when a record
 * actually changes — and not on every keystroke elsewhere in the tree.
 */

import { useMemo } from 'react';
import { academicStatistics, type AcademicStatistics } from '../domain/statistics.js';
import { useBacklogs, useResults, useSemesters } from './useCollection.js';

export interface AcademicState {
  readonly statistics: AcademicStatistics;
  /** True while any of the three collections is still being read from storage. */
  readonly loading: boolean;
}

export function useAcademicState(): AcademicState {
  const { items: semesters, loading: loadingSemesters } = useSemesters();
  const { items: results, loading: loadingResults } = useResults();
  const { items: backlogs, loading: loadingBacklogs } = useBacklogs();

  const statistics = useMemo(
    () =>
      academicStatistics({
        semesters,
        results,
        backlogs,
        /*
         * THE CREDIT REQUIREMENT IS NOT ASSUMED (M6 §13). There is no
         * universal VTU total in verified reference data, and inventing one
         * would put a fabricated denominator under a real numerator. Credits
         * remaining reports itself unavailable until a verified source
         * supplies it — the scheme importer is where that will come from.
         */
        totalCreditsRequired: null,
      }),
    [semesters, results, backlogs],
  );

  return { statistics, loading: loadingSemesters || loadingResults || loadingBacklogs };
}
