/**
 * Reading an academic calendar, and refusing to invent the rest.
 *
 * Authority: docs/22 §22.58 · M10A.7 §16–§23, §27–§29, §40
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS GUARDS
 * ---------------------------------------------------------------------------
 *
 * A real academic calendar is mostly not events. It carries a notification
 * number with a date, a circular reference with a date, a signature block, a
 * distribution list and a footer — and every one of those contains a date. A
 * parser that turned each date into a calendar entry would hand a student a
 * term full of rows like "05/12/2024 — Ref No. VTU/BGM/598".
 *
 * So the rule under test is: a date is necessary and never sufficient.
 *
 * Every value here is synthetic. No real institution, date or circular.
 */

import { describe, expect, it } from 'vitest';
import {
  activeCalendars,
  calendarConflicts,
  daysUntil,
  holidayOn,
  fingerprintOf,
  nextEvent,
  parseAcademicCalendar,
  readDate,
  relateCalendar,
  type CalendarEvent,
  type SavedCalendar,
} from '../src/domain/calendar-import.js';

let counter = 0;
const makeId = () => `e${String((counter += 1))}`;

const lines = (...text: readonly string[]) => text.map((value) => ({ text: value, page: 1 }));

const parse = (...text: readonly string[]) => parseAcademicCalendar(lines(...text), makeId);

const HEADER = 'ACADEMIC CALENDAR FOR THE ODD SEMESTER 2026-27';

describe('dates as documents actually print them', () => {
  it('reads a named month', () => {
    expect(readDate('Commencement of classes 07 Sep 2026', null)?.date).toBe('2026-09-07');
    expect(readDate('7 September 2026', null)?.date).toBe('2026-09-07');
    expect(readDate('07-Sep-2026', null)?.date).toBe('2026-09-07');
  });

  it('reads a numeric date as day first, which is what these documents use', () => {
    expect(readDate('Last working day 04/12/2026', null)?.date).toBe('2026-12-04');
    expect(readDate('04-12-2026', null)?.date).toBe('2026-12-04');
  });

  it('refuses a day that does not exist rather than storing it', () => {
    /*
     * A calendar that accepted 31 February would put it on the dashboard, and
     * every later comparison against it would be nonsense.
     */
    expect(readDate('31 Feb 2026', null)).toBeNull();
    expect(readDate('45/13/2026', null)).toBeNull();
  });

  it('takes the year for a bare day and month from the DOCUMENT, or not at all', () => {
    /*
     * Never from today. A calendar read in one year and dated by another is a
     * fact GradTools would have invented (M10A.7 §18).
     */
    expect(readDate('Registration closes 11 Sep', 2026)?.date).toBe('2026-09-11');
    expect(readDate('Registration closes 11 Sep', null)).toBeNull();
  });
});

describe('a row becomes an event only when it says something', () => {
  it('reads the milestones a calendar prints', () => {
    const card = parse(
      HEADER,
      'Commencement of classes for V semester            07 Sep 2026',
      'Last date for registration without late fee       11 Sep 2026',
      'Last working day of the semester                  04 Dec 2026',
    );

    expect(card.events.map((event) => [event.category, event.startDate])).toEqual([
      ['SEMESTER_START', '2026-09-07'],
      ['REGISTRATION', '2026-09-11'],
      ['LAST_WORKING_DAY', '2026-12-04'],
    ]);
  });

  it('leaves a bare date out, and says it did', () => {
    const card = parse(HEADER, 'Commencement of classes 07 Sep 2026', '   04 Dec 2026   ');
    expect(card.events).toHaveLength(1);
    expect(card.unreadableLines).toEqual(['04 Dec 2026']);
    expect(card.warnings.join(' ')).toMatch(/no readable event/i);
  });

  it('does not turn the paperwork around the calendar into events', () => {
    /*
     * EVERY LINE HERE CARRIES A DATE, and not one of them is a semester
     * milestone. This is the bulk of a real calendar page.
     */
    const card = parse(
      HEADER,
      'Commencement of classes for V semester   07 Sep 2026',
      'Note : As per Notification No. EX/BGM/598/2026-27/4718 dt. 05/12/2026',
      'Ref No. EX/ACA/2026-27 dated 01/08/2026',
      'Circular No. 41 dt. 12/08/2026',
      'Copy to: The Principal, all affiliated colleges — 01/09/2026',
      'For information and necessary action 02/09/2026',
    );

    expect(card.events).toHaveLength(1);
    expect(card.events[0]?.category).toBe('SEMESTER_START');
  });
});

