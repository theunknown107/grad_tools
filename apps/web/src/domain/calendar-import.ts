/**
 * Reading an academic calendar, and refusing to invent the parts it cannot read.
 *
 * Authority: docs/08 §8.21 · M10A.7 §8, §16–§23
 *
 * ---------------------------------------------------------------------------
 * MOST DATES IN THE DOCUMENT ARE NOT EVENTS
 * ---------------------------------------------------------------------------
 *
 * An academic calendar carries notes, footers, a circular number, a date of
 * issue and a distribution list, and every one of those contains a date. A
 * parser that turned each into a calendar entry would fill a student's term
 * with rows like "05/12/2024" against the text of a notification reference
 * (§20).
 *
 * So a date on its own is never enough. A row becomes an event only when it
 * carries a date AND a description that survives the note filter.
 *
 * ---------------------------------------------------------------------------
 * A CATEGORY IS EVIDENCE, NOT A GUESS
 * ---------------------------------------------------------------------------
 *
 * `OTHER_ACADEMIC` is the honest answer whenever the wording does not clearly
 * say what a row is, and it is a better answer than a confident wrong one: the
 * dashboard treats "semester begins" differently from "some date", and a
 * mislabelled row would make the product state something the document never
 * said (§17).
 *
 * ---------------------------------------------------------------------------
 * A RANGE STAYS A RANGE
 * ---------------------------------------------------------------------------
 *
 * "01 Jul to 15 Jul" is one fact the document printed. Expanding it into
 * fifteen daily events would multiply one printed row into fifteen stored ones,
 * none of which the document contains (§19).
 */

/** A calendar event, as the document printed it. */
export interface CalendarEvent {
  readonly id: string;
  /** ISO `YYYY-MM-DD`. The first day where the source gave a range. */
  readonly startDate: string;
  /** ISO, and null when the source printed a single day rather than a span. */
  readonly endDate: string | null;
  readonly title: string;
  readonly category: CalendarCategory;
  /** The line this was read from, so a student can see what it came from. */
  readonly sourceLine: string;
  readonly page: number;
}

export type CalendarCategory =
  | 'SEMESTER_START'
  | 'REGISTRATION'
  | 'LAST_WORKING_DAY'
  | 'EXAM_PERIOD'
  | 'ACADEMIC_PERIOD'
  | 'HOLIDAY'
  | 'OTHER_ACADEMIC';

