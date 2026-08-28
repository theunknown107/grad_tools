/**
 * The question-paper library, as the browser reasons about it.
 *
 * Authority: docs/17 §17.13 · docs/28 §28.12 · M8 §11, §12, §17, §25, §26
 *
 * DETERMINISTIC AND LOCAL. Everything here is a pure function of a paper record
 * and the student's own context, which never leaves the device (M8 §25). There
 * is no ranking, no scoring, no similarity and no model: a paper is relevant to
 * a student's semester or it is not, and the answer is the same every time.
 *
 * WHAT THIS FILE REFUSES TO DO
 *
 * - It never invents metadata. A paper with no year has no year; nothing here
 *   reads one out of a title or a filename (M8 §7).
 * - It never calls a paper important, useful or likely. Those are claims about
 *   content that nothing in this milestone measured (M8 §11, §46).
 */

import type { PaperFormat, PresentationMode, QuestionPaper } from '@gradtools/shared-types';

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a student may actually do with a paper.
 *
 * DERIVED FROM `availability` ALONE, in one place, so no screen can decide for
 * itself that a blocked paper deserves an Open button (M8 §17, §22). The API
 * already refuses to serve what it should not; this makes the interface agree
 * rather than rely on the refusal.
 */
export interface PaperActions {
  /** GradTools holds the file and may serve it. */
  readonly canOpenHere: boolean;
  /** The original lives elsewhere and is worth linking to. */
  readonly canOpenOriginal: boolean;
  /** Shown instead of an action when there is nothing a student can do. */
  readonly unavailableReason: string | null;
}

export function actionsFor(paper: QuestionPaper): PaperActions {
  switch (paper.availability) {
    case 'host':
      return {
        canOpenHere: true,
        canOpenOriginal: paper.sourceUrl !== null,
        unavailableReason: null,
      };
    case 'link':
      /*
       * NO "OPEN HERE" FOR A LINK, EVER (M8 §15). GradTools does not have this
       * file and must not fetch it on a student's behalf — doing so would make
       * the app an open proxy for material whose rights nobody established.
       */
      return {
        canOpenHere: false,
        canOpenOriginal: paper.sourceUrl !== null,
        unavailableReason:
          paper.sourceUrl === null ? 'This paper has no link and no stored copy.' : null,
      };
    case 'private':
      // Should never reach a student's library at all — the API excludes it.
      // Handled anyway, because "unreachable" is how leaks are written.
      return {
        canOpenHere: false,
        canOpenOriginal: false,
        unavailableReason: 'This is a private document.',
      };
    case 'blocked':
      return {
        canOpenHere: false,
        canOpenOriginal: false,
        unavailableReason: 'This paper is not available.',
      };
  }
}

/**
 * How availability reads to a student.
 *
 * Written as what happens next, not as a licensing position (docs/28 §28.12).
 * A student's question is "can I read this and where", and that is also the
 * accurate answer.
 */
export const AVAILABILITY_LABEL: Record<PresentationMode, string> = {
  host: 'Available here',
  link: 'At the original source',
  private: 'Private to you',
  blocked: 'Not available',
};

export const FORMAT_LABEL: Record<PaperFormat, string> = {
  descriptive: 'Descriptive',
  mcq: 'Multiple choice',
  // Not "Other". The format was not determined, and saying so is the point.
  unknown: 'Format unknown',
};

/* -------------------------------------------------------------------------- */
/* Relevance                                                                  */
/* -------------------------------------------------------------------------- */

export interface PaperContext {
  readonly schemeId: string | null;
  readonly branchId: string | null;
  readonly currentSemester: number | null;
}

/**
 * Whether a paper is for the semester the student is in.
 *
 * A HINT, NEVER A FILTER (M8 §25, §26). It decides what the interface suggests
 * first; it never decides what exists. A student revising for a backlog needs
 * semester 3 papers while sitting in semester 5, and a library that quietly
 * hid them would be worse than no library.
 *
 * A paper with no stated semester is NOT relevant and is NOT irrelevant: it is
 * unknown, and unknown is not a claim in either direction.
 */
export function matchesSemester(paper: QuestionPaper, context: PaperContext): boolean {
  return (
    context.currentSemester !== null &&
    paper.semester !== null &&
    paper.semester === context.currentSemester
  );
}

