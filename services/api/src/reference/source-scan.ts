/**
 * Reading what an academic source document declares about itself.
 *
 * Authority: docs/22 §22.45 · docs/32 OQ-053 · M10A.3 §3, §8, §13, §14
 *
 * Pure functions over text. Nothing here opens a file, touches a database or
 * decides that anything is true — it reports what a page says, so that a human
 * comparing pages can see where they disagree.
 *
 * ---------------------------------------------------------------------------
 * THE ONE-CHARACTER TRAP
 * ---------------------------------------------------------------------------
 *
 * VTU has two course-code families in circulation:
 *
 *     BMATS101     the 2022 scheme, which GradTools models
 *     1BMATC101    a later scheme, effective 2025-26
 *
 * `1BMATC101` CONTAINS `BMATC101`. A pattern for the 2022 family, run over a
 * later-scheme document, matches the tail and silently reattributes the course
 * — and the result looks entirely plausible, because both are real VTU codes.
 *
 * This is not hypothetical. The local question-paper corpus holds three
 * documents recorded under 2022-scheme codes whose pages carry `1B...` codes
 * and 2025 effect dates.
 */

/**
 * Every VTU course code in a piece of text.
 *
 * One pattern with an optional leading digit rather than two patterns tried in
 * order, so the longer form always wins on its own merits instead of depending
 * on which regex was run first.
 */
const ANY_CODE = /\b(1?B[A-Z]{2,6}\d{3}[A-Z]?)\b/g;

const MODEL_PAPER = /model\s+question\s+paper/i;
const EFFECT_FROM = /with\s+effect\s+from\s+(\d{4}(?:-\d{2})?)/i;
const SEMESTER_PHRASE =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth)(?:\s*\/\s*\w+)?\s+semester\b/i;
const DEGREE_EXAM = /degree\s+examination/i;
const MAX_MARKS = /max\.?\s*marks\s*:?\s*(\d{2,3})/i;

export interface SourceDeclaration {
  /**
   * Every code the text declares, deduplicated, in the order found.
   *
   * A SET, because a paper legitimately serves several codes: `1BESC104C/204C`
   * is one examination in two semesters, and `BENGK106-206` likewise.
   * Collapsing that to a single value discards a real fact about which courses
   * the document speaks for.
   */
  readonly codes: readonly string[];
  readonly isModelPaper: boolean;
  /** The scheme year a document says it takes effect from, if it says. */
  readonly effectFrom: string | null;
  readonly semester: string | null;
  readonly isDegreeExam: boolean;
  readonly maxMarks: number | null;
}

export function codesIn(text: string): string[] {
  return [...new Set([...text.matchAll(ANY_CODE)].map((match) => match[1] as string))];
}

/** True for the later family. The leading digit is the whole of the test. */
export function isLaterFamily(code: string): boolean {
  return code.startsWith('1B');
}

export function declaredBy(text: string): SourceDeclaration {
  const marks = MAX_MARKS.exec(text)?.[1];
  return {
    codes: codesIn(text),
    isModelPaper: MODEL_PAPER.test(text),
    effectFrom: EFFECT_FROM.exec(text)?.[1] ?? null,
    semester: SEMESTER_PHRASE.exec(text)?.[1]?.toLowerCase() ?? null,
    isDegreeExam: DEGREE_EXAM.test(text),
    maxMarks: marks === undefined ? null : Number(marks),
  };
}

/**
 * Whether a document can speak for the 2022 catalogue.
 *
 * EVERY declared code must be 2022-family. A paper printing both `1BPLC105E`
 * and a bare `205E` is a later-scheme document that happens to spell one of its
 * codes without the prefix; admitting it because one spelling matched is the
 * mistake, arrived at by being generous.
 */
export function speaksForScheme2022(declaration: SourceDeclaration): boolean {
  return declaration.codes.length > 0 && !declaration.codes.some(isLaterFamily);
}

/**
 * Whether a filename's claimed code is actually on the page.
 *
 * Filenames are named by whoever downloaded the file, and this is how the local
 * corpus came to record model papers as sittings: the name was trusted and the
 * page was not. A disagreement is REPORTED, never resolved here — neither side
 * is authoritative enough to overrule the other without a human looking
 * (M10A.3 §14).
 */
export function filenameAgrees(
  fileName: string,
  declaration: SourceDeclaration,
): { readonly claimed: string | null; readonly agrees: boolean } {
  const claimed = codesIn(fileName)[0] ?? null;
  return {
    claimed,
    agrees: claimed === null || declaration.codes.includes(claimed),
  };
}