describe('a range is one fact, not fifteen', () => {
  it('keeps a span as a span', () => {
    /*
     * Expanding "01 Jul to 15 Jul" into fifteen daily events would multiply one
     * printed row into fifteen stored ones, none of which the document
     * contains (§19).
     */
    const card = parse(HEADER, 'Semester end examinations   05 Dec 2026 to 24 Dec 2026');
    expect(card.events).toHaveLength(1);
    expect(card.events[0]).toMatchObject({
      startDate: '2026-12-05',
      endDate: '2026-12-24',
      category: 'EXAM_PERIOD',
    });
  });

  it('orders a range that was printed backwards', () => {
    const card = parse(HEADER, 'Teaching period 24 Dec 2026 to 05 Dec 2026');
    expect(card.events[0]?.startDate).toBe('2026-12-05');
    expect(card.events[0]?.endDate).toBe('2026-12-24');
  });

  it('leaves a single date without an end', () => {
    const card = parse(HEADER, 'Last working day 04 Dec 2026');
    expect(card.events[0]?.endDate).toBeNull();
  });
});

describe('what a row means is read, never assumed', () => {
  it('calls an exam an exam even when the wording says commencement', () => {
    // "Commencement of examinations" is an exam period, not a semester start.
    const card = parse(HEADER, 'Commencement of semester end examinations 05 Dec 2026');
    expect(card.events[0]?.category).toBe('EXAM_PERIOD');
  });

  it('answers OTHER_ACADEMIC rather than inventing a category', () => {
    /*
     * Unknown is a better answer than a confident wrong one: the dashboard
     * treats a semester start differently from an unnamed date, and a
     * mislabelled row would make the product state something the document
     * never said (§17).
     */
    const card = parse(HEADER, 'Submission of consolidated statements 20 Oct 2026');
    expect(card.events[0]?.category).toBe('OTHER_ACADEMIC');
    expect(card.events[0]?.title).toMatch(/consolidated statements/i);
  });

  it('keeps the line it read from, for a student to check', () => {
    const card = parse(HEADER, 'Last working day of the semester  04 Dec 2026');
    expect(card.events[0]?.sourceLine).toBe('Last working day of the semester  04 Dec 2026');
  });
});

describe('semester and academic year come from the document', () => {
  it('reads both when printed', () => {
    const card = parse('ACADEMIC CALENDAR — V SEMESTER 2026-27', 'Classes begin 07 Sep 2026');
    expect(card.semester).toBe(5);
    expect(card.academicYear).toBe('2026-27');
  });

  it('reads a roman-numeral semester', () => {
    expect(parse('Calendar of events for the III semester 2026-27').semester).toBe(3);
  });

  it('asks rather than assuming when the semester is not printed', () => {
    const card = parse('ACADEMIC CALENDAR 2026-27', 'Classes begin 07 Sep 2026');
    expect(card.semester).toBeNull();
    expect(card.warnings.join(' ')).toMatch(/does not print which semester/i);
  });

  it('does not read a backwards pair as an academic year', () => {
    // `2026-24` is a page range or a reference number, not a year.
    expect(parse('Report 2026-24', 'Classes begin 07 Sep 2026').academicYear).toBeNull();
  });
});

