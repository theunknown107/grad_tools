/**
 * Which parser a document goes to, and which documents go to none.
 *
 * Authority: docs/22 §22.57 · M10A.7 §10, §11, §12, §39
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS GUARDS
 * ---------------------------------------------------------------------------
 *
 * Every VTU document says "Visvesvaraya Technological University" and most of
 * them say "semester". A classifier built on either would route a question
 * paper into the result importer and an exam schedule into the calendar.
 *
 * The exam schedule is the case that matters most, and it is not hypothetical:
 * the university issues a "Draft Time Table for ... Examinations" that is a
 * table of dates, names semesters, and carries the university's identity.
 * Reading it as an academic calendar would fill a student's term with exam
 * rows labelled as semester milestones. The shape below is that document's.
 *
 * Every value here is synthetic.
 */

import { describe, expect, it } from 'vitest';
import { classifyDocument } from '../src/domain/document-type.js';
import type { ImportLine } from '../src/domain/result-import.js';

const lines = (...text: readonly string[]): ImportLine[] =>
  text.map((value) => ({ text: value, page: 1 }));

const RESULT = lines(
  'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
  'VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION',
  'University Seat Number : 9ZZ99ZZ999',
  'Semester : 4',
  'Subject Code  Subject Name  Internal Marks  External Marks  Total  Result',
  'BQAS401  ALGORITHMS  44  36  80  P  2026-07-23',
);

const CALENDAR = lines(
  'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
  'ACADEMIC CALENDAR FOR THE ODD SEMESTER 2026-27',
  'Commencement of classes for V semester   07 Sep 2026',
  'Last date for registration              11 Sep 2026',
  'Last working day                        04 Dec 2026',
);

const TIMETABLE = lines(
  'EXAMPLE INSTITUTE OF TECHNOLOGY',
  'CLASS TIME TABLE  W.E.F. 01/07/2026',
  'Day  09:00-09:55  10:00-10:55  11:00-11:55  LUNCH  02:00-02:55',
  'MONDAY  MAT  PHY  POP  ---  ESC',
  'TUESDAY  PHY  MAT  ETC  ---  POP',
  'WEDNESDAY  POP  ESC  MAT  ---  PHY',
);

describe('the three documents GradTools reads', () => {
  it('sends a result card to the result importer', () => {
    const seen = classifyDocument(RESULT);
    expect(seen.type).toBe('result');
    expect(seen.signals).toContain('internal marks column');
  });

  it('sends an academic calendar to the calendar importer', () => {
    const seen = classifyDocument(CALENDAR);
    expect(seen.type).toBe('academic_calendar');
    expect(seen.signals).toContain('academic calendar heading');
  });

  it('recognises a class timetable and says it cannot read one yet', () => {
    /*
     * Recognised rather than refused as unknown, so the message can be true.
     * "GradTools cannot read timetables yet" is a different statement from
     * "this is not an academic document", and only one of them is accurate.
     */
    const seen = classifyDocument(TIMETABLE);
    expect(seen.type).toBe('college_timetable');
    expect(seen.reason).toMatch(/cannot read timetables yet/i);
  });
});

