/**
 * What kind of academic document did the student just hand us?
 *
 * Authority: docs/08 §8.20 · M10A.7 §10, §11, §12, §13, §39
 *
 * ---------------------------------------------------------------------------
 * THE STUDENT SHOULD NOT HAVE TO PICK A PARSER
 * ---------------------------------------------------------------------------
 *
 * Asking "is this a result or a calendar?" pushes a question onto the person
 * that the document already answers. So a file is read once, by the extraction
 * the product already has, and the LINES decide where it goes.
 *
 * ---------------------------------------------------------------------------
 * EVIDENCE, NOT KEYWORDS
 * ---------------------------------------------------------------------------
 *
 * One matching word must never be enough. "Semester" appears on a result card,
 * a calendar, a timetable and an exam schedule alike; "VTU" appears on all of
 * them and on a question paper too. So each document type is recognised by a
 * COMBINATION of independent signals, and the winner has to beat both the
 * runner-up and a floor.
 *
 * That floor is what makes rejection a feature rather than an accident. A
 * holiday photo, an invoice and a lecture note all score zero and are told
 * plainly that they are not a supported academic document (§11).
 *
 * ---------------------------------------------------------------------------
 * AND NO MODEL
 * ---------------------------------------------------------------------------
 *
 * This is deterministic on purpose (§13). A classifier that ran a language
 * model would send the contents of a student's academic documents somewhere,
 * would need the network, and could not be reasoned about when it got a
 * document wrong. Signatures over extracted text can be read, tested, and
 * argued with.
 */

import type { ImportLine } from './result-import.js';

export type DocumentType = 'result' | 'academic_calendar' | 'college_timetable' | 'unsupported';

export interface Classification {
  readonly type: DocumentType;
  /**
   * Why, in words a student can act on.
   *
   * Shown when a document is refused, because "unsupported" on its own tells
   * someone nothing about what to do next (§11, §75).
   */
  readonly reason: string;
  /** The signals that fired, for the "how this was read" panel. Never a score. */
  readonly signals: readonly string[];
}

/**
 * One recognisable trait of a document, and what it is worth.
 *
 * Weights are small integers rather than tuned probabilities: this is a
 * checklist, and pretending otherwise would invite treating the total as a
 * confidence it is not.
 */
interface Signal {
  readonly name: string;
  readonly pattern: RegExp;
  readonly weight: number;
}

/**
 * A result card names a seat number and prints marks columns.
 *
 * The marks headings are what separate it from every other VTU document: no
 * calendar, timetable or notice has an "Internal Marks" column.
 */
const RESULT_SIGNALS: readonly Signal[] = [
  { name: 'seat number', pattern: /university\s+seat\s+number/i, weight: 3 },
  { name: 'provisional results heading', pattern: /provisional\s+results?/i, weight: 3 },
  { name: 'internal marks column', pattern: /internal\s+marks/i, weight: 3 },
  { name: 'external marks column', pattern: /external\s+marks/i, weight: 3 },
  { name: 'announced/updated column', pattern: /announced\s*\/?\s*updated/i, weight: 2 },
  { name: 'a pass/fail legend', pattern: /\bP\s*->\s*PASS\b/i, weight: 2 },
];

/**
 * An academic calendar names the shape of a TERM, not of an exam or a week.
 *
 * "Calendar of events" and "academic calendar" are the strong ones. The
 * milestone words — commencement, last working day, registration — are what
 * distinguish it from an exam timetable, which is also a university document
 * full of dates (§10).
 */
const CALENDAR_SIGNALS: readonly Signal[] = [
  { name: 'academic calendar heading', pattern: /academic\s+calendar/i, weight: 4 },
  { name: 'calendar of events', pattern: /calendar\s+of\s+events/i, weight: 4 },
  { name: 'commencement of the term', pattern: /commencement\s+of\s+(the\s+)?(class|semester|term)/i, weight: 3 },
  { name: 'last working day', pattern: /last\s+working\s+day/i, weight: 3 },
  { name: 'registration window', pattern: /(registration|enrol?ment)\s+(of|for|last|closes|deadline|date)/i, weight: 2 },
  { name: 'odd/even semester naming', pattern: /\b(odd|even)\s+semester\b/i, weight: 2 },
  { name: 'an academic year', pattern: /\b20\d{2}\s*[-–—/]\s*(20)?\d{2}\b/, weight: 1 },
];

