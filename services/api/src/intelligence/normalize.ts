/**
 * Deterministic normalisation of extracted question text.
 *
 * Authority: docs/18 §18.x (M10B) · M10B §9, §10, §21, §41
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
 * ---------------------------------------------------------------------------
 *
 * This produces a MATCHING KEY, not a corrected question. Nothing here is ever
 * shown to a student in place of the extracted text: the machine value and the
 * reviewed value remain exactly as the parser and the reviewer left them, and
 * this is a third, derived representation used only to decide whether two
 * records are the same question (M10B §9).
 *
 * That distinction is the whole design. The corpus is full of OCR damage —
 * dropped letters, "Alsad vantages", "weighting" for weighing, mathematics
 * reduced to "Evaluate in(* +bU+". A normaliser that tried to REPAIR any of
 * that would be inventing text, and the invented text would then be what the
 * duplicate detector compared. So this only removes noise it can remove without
 * choosing what a word was meant to be.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY LEAVES ALONE
 * ---------------------------------------------------------------------------
 *
 *   mathematical operators   + - * / = < > ^ √ ∫ ∑ and every symbol
 *   digits and units         "26kN", "0.2", "4000N"
 *   question numbering       "Q6(b)", "(a)"
 *   letters inside words     no spell correction, ever
 *
 * Repairing an equation is prohibited (M10B §21) and there is no LLM in this
 * path (M10B §3). If a question's mathematics was destroyed by OCR, it stays
 * destroyed and the record's confidence is what says so.
 */

/**
 * The version stamp for this transformation.
 *
 * Normalisation is a parser-class transformation and gets versioned like one
 * (M10B §10). A stored match produced under v1 must never be silently
 * reinterpreted under different rules: changing the behaviour below means
 * adding `-v2`, not editing `-v1`.
 */
export const QUESTION_NORMALIZATION_VERSION = 'question-normalization-v1';

/*
 * Characters that carry no meaning in a question and can carry an attack.
 *
 * C0/C1 controls, the bidirectional overrides (U+202A-U+202E, U+2066-U+2069)
 * that can make text render in an order it is not written in, zero-width
 * joiners and the BOM. Extracted document text is untrusted input (M10B §41),
 * and while React escapes markup it does not strip these — a right-to-left
 * override inside a question would reorder the line for every reader.
 */
const INVISIBLE = new RegExp(
  '[' +
    '\u0000-\u0008\u000B-\u001F\u007F-\u009F' + // C0 and C1 controls
    '\u200B-\u200F' + // zero-width space/joiners, LRM/RLM
    '\u202A-\u202E' + // bidirectional embedding and override
    '\u2060-\u2064\u2066-\u2069' + // word joiner, isolates
    '\uFEFF' + // byte order mark
    ']',
  'g',
);

/** Typographic variants that mean the same thing as their ASCII form. */
const PUNCTUATION_FOLDS: readonly (readonly [RegExp, string])[] = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  /* En, em, figure and non-breaking hyphens all read as a hyphen. */
  [/[‐-―−]/g, '-'],
  [/…/g, '...'],
  /*
   * Every kind of space becomes a space — non-breaking, en quad through
   * hair, narrow no-break, medium mathematical, ideographic. Written as
   * escapes rather than as the characters themselves: a literal
   * non-breaking space in source is invisible to the next reader.
   */
  [/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' '],
];

/**
 * The matching key for a question.
 *
 * Deterministic, idempotent, and lossy only in ways that cannot change which
 * question is being asked. Returns an empty string for text that is nothing but
 * noise, which callers should treat as "not matchable" rather than as a match
 * against every other empty result.
 */
export function normalizeQuestionText(input: string): string {
  let text = input.normalize('NFC').replace(INVISIBLE, '');

  for (const [pattern, replacement] of PUNCTUATION_FOLDS) {
    text = text.replace(pattern, replacement);
  }

  text = text
    /* Newlines and tabs are layout, not content: a question wrapped over three
       lines in one paper and two in another is the same question. */
    .replace(/\s+/g, ' ')
    /*
     * OCR routinely emits a space before punctuation ("theorem , and") and
     * after an opening bracket ("( a )"). Closing up is safe because no
     * notation in this corpus depends on a space in those positions.
     */
    .replace(/\s+([,.;:!?%)\]}])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    /*
     * A run of the same punctuation is a scanning artefact — a rule of dashes,
     * an underscored blank. Three or more collapse to one.
     *
     * THE FULL STOP IS DELIBERATELY EXCLUDED. An earlier version included it,
     * and because the ellipsis fold above turns "…" into "...", that run then
     * collapsed to a single "." — quietly destroying an ellipsis this function
     * claims to preserve. Caught by test.
     */
    .replace(/([-_=*~])\1{2,}/g, '$1')
    .trim()
    /*
     * Lowercased LAST, so the folds above operate on the original casing. This
     * is a matching key and case is not part of a question's identity: "Explain
     * normalization" and "explain normalization" are one question.
     */
    .toLowerCase();

  return text;
}

/**
 * Words, for set-based comparison.
 *
 * Splits on anything that is not a letter, a digit or an internal apostrophe,
 * so "26kn" stays one token and "q6(b)" becomes "q6" and "b". Non-Latin scripts
 * survive, and `\p{M}` is why: Kannada writes its vowels as COMBINING MARKS
 * rather than letters, so a class of `\p{L}\p{N}` alone treats them as
 * separators and shatters ವಿವರಿಸಿ into fragments — after which the
 * single-character filter throws most of them away. Caught by test; the same
 * would have happened to every Indic script in the corpus (M10B §22).
 *
 * Single characters are dropped. They are overwhelmingly OCR debris in this
 * corpus — stray "©", "|", "ia" fragments — and they inflate the overlap
 * between any two questions that both contain noise.
 */
export function tokenize(normalized: string): string[] {
  return normalized
    .split(/[^\p{L}\p{N}\p{M}']+/u)
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter((token) => token.length > 1);
}

/**
 * How much two token sets overlap, 0 to 1.
 *
 * Jaccard: shared tokens over total distinct tokens. Chosen over cosine for the
 * first pass because it is symmetric, needs no corpus-wide statistics, and is
 * readable — a student can be told "these share 8 of their 11 words" and check
 * it. Length-sensitive by design: a short question inside a long one scores low,
 * which is correct, because a five-word question is not the same as a
 * forty-word one that happens to contain it.
 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}