/**
 * The library, with the student's own semester lifted to the top.
 *
 * A STABLE PARTITION, NOT A RE-SORT. The server already ordered the page the
 * way the student asked — newest sitting, oldest sitting, recently added — and
 * re-sorting here would silently overrule the control they just used. So this
 * moves the papers for their current semester ahead of the rest and otherwise
 * leaves the order exactly as it arrived.
 *
 * SORTING, NEVER FILTERING (M8 §25). Everything stays reachable: a student
 * revising for a backlog needs a semester-3 paper while sitting in semester 5.
 */
export function sortForStudent(
  papers: readonly QuestionPaper[],
  context: PaperContext,
): QuestionPaper[] {
  const mine: QuestionPaper[] = [];
  const rest: QuestionPaper[] = [];
  for (const paper of papers) {
    (matchesSemester(paper, context) ? mine : rest).push(paper);
  }
  return [...mine, ...rest];
}

/* -------------------------------------------------------------------------- */
/* Display                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The one-line description under a paper's code.
 *
 * ONLY WHAT IS KNOWN (M8 §12). Absent fields are dropped rather than filled
 * with "—" or "Unknown" for every one of them: a row of placeholders reads as
 * broken data, while a shorter line reads as a paper about which less was
 * recorded, which is what it is.
 */
export function paperFacts(paper: QuestionPaper): string[] {
  const facts: string[] = [];
  if (paper.examSession !== null) facts.push(paper.examSession);
  else if (paper.examYear !== null) facts.push(String(paper.examYear));
  if (paper.semester !== null) facts.push(`Semester ${String(paper.semester)}`);
  if (paper.branchName !== null) facts.push(paper.branchName);
  if (paper.schemeId !== null) facts.push(schemeLabel(paper.schemeId));
  if (paper.paperFormat !== null) facts.push(FORMAT_LABEL[paper.paperFormat]);
  return facts;
}

/** `vtu-2022` reads as `2022 scheme`, which is what a student calls it. */
export function schemeLabel(schemeId: string): string {
  const year = /(\d{4})/.exec(schemeId)?.[1];
  return year === undefined ? schemeId : `${year} scheme`;
}

/**
 * Whether a paper is synthetic.
 *
 * Demo fixtures come from the demo source, and every one of them must carry a
 * visible label (M8 §18). Driven by the source id rather than by the title, so
 * removing "DEMO" from a title cannot remove the label.
 */
export function isDemo(paper: QuestionPaper): boolean {
  return paper.sourceId === 'demo-question-papers';
}

/**
 * What the extraction is, in words that do not overclaim.
 *
 * STRUCTURAL, NOT SEMANTIC (M8 §20, §48). The parser found question boundaries;
 * nobody has confirmed it read them correctly unless a human reviewed them. The
 * count is a fact about the file, and `needsReview` is the part that says how
 * much to trust it. No accuracy percentage is shown, because none was measured.
 */
export function extractionSummary(paper: QuestionPaper): string | null {
  if (paper.questionCount === null) return null;

  const parts: string[] = [];
  if (paper.questionCount > 0) {
    parts.push(`${String(paper.questionCount)} questions found`);
  }
  if (paper.mcqItemCount !== null && paper.mcqItemCount > 0) {
    parts.push(`${String(paper.mcqItemCount)} multiple-choice items`);
  }
  if (parts.length === 0) return 'No question structure was found in this paper.';
  return parts.join(', ');
}

/**
 * Text that came out of a PDF, made safe to display.
 *
 * PDF TEXT IS UNTRUSTED INPUT (M8 §21). React escapes it, so markup cannot
 * execute; what React does not do is stop invisible control characters,
 * bidirectional overrides and zero-width joiners from rearranging how a line
 * reads on screen. A right-to-left override can make an extracted question
 * display as something other than what it says, which is a display attack
 * rather than a script one — and it is the one this function exists to stop.
 */
export function safeText(raw: string): string {
  return (
    raw
      // C0/C1 control characters, except tab and newline, which are legitimate.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
      // Bidirectional overrides and isolates, zero-width characters, and the BOM.
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u061c]/g, '')
      .trim()
  );
}