describe('the same calendar, and the one that replaces it', () => {
  const saved = (over: Partial<SavedCalendar> = {}): SavedCalendar => ({
    id: 'c1',
    semester: 5,
    academicYear: '2026-27',
    fingerprint: 'aaaa',
    importedAt: '2026-09-01T00:00:00.000Z',
    sourceKind: 'text',
    events: [
      {
        id: 'x',
        startDate: '2026-09-07',
        endDate: null,
        title: 'Commencement of classes',
        category: 'SEMESTER_START',
        sourceLine: 'Commencement of classes 07 Sep 2026',
        page: 1,
      },
    ],
    ...over,
  });

  const incoming = (fingerprint: string, startDate: string) => ({
    fingerprint,
    semester: 5,
    academicYear: '2026-27',
    events: [
      {
        id: 'y',
        startDate,
        endDate: null,
        title: 'Commencement of classes',
        category: 'SEMESTER_START' as const,
        sourceLine: `Commencement of classes ${startDate}`,
        page: 1,
      },
    ],
  });

  it('recognises the same document again, however it was named', () => {
    /*
     * The fingerprint is of the TEXT. A calendar saved twice under two
     * filenames is one document, and a renamed file is not a new one (§27).
     */
    expect(relateCalendar(incoming('aaaa', '2026-09-07'), [saved()]).kind).toBe('duplicate');
  });

  it('calls a different document for the same term a revision, and names what moved', () => {
    const relation = relateCalendar(incoming('bbbb', '2026-09-14'), [saved()]);
    expect(relation.kind).toBe('revision');
    if (relation.kind === 'revision') {
      expect(relation.differences.join(' ')).toContain('2026-09-07 → 2026-09-14');
    }
  });

  it('treats a different term as a new calendar, not a revision', () => {
    const other = { ...incoming('cccc', '2027-02-01'), semester: 6 };
    expect(relateCalendar(other, [saved()]).kind).toBe('new');
  });

  it('does not match two calendars merely because neither names its term', () => {
    /*
     * Two calendars with no semester and no year are not evidence of being the
     * same term — they are evidence of two documents that did not say.
     */
    const anonymous = { fingerprint: 'dddd', semester: null, academicYear: null, events: [] };
    const savedAnonymous = saved({ semester: null, academicYear: null, fingerprint: 'eeee' });
    expect(relateCalendar(anonymous, [savedAnonymous]).kind).toBe('new');
  });

  it('gives the same fingerprint to the same text laid out differently', () => {
    const a = fingerprintOf(lines('Classes begin   07 Sep 2026', 'Last working day 04 Dec 2026'));
    const b = fingerprintOf(lines('classes begin 07 Sep 2026', '  Last Working Day  04 Dec 2026 '));
    expect(a).toBe(b);
  });

  it('gives different fingerprints to different text', () => {
    const a = fingerprintOf(lines('Classes begin 07 Sep 2026'));
    const b = fingerprintOf(lines('Classes begin 14 Sep 2026'));
    expect(a).not.toBe(b);
  });
});

describe('which calendar is actually in force', () => {
  const held = (over: Partial<SavedCalendar>): SavedCalendar => ({
    id: 'c',
    semester: 5,
    academicYear: '2026-27',
    fingerprint: 'f',
    importedAt: '2026-09-01T00:00:00.000Z',
    sourceKind: 'text',
    events: [],
    ...over,
  });

  const dated = (category: CalendarEvent['category'], startDate: string): CalendarEvent => ({
    id: startDate,
    startDate,
    endDate: null,
    title: 'Commencement of classes',
    category,
    sourceLine: '',
    page: 1,
  });

  it('keeps the latest calendar for a term and drops the one it replaced', () => {
    /*
     * THE DEFECT THIS FIXES. The dashboard read every saved calendar at once,
     * so a calendar a reissue had replaced kept producing events — the old
     * registration date sat beside the new one with nothing to say which was
     * which (§13, §45).
     */
    const older = held({ id: 'old', fingerprint: 'a', importedAt: '2026-09-01T00:00:00.000Z' });
    const newer = held({ id: 'new', fingerprint: 'b', importedAt: '2026-09-08T00:00:00.000Z' });

    expect(activeCalendars([older, newer]).map((entry) => entry.id)).toEqual(['new']);
  });

  it('keeps calendars for DIFFERENT terms all in force', () => {
    /* Two useful documents, not a conflict: this term's and next term's. */
    const odd = held({ id: 'odd', semester: 5 });
    const even = held({ id: 'even', semester: 6, fingerprint: 'z' });
    expect(activeCalendars([odd, even]).map((entry) => entry.id).sort()).toEqual(['even', 'odd']);
  });

  it('reports two calendars for one term that disagree', () => {
    const older = held({
      id: 'old',
      fingerprint: 'a',
      importedAt: '2026-09-01T00:00:00.000Z',
      events: [dated('SEMESTER_START', '2026-09-07')],
    });
    const newer = held({
      id: 'new',
      fingerprint: 'b',
      importedAt: '2026-09-08T00:00:00.000Z',
      events: [dated('SEMESTER_START', '2026-09-14')],
    });

    const conflicts = calendarConflicts([older, newer]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.differences.join(' ')).toContain('2026-09-07 → 2026-09-14');
  });

  it('does not call two unnamed rows a disagreement', () => {
    /*
     * Two rows the parser could not categorise are not evidence that anything
     * changed — they are two rows nobody identified.
     */
    const older = held({
      id: 'old',
      fingerprint: 'a',
      events: [dated('OTHER_ACADEMIC', '2026-09-07')],
    });
    const newer = held({
      id: 'new',
      fingerprint: 'b',
      importedAt: '2026-09-08T00:00:00.000Z',
      events: [dated('OTHER_ACADEMIC', '2026-09-14')],
    });
    expect(calendarConflicts([older, newer])).toEqual([]);
  });

  it('reports nothing when one calendar covers a term', () => {
    expect(calendarConflicts([held({ events: [dated('SEMESTER_START', '2026-09-07')] })])).toEqual(
      [],
    );
  });
});

