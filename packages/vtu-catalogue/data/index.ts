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
import vtuColleges from './vtu-colleges.json' with { type: 'json' };
import vtuBranches2022 from './vtu-branches-2022.json' with { type: 'json' };

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
/**
 * Every course of a scheme, or — with `programme` — only that programme's.
 *
 * The programme filter matters once the catalogue holds more than one branch: a
 * code the university reuses across programmes (e.g. `BBOK407`, 3 credits in one
 * and 2 in another) must be read against the student's own programme, not
 * whichever row happens to be last. Without the filter this returns every
 * programme's rows, as it always did, and `buildSubjectIndex` is the net that
 * stops a divergent credit resolving to an arbitrary value.
 */
export function coursesForScheme(
  scheme: string,
  programme?: string | null,
): readonly CatalogueCourse[] {
  const year = /(20\d{2})/.exec(scheme)?.[1] ?? scheme;
  return CATALOGUES.flatMap((catalogue) =>
    catalogue.courses.filter(
      (course) =>
        course.schemeYear === year &&
        (programme === undefined || programme === null || course.programme === programme),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Transcribed reference lists (one-time, human-reviewable; see README.md)     */
/* -------------------------------------------------------------------------- */

export interface TranscribedCollege {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly region: string;
  /** Never stated by the source page, so always null until a person verifies it. */
  readonly isAutonomous: boolean | null;
}

export interface TranscribedBranch {
  readonly id: string;
  readonly labelAsPrinted: string;
  readonly schemeUrl: string | null;
}

export interface TranscriptionSource {
  readonly url: string;
  readonly retrievedAt: string;
  readonly method: string;
  readonly reviewed: boolean;
  readonly note: string;
}

export const VTU_COLLEGES: {
  readonly source: TranscriptionSource & {
    /** Rows listed per region heading in this file. */
    readonly countsByRegion: Readonly<Record<string, number>>;
    /** Totals the page itself reported, where it reported one; may exceed what was listed. */
    readonly reportedCountsByRegion: Readonly<Record<string, number>>;
    readonly entriesWithoutCode: number;
    readonly duplicateCodes: Readonly<Record<string, readonly string[]>>;
  };
  readonly entries: readonly TranscribedCollege[];
} = vtuColleges;

export const VTU_BRANCHES_2022: {
  readonly source: TranscriptionSource & {
    readonly schemesListed: readonly string[];
    readonly firstYearStreams2022: readonly { labelAsPrinted: string; schemeUrl: string }[];
  };
  readonly entries: readonly TranscribedBranch[];
} = vtuBranches2022;

/**
 * The courses a student in `branchLabel` should see, scoped so a shared code
 * resolves to THEIR programme's credits.
 *
 * The bridge is the official document itself: a branch's `schemeUrl` is the
 * `sourceUrl` of that branch's own scheme rows (verified on the published
 * data). So from the third semester on, only rows read from the branch's own
 * document are kept. The first two semesters are left unfiltered — they come
 * from shared first-year stream documents, not the branch document, and where
 * two streams disagree `buildSubjectIndex` resolves the credit to unknown
 * rather than guessing. An unknown or unlisted branch keeps every row, so
 * nothing is dropped on a guess; the same net then applies.
 */
export function coursesForBranch(
  scheme: string,
  branchLabel: string | null,
): readonly CatalogueCourse[] {
  const all = coursesForScheme(scheme);
  const schemeUrl =
    branchLabel === null
      ? null
      : (VTU_BRANCHES_2022.entries.find((entry) => entry.labelAsPrinted === branchLabel)
          ?.schemeUrl ?? null);
  if (schemeUrl === null) return all;
  return all.filter((course) => course.semester <= 2 || course.provenance.sourceUrl === schemeUrl);
}
