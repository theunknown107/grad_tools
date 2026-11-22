/**
 * Does a course on an imported card belong to the student's own scheme?
 *
 * VTU course codes carry their scheme in their shape:
 *
 *   1BMATC101   2025   (a leading 1B; docs/47)
 *   BCS401      2022   (a leading B and a letter)
 *   21CS51      2021   (a two-digit year prefix, as 18CS51, 17CS51,
 *   18CS51      2018    15CS51 and 10CS51 are for their schemes)
 *
 * A mismatch is NOT always an error. VTU lets a student with backlogs sit the
 * EQUIVALENT course of a newer scheme (course-subject equivalences,
 * https://vtu.ac.in/course-subject-equivalences/):
 *
 *   notification 1812 (23.07.2024): 2004/2010/2014/2015/2017-scheme students
 *     sit 2018-scheme equivalents;
 *   notification 4718 (05.12.2024): 2021-scheme students sit 2022-scheme
 *     equivalents — for semester 1–4 backlogs only.
 *
 * So such a course is kept exactly as printed, never re-mapped to an old-scheme
 * course (which would invent a record), and the student is told which
 * notification may explain it. The student's own scheme is never changed from
 * a card.
 *
 * The 2021 `21…` prefix follows the same convention as 18/17/15/10 but has not
 * been checked against a real 2021 grade card here; an unrecognised shape says
 * nothing rather than guessing.
 */

import { codeScheme } from '@gradtools/vtu-catalogue';

export type CompatibilityStatus = 'same' | 'equivalence' | 'mismatch' | 'unknown';

/** The scheme a course code's shape belongs to (@gradtools/vtu-catalogue). */
export { codeScheme };

const TO_2018 = new Set(['vtu-2010', 'vtu-2015', 'vtu-2017']);

export function schemeCompatibility(
  code: string,
  profileSchemeId: string,
): { readonly status: CompatibilityStatus; readonly message: string | null } {
  const scheme = codeScheme(code);
  if (scheme === null) return { status: 'unknown', message: null };
  if (scheme === profileSchemeId) return { status: 'same', message: null };
  if (profileSchemeId === 'vtu-2021' && scheme === 'vtu-2022') {
    return {
      status: 'equivalence',
      message: `${code} is a 2022-scheme course. VTU notification 4718 lets 2021-scheme students sit 2022-scheme equivalents for semester 1–4 backlogs; if this is one, it is kept as the course you sat.`,
    };
  }
  if (TO_2018.has(profileSchemeId) && scheme === 'vtu-2018') {
    return {
      status: 'equivalence',
      message: `${code} is a 2018-scheme course. VTU notification 1812 lets older-scheme students sit 2018-scheme equivalents; if this is one, it is kept as the course you sat.`,
    };
  }
  return {
    status: 'mismatch',
    message: `${code} belongs to a different VTU scheme from your profile. It has not been reinterpreted — check before importing.`,
  };
}