/**
 * A weekly timetable names DAYS. Nothing else here does.
 *
 * The parser is not built yet (§35); recognising the document is what lets the
 * product say "not yet" instead of misfiling it as a calendar, which it would
 * otherwise resemble — a university document, dated, with a table.
 */
const TIMETABLE_SIGNALS: readonly Signal[] = [
  { name: 'weekday columns', pattern: /monday.*tuesday|tuesday.*wednesday/is, weight: 4 },
  { name: 'with effect from', pattern: /\bw\.?\s*e\.?\s*f\.?\b/i, weight: 2 },
  { name: 'a time-of-day grid', pattern: /\b\d{1,2}[:.]\d{2}\s*(am|pm)?\s*[-–—to]+\s*\d{1,2}[:.]\d{2}/i, weight: 3 },
  { name: 'time table heading', pattern: /time\s*table/i, weight: 2 },
  { name: 'a lunch or break row', pattern: /\b(lunch|break|recess)\b/i, weight: 1 },
];

/**
 * Documents that are academic, dated, and still not one of the three.
 *
 * An exam schedule is the case that matters. It is issued by the university,
 * it is a table of dates, it names semesters — and reading it as an academic
 * calendar would fill a student's term with exam rows labelled as milestones.
 * Recognising it lets the product say what it actually is.
 */
const EXAM_SCHEDULE_SIGNALS: readonly Signal[] = [
  { name: 'examination time table', pattern: /time\s*table\s+for\s+.*examination|examination.*time\s*table/is, weight: 4 },
  { name: 'draft schedule', pattern: /\bdraft\s+time\s*table\b/i, weight: 3 },
  { name: 'a date/day column', pattern: /\bdate\s*,\s*day\b/i, weight: 3 },
  { name: 'registrar (evaluation)', pattern: /registrar\s*\(\s*evaluation\s*\)/i, weight: 3 },
];

/** A question paper. Recognised only so it can be refused (§39). */
const QUESTION_PAPER_SIGNALS: readonly Signal[] = [
  { name: 'marks-per-question column', pattern: /\bmarks\b.*\bmodule\b|\bmodule\s*-?\s*[1-5]\b/is, weight: 3 },
  { name: 'answer instructions', pattern: /answer\s+any\s+(one|two|five|full)/i, weight: 4 },
  { name: 'USN grid', pattern: /\bUSN\b/, weight: 1 },
  { name: 'maximum marks', pattern: /max\.?\s*marks/i, weight: 3 },
];

function score(lines: readonly ImportLine[], signals: readonly Signal[]) {
  const text = lines.map((line) => line.text).join('\n');
  const hits = signals.filter((signal) => signal.pattern.test(text));
  return {
    total: hits.reduce((sum, signal) => sum + signal.weight, 0),
    names: hits.map((signal) => signal.name),
  };
}

/**
 * The floor a document must clear to be routed anywhere at all.
 *
 * Set so that no SINGLE signal can carry a document on its own: the largest
 * weight is 4, so a lone match cannot reach 6. A file has to look like the
 * thing in more than one independent way (§10).
 */
const MINIMUM = 6;

/**
 * How far ahead the winner must be before the answer counts as settled.
 *
 * Real documents overlap — an exam schedule and a calendar share dates and
 * semesters — and a one-point lead is not a decision. Below this margin the
 * document is refused rather than guessed at, which is the honest outcome when
 * the evidence genuinely does not separate.
 */
const MARGIN = 2;

/**
 * Which kind of document these lines came from.
 *
 * The lines are whatever the shared extraction produced — a PDF's own text or
 * OCR of a picture. Classification does not care which, and that is the point:
 * one router in front of one extraction, not a pipeline per document type
 * (§5, §42).
 */