export interface ParsedCalendar {
  readonly events: readonly CalendarEvent[];
  /** From the document, never from today's date or the profile (§21). */
  readonly semester: number | null;
  /** `2026-27` as printed. Null when the document did not say. */
  readonly academicYear: string | null;
  /** Lines that carried a date but no readable event. Shown, not discarded. */
  readonly unreadableLines: readonly string[];
  readonly warnings: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** `07 Sep 2026`, `07-Sep-2026`, `7 September 2026`. */
const NAMED = /\b(\d{1,2})\s*[-/. ]\s*([A-Za-z]{3,9})\.?\s*[-/. ,]\s*(\d{4})\b/;
/** `07/09/2026` and `07-09-2026`. Day first, which is what these documents use. */
const NUMERIC = /\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\b/;
/** `07 Sep` with the year carried from the document's context. */
const NAMED_NO_YEAR = /\b(\d{1,2})\s*[-/. ]\s*([A-Za-z]{3,9})\.?(?!\s*[-/. ,]\s*\d)/;

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  /*
   * Round-tripped through Date so 31 February is refused rather than stored.
   * A calendar that accepted an impossible day would put it on the dashboard.
   */
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The first date in a piece of text, and what was left after it.
 *
 * `fallbackYear` is used only for a day-and-month with no year of its own —
 * the year comes from the document's own academic year, never from today
 * (§18).
 */
export function readDate(
  text: string,
  fallbackYear: number | null,
): { date: string; rest: string } | null {
  const named = NAMED.exec(text);
  if (named) {
    const month = MONTHS[(named[2] ?? '').slice(0, 3).toLowerCase()];
    const date =
      month === undefined ? null : iso(Number(named[3]), month, Number(named[1]));
    if (date !== null) return { date, rest: text.replace(named[0], ' ') };
  }

  const numeric = NUMERIC.exec(text);
  if (numeric) {
    const date = iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
    if (date !== null) return { date, rest: text.replace(numeric[0], ' ') };
  }

  if (fallbackYear !== null) {
    const partial = NAMED_NO_YEAR.exec(text);
    if (partial) {
      const month = MONTHS[(partial[2] ?? '').slice(0, 3).toLowerCase()];
      const date = month === undefined ? null : iso(fallbackYear, month, Number(partial[1]));
      if (date !== null) return { date, rest: text.replace(partial[0], ' ') };
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* What a row means                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Wording that says what a row IS, in the order a document means it.
 *
 * Order matters where phrases overlap: "commencement of examinations" is an
 * exam period, not a semester start, so the exam patterns are tested first.
 */
const CATEGORIES: readonly { category: CalendarCategory; pattern: RegExp }[] = [
  /*
   * PLURALS MATTER MORE THAN THEY LOOK. `\bexamination\b` does not match
   * "examinations", so a row reading "Commencement of semester end
   * examinations" fell past the exam pattern and landed on SEMESTER_START —
   * an exam period labelled as the start of term, which is exactly the false
   * category §17 forbids. Each noun is written the way a calendar prints it.
   */
  { category: 'EXAM_PERIOD', pattern: /\b(exams?|examinations?|practicals?|viva)\b/i },
  { category: 'REGISTRATION', pattern: /\b(registrations?|enrol?ments?|admissions?)\b/i },
  { category: 'LAST_WORKING_DAY', pattern: /\blast\s+working\s+day\b/i },
  {
    category: 'SEMESTER_START',
    pattern:
      /\b(commencement|begins?|start(s|ing)?)\b.*\b(classes|class|semesters?|terms?|sessions?)\b|\b(classes|class|semesters?|terms?)\b.*\bcommencement\b/i,
  },
  { category: 'HOLIDAY', pattern: /\b(holidays?|vacations?|breaks?|recess)\b/i },
  {
    category: 'ACADEMIC_PERIOD',
    pattern: /\b(teaching|instructions?|internal assessments?|tests?)\b/i,
  },
];

function categorise(title: string): CalendarCategory {
  for (const { category, pattern } of CATEGORIES) {
    if (pattern.test(title)) return category;
  }
  /* Unknown beats a false category. The dashboard can show a date it cannot name. */
  return 'OTHER_ACADEMIC';
}

/**
 * Lines that carry a date and are still not events.
 *
 * Every one of these appears on a real calendar and every one would otherwise
 * become a row in a student's term (§20).
 */
const NOT_AN_EVENT = [
  /^\s*note\s*[:-]/i,
  /\bref(erence)?\s*(no|number)\b/i,
  /\bnotification\s+no\b/i,
  /\bcircular\s+no\b/i,
  /\bdt\.?\s*\d/i,
  /\bcopy\s+to\b/i,
  /\b(registrar|principal|dean|director)\b\s*$/i,
  /\bfor\s+information\s+and\s+necessary\s+action\b/i,
  /\bsd\/?-/i,
  /^\s*page\s+\d+/i,
];

/** Wording with no content of its own — a row that is only a date. */
const EMPTY_TITLE = /^[\s\-–—:.|0-9]*$/;

/* -------------------------------------------------------------------------- */
/* The document                                                               */
/* -------------------------------------------------------------------------- */

const SEMESTER_WORDS: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
};

/** `2026-27`, `2026-2027`, `2026 – 27`. Kept exactly as a normalised pair. */
function readAcademicYear(text: string): string | null {
  const match = /\b(20\d{2})\s*[-–—/]\s*((?:20)?\d{2})\b/.exec(text);
  if (match === null) return null;
  const start = match[1] as string;
  const tail = match[2] as string;
  const end = tail.length === 2 ? `20${tail}` : tail;
  /* A "year" running backwards is a page number pair, not an academic year. */
  if (Number(end) !== Number(start) + 1) return null;
  return `${start}-${end.slice(2)}`;
}

function readSemester(text: string): number | null {
  const arabic = /\b(?:semester|sem)\s*[:\-–]?\s*([1-8])\b/i.exec(text);
  if (arabic?.[1] !== undefined) return Number(arabic[1]);

  const roman = /\b([IVX]{1,4})\s*(?:st|nd|rd|th)?\s*semester\b/i.exec(text);
  const value = SEMESTER_WORDS[(roman?.[1] ?? '').toLowerCase()];
  return value ?? null;
}

/**
 * A whole academic calendar.
 *
 * The semester and academic year come from the DOCUMENT. Where it does not say,
 * they are null and the review screen asks — a calendar dated by the month it
 * was uploaded in would be a fact GradTools invented (§21).
 */
export function parseAcademicCalendar(
  lines: readonly ImportLineLike[],
  makeId: () => string,
): ParsedCalendar {
  const joined = lines.map((line) => line.text).join('\n');
  const academicYear = readAcademicYear(joined);
  const semester = readSemester(joined);

  /*
   * The year a bare "07 Sep" belongs to. Taken from the document's own academic
   * year and from nowhere else; with no academic year printed, a dateless-year
   * row is left unread rather than dated by guesswork.
   */
  const fallbackYear = academicYear === null ? null : Number(academicYear.slice(0, 4));

  const events: CalendarEvent[] = [];
  const unreadable: string[] = [];

  for (const line of lines) {
    const text = line.text.trim();
    if (text === '') continue;
    if (NOT_AN_EVENT.some((pattern) => pattern.test(text))) continue;

    const first = readDate(text, fallbackYear);
    if (first === null) continue;

    /*
     * A SECOND date on the same row is the other end of a span, not a separate
     * event — "01 Jul to 15 Jul" is one printed fact (§19).
     */
    const second = readDate(first.rest, fallbackYear);
    const title = (second === null ? first.rest : second.rest)
      .replace(/\b(to|till|until|upto|up to|and)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (EMPTY_TITLE.test(title) || title.length < 3) {
      unreadable.push(text);
      continue;
    }

    const start = second === null || first.date <= second.date ? first.date : second.date;
    const end = second === null ? null : first.date <= second.date ? second.date : first.date;

    events.push({
      id: makeId(),
      startDate: start,
      endDate: end,
      title,
      category: categorise(title),
      sourceLine: text,
      page: line.page,
    });
  }

  const warnings: string[] = [];
  if (events.length > 0 && semester === null) {
    warnings.push('This calendar does not print which semester it is for. Choose it before saving.');
  }
  if (events.length > 0 && academicYear === null) {
    warnings.push('This calendar does not print an academic year.');
  }
  if (unreadable.length > 0) {
    warnings.push(
      unreadable.length === 1
        ? 'One line carried a date but no readable event, and has been left out.'
        : `${String(unreadable.length)} lines carried dates but no readable event, and have been left out.`,
    );
  }

  return { events, semester, academicYear, unreadableLines: unreadable, warnings };
}

/** The shape the shared extraction produces. Kept structural to avoid a cycle. */
export interface ImportLineLike {
  readonly text: string;
  readonly page: number;
}

/* -------------------------------------------------------------------------- */
/* Two calendars for the same term                                            */
/* -------------------------------------------------------------------------- */

/** A saved calendar, as the repository holds it. */
export interface SavedCalendar {
  readonly id: string;
  readonly semester: number | null;
  readonly academicYear: string | null;
  readonly events: readonly CalendarEvent[];
  /** Of the extracted text, so the same document is recognised under any name. */
  readonly fingerprint: string;
  readonly importedAt: string;
  readonly sourceKind: 'text' | 'ocr';
}

export type CalendarRelation =
  | { readonly kind: 'new' }
  | { readonly kind: 'duplicate'; readonly existing: SavedCalendar }
  | { readonly kind: 'revision'; readonly existing: SavedCalendar; readonly differences: readonly string[] };

/**
 * How a freshly-read calendar relates to what is already saved.
 *
 * A DUPLICATE is the same document again — same fingerprint — and needs no
 * decision beyond saying so. A REVISION covers the same term with different
 * dates, and is the case that must never be resolved silently: a reissued
 * calendar and a wrong upload look identical here, and only the student knows
 * which they meant (§27, §28, §29).
 */
export function relateCalendar(
  incoming: { fingerprint: string; semester: number | null; academicYear: string | null; events: readonly CalendarEvent[] },
  saved: readonly SavedCalendar[],
): CalendarRelation {
  const same = saved.find((candidate) => candidate.fingerprint === incoming.fingerprint);
  if (same !== undefined) return { kind: 'duplicate', existing: same };

  /*
   * The same TERM, not the same file. Matched on semester and academic year
   * together, because semester 5 of one year is a different calendar from
   * semester 5 of the next.
   */
  const term = saved.find(
    (candidate) =>
      candidate.semester === incoming.semester &&
      candidate.academicYear === incoming.academicYear &&
      (incoming.semester !== null || incoming.academicYear !== null),
  );
  if (term === undefined) return { kind: 'new' };

  const differences: string[] = [];
  for (const event of incoming.events) {
    const previous = term.events.find(
      (candidate) => candidate.category === event.category && candidate.category !== 'OTHER_ACADEMIC',
    );
    if (previous !== undefined && previous.startDate !== event.startDate) {
      differences.push(`${event.title}: ${previous.startDate} → ${event.startDate}`);
    }
  }

  return { kind: 'revision', existing: term, differences };
}

/**
 * A stable fingerprint of what was read.
 *
 * Of the TEXT, never the filename: the same calendar saved twice under two
 * names is one document, and a renamed file is not a new one (§27). Whitespace
 * and case are normalised out so a re-OCR of the same page still matches.
 *
 * Not a cryptographic hash and not used as one — it exists to notice that two
 * uploads are the same document, and nothing turns on an adversary being
 * unable to collide it.
 */
export function fingerprintOf(lines: readonly ImportLineLike[]): string {
  const text = lines
    .map((line) => line.text.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((line) => line !== '')
    .join('\n');

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Which calendar is in force                                                 */
/* -------------------------------------------------------------------------- */

/** A term, as the pair of facts that identifies one. */
function termOf(calendar: SavedCalendar): string {
  return `${String(calendar.semester ?? '?')}|${calendar.academicYear ?? '?'}`;
}

/**
 * The calendars actually in force, one per term.
 *
 * A REISSUED CALENDAR REPLACES ITS PREDECESSOR RATHER THAN JOINING IT. The
 * dashboard used to read every saved calendar at once, so a superseded one kept
 * producing events — a student who imported a corrected calendar would still be
 * shown the old registration date, sitting beside the new one with nothing to
 * say which was which (M10A.10 §13, §45).
 *
 * Within a term the most recently imported is the one in force. That IS upload
 * order, and it is the only evidence a calendar offers: unlike a timetable,
 * these documents do not print an effective date. Where that rule has to choose
 * between two disagreeing calendars, `calendarConflicts` reports the
 * disagreement rather than letting the choice pass unseen (§12).
 *
 * Calendars for DIFFERENT terms all stay in force. A student holding this
 * semester's and next semester's calendar has two useful documents, not a
 * conflict.
 */
export function activeCalendars(saved: readonly SavedCalendar[]): SavedCalendar[] {
  const byTerm = new Map<string, SavedCalendar>();
  for (const calendar of saved) {
    const key = termOf(calendar);
    const held = byTerm.get(key);
    if (held === undefined || calendar.importedAt > held.importedAt) byTerm.set(key, calendar);
  }
  return [...byTerm.values()];
}

/** One term that has more than one calendar, and the dates they disagree on. */
export interface CalendarConflict {
  readonly semester: number | null;
  readonly academicYear: string | null;
  /** `Commencement of classes: 2026-09-07 → 2026-09-14`. */
  readonly differences: readonly string[];
}

/**
 * Terms where two calendars say different things.
 *
 * SHOWN, NEVER RESOLVED. A reissued calendar and a wrong upload look identical
 * from here, and picking one silently is how a student ends up planning around
 * a date the university replaced (§12).
 *
 * Only categories the parser could actually name are compared. Two rows that
 * both came back as `OTHER_ACADEMIC` are not evidence of disagreement — they
 * are two rows nobody identified.
 */
export function calendarConflicts(saved: readonly SavedCalendar[]): CalendarConflict[] {
  const byTerm = new Map<string, SavedCalendar[]>();
  for (const calendar of saved) {
    const key = termOf(calendar);
    byTerm.set(key, [...(byTerm.get(key) ?? []), calendar]);
  }

  const conflicts: CalendarConflict[] = [];
  for (const group of byTerm.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.importedAt.localeCompare(b.importedAt));
    const older = ordered[0] as SavedCalendar;
    const newer = ordered[ordered.length - 1] as SavedCalendar;

    const differences: string[] = [];
    for (const event of newer.events) {
      if (event.category === 'OTHER_ACADEMIC') continue;
      const previous = older.events.find((candidate) => candidate.category === event.category);
      if (previous !== undefined && previous.startDate !== event.startDate) {
        differences.push(`${event.title}: ${previous.startDate} → ${event.startDate}`);
      }
    }
    if (differences.length > 0) {
      conflicts.push({
        semester: newer.semester,
        academicYear: newer.academicYear,
        differences,
      });
    }
  }
  return conflicts;
}

/**
 * Whether the calendar says today falls on a non-teaching day.
 *
 * ONLY WHERE THE DOCUMENT SAYS SO (§18). A holiday is a row the calendar
 * printed and the parser categorised as one; nothing here infers that a Sunday
 * is a holiday, or that a gap between events means the college is shut. A
 * calendar with no holiday rows produces no holidays.
 */
export function holidayOn(
  calendars: readonly SavedCalendar[],
  date: string,
): CalendarEvent | null {
  for (const calendar of calendars) {
    for (const event of calendar.events) {
      if (event.category !== 'HOLIDAY') continue;
      const from = event.startDate;
      const to = event.endDate ?? event.startDate;
      if (date >= from && date <= to) return event;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* What the product does with it                                              */
/* -------------------------------------------------------------------------- */

/**
 * The next event worth mentioning, or null.
 *
 * The dashboard shows ONE (§32, §54). Showing ten dates is a calendar, and the
 * student already has one of those; the useful thing is the next thing.
 *
 * `today` is passed in rather than read, so what the dashboard shows is a
 * function of its inputs and can be tested at any date.
 */
export function nextEvent(
  events: readonly CalendarEvent[],
  today: string,
): CalendarEvent | null {
  const upcoming = events
    .filter((event) => (event.endDate ?? event.startDate) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] ?? null;
}

/**
 * Whole days from `today` until an event starts. Negative once it has begun.
 *
 * COMPUTED, NEVER STORED (§22). A countdown saved on Monday is wrong by
 * Tuesday, and a stored one would need something to keep it honest.
 */
export function daysUntil(event: CalendarEvent, today: string): number {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${event.startDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}
