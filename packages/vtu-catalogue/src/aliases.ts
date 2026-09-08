/**
 * Course codes the university itself writes two ways.
 *
 * Authority: Phase 7D.2 §11–§15 · Phase 7C.1 §6, §7, §26
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MOVED OUT OF THE WEB APP
 * ---------------------------------------------------------------------------
 *
 * It used to live in `apps/web/src/domain/course-aliases.ts`, where it was the
 * only authoritative statement of an academic fact held in the frontend. That
 * made it invisible to the crawler, to the database, and to any consumer that
 * is not the browser — and an equivalence between two course codes decides
 * which credits reach a real SGPA, which is not a presentation concern.
 *
 * It lives here so the same table is what the app reads, what `vtu:sync`
 * writes into `catalogue_aliases`, and what `vtu:validate` checks.
 *
 * ---------------------------------------------------------------------------
 * EXPLICIT, EVIDENCED, AND SMALL (§14)
 * ---------------------------------------------------------------------------
 *
 * Nothing here is inferred. No edit distance, no closest title, no "these look
 * like the same course". A wrong course identity puts a wrong credit into a
 * real SGPA and does it silently, so every entry names the document that
 * establishes it. An entry with no citation has no business being here.
 *
 * ---------------------------------------------------------------------------
 * WHICH WAY ROUND, AND WHAT IS NEVER REWRITTEN (§12)
 * ---------------------------------------------------------------------------
 *
 * `variant` is the spelling that appears somewhere the product reads —
 * typically a scheme's elective option list. `canonical` is the code the
 * course's own syllabus page carries, which is also what the university prints
 * on a result card.
 *
 * THE STUDENT'S RECORD IS NEVER REWRITTEN. A card that says BCS358D keeps
 * saying BCS358D, and stays visible and auditable as what the source said. The
 * alias only lets a catalogue row filed under the other spelling answer for it.
 */

export interface CourseAlias {
  /** The scheme year this equivalence holds in. Never global. */
  readonly schemeYear: string;
  /** The spelling found in a scheme or other secondary listing. */
  readonly variant: string;
  /** The spelling the course's own syllabus page uses. */
  readonly canonical: string;
  /** The course both codes name, for a reader checking the citation. */
  readonly title: string;
  /** The document that establishes the equivalence. Never a guess. */
  readonly evidence: string;
}

/**
 * The verified equivalences.
 *
 * ONE ENTRY, and it took a real document to earn it. The CSBS 2022 scheme's
 * third-semester elective option list prints `BCSL358D`; the 2022 CSBS 3rd-4th
 * semester syllabus gives the same course — "Data Visualization with Python",
 * Semester III, 1 credit — the code `BCS358D`, and does not contain `BCSL358D`
 * anywhere. A real result card for this course says `BCS358D`.
 *
 * SOURCE PRECEDENCE decided it, not preference: a scheme's option list is a
 * secondary mention of a course, and the syllabus page is that course's own
 * definition. Where they differ on identity, the definition wins. The full
 * order is in docs/38_VTU_INGESTION.md.
 */
export const COURSE_ALIASES: readonly CourseAlias[] = [
  {
    schemeYear: '2022',
    variant: 'BCSL358D',
    canonical: 'BCS358D',
    title: 'Data Visualization with Python',
    evidence:
      'VTU 2022 CSBS 3rd-4th semester syllabus, which gives this course the code BCS358D and does not use BCSL358D.',
  },
];

/** Codes compare without spacing or case; nothing else about them is relaxed. */
const key = (code: string): string => code.replace(/[\s-]+/g, '').toUpperCase();

/**
 * Every spelling that should resolve to the same catalogue row as `code`.
 *
 * Returns the code itself plus any verified partner, so a caller can index a
 * catalogue row under both without deciding which is "right".
 */
export function aliasesOf(code: string, schemeYear?: string): readonly string[] {
  const wanted = key(code);
  const partners = COURSE_ALIASES.flatMap((alias) => {
    if (schemeYear !== undefined && alias.schemeYear !== schemeYear) return [];
    if (key(alias.variant) === wanted) return [alias.canonical];
    if (key(alias.canonical) === wanted) return [alias.variant];
    return [];
  });
  return [code, ...partners];
}

/**
 * The canonical spelling of a code, where an alias establishes one.
 *
 * A code that is already canonical, or that no alias mentions, comes back
 * unchanged — this never invents an identity for an unknown code (§14).
 */
export function canonicalCodeOf(code: string, schemeYear?: string): string {
  const wanted = key(code);
  for (const alias of COURSE_ALIASES) {
    if (schemeYear !== undefined && alias.schemeYear !== schemeYear) continue;
    if (key(alias.variant) === wanted) return alias.canonical;
  }
  return code;
}

/** The evidence for treating two codes as one course, for a screen to cite. */
export function aliasEvidence(code: string, schemeYear?: string): CourseAlias | null {
  const wanted = key(code);
  return (
    COURSE_ALIASES.find(
      (alias) =>
        (schemeYear === undefined || alias.schemeYear === schemeYear) &&
        (key(alias.variant) === wanted || key(alias.canonical) === wanted),
    ) ?? null
  );
}