export function classifyDocument(lines: readonly ImportLine[]): Classification {
  if (lines.length === 0) {
    return {
      type: 'unsupported',
      reason: 'Nothing could be read from this file.',
      signals: [],
    };
  }

  const candidates = [
    { type: 'result' as const, ...score(lines, RESULT_SIGNALS) },
    { type: 'academic_calendar' as const, ...score(lines, CALENDAR_SIGNALS) },
    { type: 'college_timetable' as const, ...score(lines, TIMETABLE_SIGNALS) },
  ];

  /*
   * The two kinds of academic document GradTools does not take. Scored
   * alongside the rest so a strong exam schedule can outrank a weak calendar
   * reading of itself, rather than being caught by a rule bolted on afterwards.
   */
  const exam = score(lines, EXAM_SCHEDULE_SIGNALS);
  const paper = score(lines, QUESTION_PAPER_SIGNALS);

  const ranked = [...candidates].sort((a, b) => b.total - a.total);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best === undefined || runnerUp === undefined) {
    return { type: 'unsupported', reason: NOT_ACADEMIC, signals: [] };
  }

  /*
   * A MORE SPECIFIC SIGNATURE OUTRANKS A MORE GENERAL ONE, whatever the totals.
   *
   * Found on the real document: a university exam schedule scored NINE on the
   * class-timetable signals and only seven on its own. It deserved both — its
   * "Date, Day" column lists Friday, Tuesday, Wednesday in sequence, and its
   * heading carries the sitting times — so the generic reading won and the
   * product told the student it was a class timetable.
   *
   * Both answers refuse the document, so nothing unsafe happened; the message
   * was simply untrue. The exam signals cannot fire on a weekly class
   * timetable — no class timetable says "Draft Time Table", "Date, Day" or
   * "Registrar (Evaluation)" — so once they clear the floor they settle it.
   */
  if (exam.total >= MINIMUM) {
    return {
      type: 'unsupported',
      reason:
        'This looks like an examination time table rather than an academic calendar. GradTools does not read exam schedules yet — the dates on it are not the semester milestones a calendar carries.',
      signals: exam.names,
    };
  }

  if (paper.total >= MINIMUM) {
    return {
      type: 'unsupported',
      reason: 'This looks like a question paper. GradTools does not read question papers.',
      signals: paper.names,
    };
  }

  if (best.total < MINIMUM) {
    return { type: 'unsupported', reason: NOT_ACADEMIC, signals: best.names };
  }

  if (best.total - runnerUp.total < MARGIN) {
    return {
      type: 'unsupported',
      reason:
        'This document could be more than one kind of academic record, so GradTools has not guessed. You can enter what you need by hand.',
      signals: [...best.names, ...runnerUp.names],
    };
  }

  /*
   * All three supported kinds say the same kind of thing: what the document
   * looked like. This branch used to add "GradTools cannot read timetables
   * yet", which was true when it was written and stopped being true in M10A.8
   * — the sentence simply outlived the limitation it described. It was not
   * shown anywhere, because a recognised timetable goes to its parser rather
   * than to the failure path, and a false sentence nobody displays is a false
   * sentence waiting for a caller.
   */
  return {
    type: best.type,
    reason:
      best.type === 'result'
        ? 'This looks like a result card.'
        : best.type === 'college_timetable'
          ? 'This looks like a class timetable.'
          : 'This looks like an academic calendar.',
    signals: best.names,
  };
}

/*
 * NAMES ALL THREE. This listed a result card and an academic calendar, and
 * went on listing two after timetables became the third (M10A.8) — so a
 * student whose timetable photo was too poor to read was told the product does
 * not do timetables, which is both wrong and discouraging in the one moment
 * they needed the opposite.
 */
const NOT_ACADEMIC =
  'GradTools could not identify this as a result card, an academic calendar or a class timetable. If it is one, a clearer scan may work — or you can enter the details by hand.';
