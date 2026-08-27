/**
 * Paper-format detection.
 *
 * Authority: docs/17 §17.12 · docs/32 OQ-029 · M5A.3 §7
 *
 * Classifies a paper well enough to CHOOSE AN OCR CONFIGURATION. It is not a
 * parser and does not attempt question segmentation (M5A.3 §20).
 *
 * WHY THIS IS MORE THAN ONE REGEX
 *
 * The detector was wrong three times during qualification, and each failure was
 * a real property of the corpus rather than a coding slip:
 *
 *   1. MARKS TOTALS DO NOT IDENTIFY A FORMAT. `BCY358A` is a descriptive paper
 *      worth 50 marks ("Answer any FIVE full questions, choosing ONE full
 *      question from each module"). A "Marks: 50 => MCQ" rule misclassifies it.
 *
 *   2. THE DETECTOR MUST TOLERATE OCR NOISE IN ITS OWN KEYWORDS. On a Kannada
 *      paper "fifty questions" came back as "fifty ಕೈತ", so requiring a
 *      readable noun after "fifty" failed on a document read correctly in every
 *      other respect. This runs over OCR output; it cannot assume clean text.
 *
 *   3. DETECTION MUST BE LANGUAGE-AWARE. A Kannada-medium paper carries its
 *      instructions in Kannada, so an English-only detector returns UNKNOWN for
 *      a perfectly good document.
 *
 * Hence: several independent cues per format, in both languages, and the
 * stronger side wins rather than the first pattern to match.
 *
 * `unknown` IS A REAL ANSWER. A paper that matches no known template is not a
 * broken paper — the first rubric during qualification scored four
 * correctly-read papers as failures for exactly that mistake. An unknown format
 * takes a safe configuration and is flagged for review.
 */

export type PaperFormat = 'descriptive' | 'mcq' | 'unknown';

/** Kannada cues, as escapes so this file stays ASCII-safe in every editor. */
const KN_QUESTION = 'ಪ್ರಶ್ನೆ'; // prashne, "question"
const KN_MARK = 'ಅಂಕ'; // anka, "mark"
const KN_FIFTY = '೬೦'; // 50 in Kannada digits

export interface FormatEvidence {
  readonly format: PaperFormat;
  /** How many cues supported the winning side. Surfaced for diagnosis only. */
  readonly mcqCues: number;
  readonly descriptiveCues: number;
  /** True when the text carries Kannada script, so OCR needs `eng+kan`. */
  readonly hasKannada: boolean;
}

/** Whether the text contains Kannada script at all. */
export function hasKannadaScript(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0c80 && code <= 0x0cff) return true;
  }
  return false;
}

export function detectFormat(text: string): FormatEvidence {
  const mcqCues = [
    /\bfifty\b/i.test(text) && /one\s+mark/i.test(text),
    /darken/i.test(text),
    /\bO\.?M\.?R\.?\b/.test(text),
    /Question\s+Paper\s+Version/i.test(text),
    (text.includes(KN_QUESTION) && text.includes(KN_MARK)) ||
      (text.includes(KN_FIFTY) && text.includes(KN_QUESTION)),
  ].filter(Boolean).length;

  const descriptiveCues = [
    (text.match(/Module\s*[-=–—]?\s*[1-5IVX]/gi) ?? []).length >= 2,
    /FIVE\s+full\s+questions/i.test(text),
    /from\s+each\s+module/i.test(text),
    (text.match(/\bL[1-6]\b/g) ?? []).length >= 4,
  ].filter(Boolean).length;

  const hasKannada = hasKannadaScript(text);

  if (mcqCues > descriptiveCues) return { format: 'mcq', mcqCues, descriptiveCues, hasKannada };
  if (descriptiveCues > 0) {
    return { format: 'descriptive', mcqCues, descriptiveCues, hasKannada };
  }
  return { format: 'unknown', mcqCues, descriptiveCues, hasKannada };
}

/* -------------------------------------------------------------------------- */
/* OCR configuration                                                          */
/* -------------------------------------------------------------------------- */

export interface OcrConfig {
  /** Tesseract `-l`. `eng+kan` only where Kannada was actually seen. */
  readonly languages: string;
  /** Tesseract `--psm`. Format-dependent; measured, not guessed. */
  readonly psm: number;
  readonly dpi: number;
  /** True when the result should not be trusted without a human look. */
  readonly needsReview: boolean;
  readonly reviewReason: string | null;
}

/** 150 DPI baseline. Never silently raised (M5A.3 §8). */
export const BASELINE_DPI = 150;

/**
 * Chooses the OCR configuration for a paper.
 *
 * PSM values are the measured ones (docs/17 §17.11d):
 *   descriptive -> 3   recovered 13 complete marks rows against PSM 6's 5
 *   mcq         -> 6   recovered 59 numbered items against PSM 3's 34
 *   unknown     -> 3   the safer general-purpose default, AND flagged
 *
 * `eng+kan` is used only when Kannada script was actually detected. Applying it
 * everywhere would cost ~1.8x on every English paper (docs/23 §23.3.4) for no
 * benefit, and `kan` alone is never used because it destroys the Latin header.
 */
export function configFor(evidence: FormatEvidence): OcrConfig {
  const languages = evidence.hasKannada ? 'eng+kan' : 'eng';

  if (evidence.format === 'unknown') {
    return {
      languages,
      psm: 3,
      dpi: BASELINE_DPI,
      needsReview: true,
      reviewReason:
        'The paper format could not be identified, so a general-purpose reading was used. ' +
        'The text may not be laid out as expected.',
    };
  }

  return {
    languages,
    psm: evidence.format === 'mcq' ? 6 : 3,
    dpi: BASELINE_DPI,
    needsReview: false,
    reviewReason: null,
  };
}

/**
 * Whether extracted text carries enough mathematics to be untrustworthy.
 *
 * OCR does not recover mathematical notation at all: across the qualification
 * sample it produced zero Greek letters, operators, superscripts or subscripts,
 * and `x²p² + xyp − 6y²` came back as `x'p? + xyp-6y7 4S` (docs/17 §17.11d).
 *
 * Detected from the SUBJECT and the question stems rather than from symbols,
 * because the symbols are precisely what did not survive — looking for them
 * would find nothing on exactly the papers that need flagging.
 */
export function looksMathematical(text: string): boolean {
  const cues = [
    /\bMathematics\b/i.test(text),
    /\b(?:integrat|differentiat|derivative|matrix|matrices|eigen|theorem)\w*/i.test(text),
    /\b(?:prove that|evaluate|solve\s*:|radius of curvature|expansion of)\b/i.test(text),
  ].filter(Boolean).length;
  return cues >= 2;
}

export const MATH_REVIEW_REASON =
  'This paper contains mathematics. Text was extracted for search, but formulas ' +
  'and symbols are not reliable and should not be treated as the original.';