describe('documents that are academic and still not supported', () => {
  it('does not read a university exam schedule as an academic calendar', () => {
    /*
     * THE CASE THIS FILE EXISTS FOR. Shaped after a real VTU draft examination
     * time table: the university's own name, a Date/Day column, semester
     * headings and a page of dates. Everything a naive calendar rule would
     * accept — and reading it as one would put exam sittings into a student's
     * term as though they were semester milestones.
     */
    const examSchedule = lines(
      'Visvesvaraya Technological University, Belagavi',
      'Draft Time Table for Eligible Students of B.E. III & IV (2022 Scheme) Examinations, Dec.2026/Jan.2027',
      'Date, Day    III - Semester    IV - Semester',
      '23-01-2027, Friday    BQAT301    --',
      '27-01-2027, Tuesday   --         BQOK407',
      '28-01-2027, Wednesday BQAT302    --',
      'Registrar (Evaluation)',
    );

    const seen = classifyDocument(examSchedule);
    expect(seen.type).toBe('unsupported');
    expect(seen.reason).toMatch(/examination time table/i);
  });

  it('names an exam schedule even when it scores higher as a timetable', () => {
    /*
     * FOUND ON A REAL DOCUMENT. A university exam schedule scored NINE on the
     * class-timetable signals and seven on its own: its "Date, Day" column
     * lists weekday names in sequence and its heading carries sitting times.
     * The generic reading won and the product told the student it was a class
     * timetable.
     *
     * Both answers refuse the document, so nothing unsafe happened — the
     * message was simply untrue. A more specific signature now settles it, and
     * these signals cannot fire on a weekly class timetable.
     */
    const looksLikeBoth = lines(
      'Visvesvaraya Technological University, Belagavi',
      'Draft Time Table for Eligible Students of B.E. Examinations, Dec.2026',
      'Date, Day    III - Semester 2.00pm to 5.00pm    IV - Semester',
      '23-01-2027, Friday    BQAT301',
      '27-01-2027, Tuesday   BQAT302',
      '28-01-2027, Wednesday BQAT303',
      'Registrar (Evaluation)',
    );

    const seen = classifyDocument(looksLikeBoth);
    expect(seen.type).toBe('unsupported');
    expect(seen.reason).toMatch(/examination time table/i);
    expect(seen.reason).not.toMatch(/class timetable/i);
  });

  it('refuses a question paper rather than routing it anywhere', () => {
    const paper = lines(
      'Visvesvaraya Technological University, Belagavi',
      'Fourth Semester B.E. Degree Examination',
      'USN',
      'Max. Marks: 100',
      'Module - 1',
      'Answer any FIVE full questions, choosing ONE full question from each module.',
    );
    const seen = classifyDocument(paper);
    expect(seen.type).toBe('unsupported');
    expect(seen.reason).toMatch(/question paper/i);
  });
});

describe('documents that are not academic at all', () => {
  it('refuses an invoice, and says what to do next', () => {
    const invoice = lines(
      'ACME SUPPLIES LIMITED',
      'Invoice 4417',
      'Date: 03/06/2026',
      'Amount due: 12,400.00',
    );
    const seen = classifyDocument(invoice);
    expect(seen.type).toBe('unsupported');
    expect(seen.reason).toMatch(/could not identify|enter the details by hand/i);
  });

  it('refuses a page of lecture notes', () => {
    const notes = lines(
      'Chapter 3 — Dynamic Programming',
      'The principle of optimality states that an optimal policy has the property',
      'that whatever the initial state and initial decision are, the remaining',
      'decisions must constitute an optimal policy.',
    );
    expect(classifyDocument(notes).type).toBe('unsupported');
  });

  it('refuses a document that produced nothing at all', () => {
    const seen = classifyDocument([]);
    expect(seen.type).toBe('unsupported');
    expect(seen.reason).toMatch(/nothing could be read/i);
  });
});

describe('one signal is never enough', () => {
  it('does not call a page an academic calendar because it says "semester"', () => {
    /*
     * The floor exists so that no single match can carry a document: the
     * largest weight is 4 and the floor is 6, so a lone signal cannot reach it.
     */
    const weak = lines('Notice', 'Students of the odd semester should see the office.');
    expect(classifyDocument(weak).type).toBe('unsupported');
  });

  it('does not call a page a result card because it names the university', () => {
    const weak = lines('VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', 'Notice board');
    expect(classifyDocument(weak).type).toBe('unsupported');
  });

  it('refuses rather than guessing when two readings are close', () => {
    /*
     * A document that is genuinely half a calendar and half something else is
     * not a decision the evidence supports. Refusing offers manual entry;
     * guessing would file dates under the wrong document type.
     */
    const mixed = lines(
      'ACADEMIC CALENDAR',
      'Last working day of the term',
      'University Seat Number : 9ZZ99ZZ999',
      'VTU PROVISIONAL RESULTS',
    );
    const seen = classifyDocument(mixed);
    expect(seen.type).toBe('unsupported');
    expect(seen.reason).toMatch(/more than one kind/i);
  });
});
