/**
 * The few shared primitives the timetable unit needs, owned here so that
 * `domain/timetable/` imports nothing from the rest of `domain/` (it is the
 * first Rust migration unit; see rust/DECISIONS.md, ADR-5). Each was moved
 * verbatim from its original module, which re-exports it, so every existing
 * import keeps working.
 */

/** Days of the week, 0 = Monday, matching the timetable grid's reading order. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * The identity key for a subject code.
 *
 * TWO TRANSFORMATIONS, AND NO OTHERS: outer whitespace is trimmed, inner
 * whitespace is removed, and the result is upper-cased. A VTU code contains no
 * spaces, so `"bcs 301"` and `"BCS301"` are the same code typed two ways — and
 * treating them as two subjects would split one student's own record in half.
 *
 * That is the whole of it. There is no edit distance, no prefix matching, no
 * stripping of trailing letters, and no comparison of titles anywhere in this
 * module. `BESCK104B` and `BESCK104C` are two different electives and must stay
 * that way; a rule that "helpfully" folded the suffix would merge them
 * (M10A.1 §47).
 */
export function subjectKey(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

/**
 * One positioned run of text.
 *
 * Deliberately not pdf.js's own type: this module is pure and testable without
 * loading a PDF engine, and the adapter that produces these is the only place
 * that knows about pdf.js.
 */
export interface PositionedText {
  readonly text: string;
  /** Left edge, in PDF user space. */
  readonly x: number;
  /** Baseline, in PDF user space. Larger is HIGHER on the page. */
  readonly y: number;
  readonly width: number;
  /** Rendered text height, used to scale both tolerances. */
  readonly height: number;
}
