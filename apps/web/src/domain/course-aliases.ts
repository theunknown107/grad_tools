/**
 * Course codes the university itself writes two ways.
 *
 * Authority: Phase 7C.1 §6, §7, §26
 *
 * ---------------------------------------------------------------------------
 * EXPLICIT, EVIDENCED, AND SMALL
 * ---------------------------------------------------------------------------
 *
 * Nothing here is inferred. There is no edit distance, no closest title, no
 * "these look like the same course" — §7 rules all of that out, and rightly:
 * a wrong course identity puts a wrong credit into a real SGPA, and it does so
 * silently.
 *
 * Every entry names the document that establishes it, so a reader can check it
 * against the source rather than trust the table. An entry with no citation has
 * no business being here.
 *
 * ---------------------------------------------------------------------------
 * WHICH WAY ROUND
 * ---------------------------------------------------------------------------
 *
 * `variant` is the spelling that appears somewhere the product reads —
 * typically a scheme's elective option list. `canonical` is the code the
 * course's own syllabus page carries, which is also what the university prints
 * on a result card.
 *
 * The student's record is never rewritten. A card that says BCS358D keeps
 * saying BCS358D; the alias only lets a catalogue row filed under the other
 * spelling answer for it.
 */

import { subjectKey } from './subjects.js';

export interface CourseAlias {
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
 * The scheme's option list is a secondary mention; the syllabus page is the
 * course's own definition. Where they differ, the syllabus wins.
 */
export const COURSE_ALIASES: readonly CourseAlias[] = [
  {
    variant: 'BCSL358D',
    canonical: 'BCS358D',
    title: 'Data Visualization with Python',
    evidence:
      'VTU 2022 CSBS 3rd-4th semester syllabus, which gives this course the code BCS358D and does not use BCSL358D.',
  },
];

/**
 * Every spelling that should resolve to the same catalogue row as `code`.
 *
 * Returns the code itself plus any verified partner, so a caller can index a
 * catalogue row under both without deciding which is "right".
 */
export function aliasesOf(code: string): readonly string[] {
  const key = subjectKey(code);
  const partners = COURSE_ALIASES.flatMap((alias) => {
    if (subjectKey(alias.variant) === key) return [alias.canonical];
    if (subjectKey(alias.canonical) === key) return [alias.variant];
    return [];
  });
  return [code, ...partners];
}

/** The evidence for treating two codes as one course, for a screen to cite. */
export function aliasEvidence(code: string): CourseAlias | null {
  const key = subjectKey(code);
  return (
    COURSE_ALIASES.find(
      (alias) => subjectKey(alias.variant) === key || subjectKey(alias.canonical) === key,
    ) ?? null
  );
}
