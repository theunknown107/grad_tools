/**
 * What a catalogue publication is allowed to contain, and what is held back.
 *
 * Authority: catalogue title-extraction audit (2026-10-24/25) §5, §6.
 *
 * Two orthogonal ideas, kept separate on purpose:
 *
 *  - SCOPE is which records this publication is FOR. The supported VTU 2022
 *    target is the non-autonomous affiliated-college B.E. scheme as the curated
 *    baseline already ships it: the CSBS programme and the first-year CSE and
 *    Civil streams. A record outside the scope is simply not this publication's
 *    concern — it is NOT thereby certified correct, and the validator still
 *    reports its defects (§5).
 *
 *  - An EXCLUSION is an in-scope record held back because it cannot be published
 *    correctly from the source as read. Each carries its own reason and the
 *    evidence for it, is matched by the NARROWEST identity that isolates the
 *    defective context, and never certifies anything: an excluded record is
 *    withheld, not blessed, and an exclusion for one context must not remove a
 *    legitimate record of the same code in another (§6).
 *
 * The same config drives BOTH the publication gate (`validateCatalogue`) and the
 * emitter, so what is validated is exactly what is written.
 */

export interface PublicationScope {
  readonly schemeYear: string;
  /** Programmes published by name, as the catalogue stores programme_name. */
  readonly programmes: readonly string[];
  /** First-year streams published by stream id, as stored in stream_id. */
  readonly streams: readonly string[];
}

export interface CatalogueExclusion {
  readonly schemeYear: string;
  readonly code: string;
  /** Narrowing fields — null means "any", so omit them to widen deliberately. */
  readonly programme?: string | null;
  readonly streamId?: string | null;
  readonly semester?: number | null;
  readonly reason: string;
  readonly evidence: string;
}

/** The identity fields any scope/exclusion decision is made from. */
export interface PublicationIdentity {
  readonly schemeYear: string;
  readonly code: string;
  readonly programme: string | null;
  readonly streamId: string | null;
  readonly semester: number;
}

export const PUBLICATION_SCOPE_2022: PublicationScope = {
  schemeYear: '2022',
  programmes: ['Computer Science & Business System'],
  streams: ['cse-stream', 'civil-engineering-stream'],
};

/**
 * In-scope records held back from the 2022 publication, with evidence. Every
 * entry was established against the isolated audit database and the source.
 */
export const CATALOGUE_EXCLUSIONS_2022: readonly CatalogueExclusion[] = [
  {
    schemeYear: '2022',
    code: 'BITDK158',
    reason: 'Duplicate mis-code of BIDTK158 — a TD↔DT transposition of one and the same first-year slot. Structural, so it holds even though the department-column fix now reads its title cleanly.',
    evidence:
      'In the civil-stream first-year document BSFHK158 is a member of TWO slots in one semester, BIDTK158 and BITDK158 — the "courses offered by two different slots" validator failure. BIDTK158 is the real code ("Innovation and Design Thinking"); BITDK158 is the transposed reading of the same slot. Publishing BIDTK158 covers the course; keeping BITDK158 double-counts it and is the structural defect.',
  },
  {
    schemeYear: '2022',
    code: 'BESCK104x',
    programme: 'CSE Stream Scheme (CSE/ISC/BT)',
    reason: 'The CSE-stream Engineering-Science-I slot has no clean reading — every reading keeps a leading "Respective Engg" teaching note the column fix (a right edge) cannot strip. Narrowed to CSE; the civil-stream reading is clean and kept, and the concrete options BESCK104A–E publish cleanly.',
    evidence:
      'CSE-stream readings are all "Respective Engg Engineering Science Course-I [Dept]"; civil-stream reads "Engineering Science Course-I" cleanly and is NOT excluded.',
  },
  /*
   * The two sem-8 NPTEL online-elective slots (BCB801x "Professional Elective
   * (Online Courses) …", BCB802x "Open Elective (Online Courses) …") are kept —
   * they carry the elective's real description. Their B/C/D option rows have NO
   * title in the source ("BOS will publish courses based on the availability"),
   * so the extractor and the shipped baseline alike fall back to the bare code.
   * A code is not a title; the slot represents the elective, so the untitled
   * option placeholders are withheld.
   */
  ...['BCB801B', 'BCB801C', 'BCB801D', 'BCB802B', 'BCB802C', 'BCB802D'].map((code) => ({
    schemeYear: '2022',
    code,
    reason: 'Untitled NPTEL online-elective option placeholder — the source gives no title (BOS publishes the courses later), so only the bare code is available. The slot (BCB801x / BCB802x) carries the elective.',
    evidence:
      'On the CSBS sem-8 page the option row prints "BOS will publish courses based on the availability" against the A option and nothing against B/C/D; the baseline shipped B/C/D with the code as the title.',
  })),
];

const normalise = (value: string | null | undefined): string => (value ?? '').trim();

/* -------------------------------------------------------------------------- */
/* Merging a fresh candidate with the curated baseline (§4)                   */
/* -------------------------------------------------------------------------- */

export type MergeAction =
  | 'keep-baseline'
  | 'replace-with-candidate'
  | 'add-candidate'
  | 'drop-excluded'
  | 'drop-candidate'
  | 'blocked';

export interface MergeDecision {
  readonly key: string;
  readonly action: MergeAction;
  readonly reason: string;
  readonly baselineTitle?: string;
  readonly candidateTitle?: string;
}

export interface MergeRow {
  readonly schemeYear: string;
  readonly programme: string | null;
  readonly streamId?: string | null;
  readonly semester: number;
  readonly code: string;
  readonly title: string;
}