describe('a day the calendar says is not a teaching day', () => {
  const withHoliday = (startDate: string, endDate: string | null): SavedCalendar => ({
    id: 'c',
    semester: 5,
    academicYear: '2026-27',
    fingerprint: 'f',
    importedAt: '2026-09-01T00:00:00.000Z',
    sourceKind: 'text',
    events: [
      {
        id: 'h',
        startDate,
        endDate,
        title: 'Dasara holidays',
        category: 'HOLIDAY',
        sourceLine: '',
        page: 1,
      },
    ],
  });

  it('finds a holiday the document printed', () => {
    expect(holidayOn([withHoliday('2026-10-12', null)], '2026-10-12')?.title).toMatch(/Dasara/);
  });

  it('covers every day of a holiday range', () => {
    const calendar = withHoliday('2026-10-12', '2026-10-20');
    expect(holidayOn([calendar], '2026-10-16')).not.toBeNull();
    expect(holidayOn([calendar], '2026-10-21')).toBeNull();
  });

  it('invents no holiday the document did not print', () => {
    /*
     * ONLY WHERE THE DOCUMENT SAYS SO (§18). Nothing here infers that a Sunday
     * is a holiday, or that a gap between events means the college is shut. A
     * calendar with no holiday rows produces none.
     */
    const noHolidays: SavedCalendar = {
      ...withHoliday('2026-10-12', null),
      events: [
        {
          id: 'x',
          startDate: '2026-10-12',
          endDate: null,
          title: 'Internal assessment',
          category: 'ACADEMIC_PERIOD',
          sourceLine: '',
          page: 1,
        },
      ],
    };
    expect(holidayOn([noHolidays], '2026-10-12')).toBeNull();
    /* A Sunday, with no calendar at all. */
    expect(holidayOn([], '2026-10-11')).toBeNull();
  });
});

describe('what the dashboard is given', () => {
  const event = (startDate: string, endDate: string | null = null): CalendarEvent => ({
    id: startDate,
    startDate,
    endDate,
    title: 'Something',
    category: 'OTHER_ACADEMIC',
    sourceLine: '',
    page: 1,
  });

  it('offers the next event and nothing else', () => {
    // One, not ten. The student already has a calendar; the useful thing is
    // the next thing (§32, §54).
    const next = nextEvent([event('2026-12-04'), event('2026-09-07'), event('2026-09-11')], '2026-09-08');
    expect(next?.startDate).toBe('2026-09-11');
  });

  it('keeps an event that has started but not finished', () => {
    const next = nextEvent([event('2026-12-05', '2026-12-24')], '2026-12-10');
    expect(next?.startDate).toBe('2026-12-05');
  });

  it('offers nothing once everything is past', () => {
    expect(nextEvent([event('2026-09-07')], '2027-01-01')).toBeNull();
  });

  it('counts the days from the day it is asked, and stores none of it', () => {
    expect(daysUntil(event('2026-09-11'), '2026-09-07')).toBe(4);
    expect(daysUntil(event('2026-09-07'), '2026-09-07')).toBe(0);
    expect(daysUntil(event('2026-09-07'), '2026-09-11')).toBe(-4);
  });
});
