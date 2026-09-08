/**
 * The generated academic catalogue, as data the app can read.
 *
 * Authority: Phase 7D §26, §27
 *
 * GENERATED, NOT WRITTEN. `pnpm vtu:normalize` produces `vtu-2022.json` from
 * documents the crawler retrieved from VTU, and this module is the typed door
 * onto it. Nothing here is maintained by hand — editing the JSON would be
 * exactly the manually-maintained catalogue this phase exists to abolish.
 *
 * It is committed because it is NORMALIZED DATA with provenance on every row,
 * not a binary dump: §29 keeps the PDFs out of Git and the records in.
 */
import type { Catalogue, CatalogueCourse } from '../src/types.js';
import vtu2022 from './vtu-2022.json' with { type: 'json' };

export const VTU_2022: Catalogue = vtu2022 as Catalogue;

/** Every catalogue GradTools ships, newest scheme last. */
export const CATALOGUES: readonly Catalogue[] = [VTU_2022];

/**
 * The courses of one scheme.
 *
 * A scheme year is the namespace (§18): a 2025 record must never answer for a
 * 2022 student, so the year is required rather than defaulted.
 *
 * ACCEPTS EITHER SPELLING. The rule sets identify a scheme as `vtu-2022` and
 * the catalogue records the year the document states, `2022`. Requiring an
 * exact match made this return NOTHING for every real caller — silently, since
 * an empty catalogue looks exactly like a scheme nobody has data for.
 */
export function coursesForScheme(scheme: string): readonly CatalogueCourse[] {
  const year = /(20\d{2})/.exec(scheme)?.[1] ?? scheme;
  return CATALOGUES.flatMap((catalogue) =>
    catalogue.courses.filter((course) => course.schemeYear === year),
  );
}