export interface MergeResult<T extends MergeRow> {
  readonly merged: readonly T[];
  readonly decisions: readonly MergeDecision[];
  /** Identities that cannot be published and must not be promoted (§4 Case F). */
  readonly blockers: readonly MergeDecision[];
}

/**
 * Combine a freshly extracted candidate with the curated baseline (§4).
 *
 * Matched by the narrowest identity both carry — scheme, programme, semester,
 * code — because a code is reused across programmes and must not collapse (§4.1;
 * stream id is not in the key, as the baseline predates that field). For each
 * identity, in order:
 *
 *   1. An EXCLUDED identity is dropped from both, with its reason — this is how
 *      a garbled duplicate like BITDK158 leaves the catalogue (§6).
 *   2. A CLEAN baseline title is kept as-is. The baseline is curated and
 *      source-verified (the PE correction lives here), so a clean baseline value
 *      is never overwritten by a different candidate reading (§4 C/D, §4.3).
 *   3. Otherwise a CLEAN candidate title is taken — it corrects a garbled
 *      baseline row (§4 B/F) or adds a new in-scope course (§4 A/G).
 *   4. A baseline row that is neither excluded nor clean, with no clean
 *      candidate to replace it, BLOCKS promotion — neither value is established
 *      (§4 F). It is reported, not silently kept or dropped.
 *   5. A candidate-only row that is not clean is dropped, never added (§4 A).
 *
 * `isClean` is injected so the one title-quality implementation is shared with
 * the gate. Deterministic and independent of input order: identities are sorted.
 */
export function mergeCatalogue<T extends MergeRow>(
  baseline: readonly T[],
  candidate: readonly T[],
  exclusions: readonly CatalogueExclusion[],
  isClean: (title: string) => boolean,
): MergeResult<T> {
  const key = (r: MergeRow): string =>
    `${r.schemeYear}|${normalise(r.programme)}|${String(r.semester)}|${r.code}`;
  const identityOf = (r: MergeRow): PublicationIdentity => ({
    schemeYear: r.schemeYear,
    code: r.code,
    programme: r.programme,
    streamId: r.streamId ?? null,
    semester: r.semester,
  });
  const baseById = new Map(baseline.map((r) => [key(r), r]));
  const candById = new Map(candidate.map((r) => [key(r), r]));

  const merged: T[] = [];
  const decisions: MergeDecision[] = [];
  const blockers: MergeDecision[] = [];
  const record = (list: MergeDecision[], d: MergeDecision): void => {
    list.push(d);
    decisions.push(d);
  };

  for (const k of [...new Set([...baseById.keys(), ...candById.keys()])].sort()) {
    const b = baseById.get(k);
    const c = candById.get(k);
    const info = {
      key: k,
      ...(b === undefined ? {} : { baselineTitle: b.title }),
      ...(c === undefined ? {} : { candidateTitle: c.title }),
    };
    const excl = exclusionFor(identityOf((b ?? c) as T), exclusions);
    if (excl !== null) {
      decisions.push({ ...info, action: 'drop-excluded', reason: excl.reason });
      continue;
    }
    if (b !== undefined && isClean(b.title)) {
      merged.push(b);
      decisions.push({ ...info, action: 'keep-baseline', reason: 'baseline title is clean and verified' });
    } else if (c !== undefined && isClean(c.title)) {
      merged.push(c);
      decisions.push({
        ...info,
        action: b === undefined ? 'add-candidate' : 'replace-with-candidate',
        reason: b === undefined ? 'new in-scope course, clean' : 'candidate corrects a corrupted baseline title',
      });
    } else if (b !== undefined) {
      record(blockers, { ...info, action: 'blocked', reason: 'baseline title is corrupted and no clean candidate exists' });
    } else {
      decisions.push({ ...info, action: 'drop-candidate', reason: 'candidate-only row has no clean title' });
    }
  }

  merged.sort(
    (a, z) =>
      a.schemeYear.localeCompare(z.schemeYear) ||
      normalise(a.programme).localeCompare(normalise(z.programme)) ||
      a.semester - z.semester ||
      a.code.localeCompare(z.code),
  );
  return { merged, decisions, blockers };
}

/** Whether a record is within a publication scope. */
export function inScope(identity: PublicationIdentity, scope: PublicationScope): boolean {
  if (identity.schemeYear !== scope.schemeYear) return false;
  if (identity.programme !== null && scope.programmes.includes(identity.programme)) return true;
  if (identity.streamId !== null && scope.streams.includes(identity.streamId)) return true;
  return false;
}

/**
 * The exclusion that withholds a record, or null. Narrowing fields must all
 * match; an exclusion that names a programme/stream/semester does not touch a
 * record in another context (§6).
 */
export function exclusionFor(
  identity: PublicationIdentity,
  exclusions: readonly CatalogueExclusion[],
): CatalogueExclusion | null {
  const narrows = <T>(constraint: T | null | undefined, matches: (c: T) => boolean): boolean =>
    constraint === null || constraint === undefined || matches(constraint);
  for (const exclusion of exclusions) {
    if (exclusion.schemeYear !== identity.schemeYear) continue;
    if (exclusion.code !== identity.code) continue;
    if (!narrows(exclusion.programme, (p) => normalise(p) === normalise(identity.programme))) continue;
    if (!narrows(exclusion.streamId, (s) => normalise(s) === normalise(identity.streamId))) continue;
    if (!narrows(exclusion.semester, (s) => s === identity.semester)) continue;
    return exclusion;
  }
  return null;
}
