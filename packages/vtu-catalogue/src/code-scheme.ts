/**
 * The VTU scheme a course code's SHAPE belongs to.
 *
 *   1BMATC101   2025   (a leading 1B; docs/47)
 *   BCS401      2022   (a leading B and a letter)
 *   21CS51      2021   (a two-digit year prefix, as 18CS51, 17CS51,
 *   18CS51      2018    15CS51 and 10CS51 are for their schemes)
 *
 * One definition, used by the device's importer (scheme compatibility) and by
 * the server's document-recognition gate. An unrecognised shape says nothing
 * rather than guessing. The `21…` prefix follows the 18/17/15/10 convention
 * and has not been checked against a real 2021 grade card (OQ-066).
 */

const YEAR_PREFIX: Readonly<Record<string, string>> = {
  '21': 'vtu-2021',
  '18': 'vtu-2018',
  '17': 'vtu-2017',
  '15': 'vtu-2015',
  '10': 'vtu-2010',
};

/** The scheme id (`vtu-2022`…) a course code's shape belongs to, or null. */
export function codeScheme(code: string): string | null {
  const normalized = code.trim().toUpperCase();
  if (/^1B[A-Z]{2,6}\d{3}[A-Z]?$/.test(normalized)) return 'vtu-2025';
  if (/^B[A-Z]{2,6}\d{3}[A-Z]?$/.test(normalized)) return 'vtu-2022';
  const year = /^(\d{2})[A-Z]{2,6}\d{2,3}[A-Z]?$/.exec(normalized)?.[1];
  return year === undefined ? null : (YEAR_PREFIX[year] ?? null);
}
