/**
 * Reading a VTU syllabus into Course → Syllabus → Module → Topic.
 *
 * Authority: Phase 7D.2 §3–§10 · docs/38_VTU_INGESTION.md
 *
 * Every layout below is taken from a document in the store. The templates
 * differ enough that a parser written against one of them reads the others
 * wrongly, and each case here is a way that actually happened.
 */

import { describe, expect, it } from 'vitest';
import { parseSyllabusDocument } from '../src/syllabus-import.js';
import type { SchemePage } from '../src/scheme-import.js';

/** Text laid out one line per row, the way `linesOf` sees a merged table row. */
function pagesOf(...pages: readonly (readonly string[])[]): SchemePage[] {
  return pages.map((lines, index) => ({
    page: index + 1,
    items: lines.map((text, row) => ({
      text,
      x: 50,
      y: 700 - row * 14,
      width: text.length * 5,
      height: 10,
    })),
  }));
}

const HEADER = [
  'Course Code BQQ301 CIE Marks 50',
  'Teaching Hours/Week (L:T:P: S) 3:0:0:0 SEE Marks 50',
  'Total Hours of Pedagogy 40 Total Marks 100',
  'Credits 03 Exam Hours 03',
  'Course objectives:',
];

const one = (lines: readonly string[]) => {
  const [course] = parseSyllabusDocument(pagesOf(lines));
  if (course === undefined) throw new Error('no course parsed');
  return course;
};

describe('reading the header', () => {
  it('reads a code printed beside its label', () => {
    expect(one(HEADER).courseCode).toMatchObject({ value: 'BQQ301', state: 'resolved' });
  });

  it('reads a code printed in the cell below its label', () => {
    // 3csbssyll.pdf: "Course Code CIE Marks 50" / "BCB501" on the next line.
    const course = one(['Course Code CIE Marks 50', 'BQQ501', 'Credits 03', 'Course objectives:']);
    expect(course.courseCode.value).toBe('BQQ501');
  });

  it('takes the printed code from a pair and invents nothing', () => {
    /*
     * BPHYS102.pdf prints "BPHYS102/202" — one course taught in both semesters
     * of the first year. The primary is read; "/202" is an abbreviation, and
     * completing it into BPHYS202 would be the parser inventing a course code.
     */
    const course = one([
      'Course Code: CIE Marks 50',
      'BPHYS102/202',
      'Credits 04',
      'Course objectives:',
    ]);
    expect(course.courseCode.value).toBe('BPHYS102');
  });

  it.each([
    ['I Semester', 1],
    ['Semester 3', 3],
    ['Semester IV', 4],
    ['Semester VIII', 8],
  ])('reads %s', (line, expected) => {
    expect(one([line as string, ...HEADER]).semester.value).toBe(expected);
  });

  it('leaves the semester unavailable when the header never states it', () => {
    // The first-year physics and chemistry syllabi genuinely do not print it.
    expect(one(HEADER).semester).toMatchObject({ value: null, state: 'unavailable' });
  });

  it('reads the title that shares the semester line', () => {
    // 2csbssyll.pdf: "DATA STRUCTURES AND APPLICATIONS Semester 3".
    const course = one(['Invented Course Title Semester 3', ...HEADER]);
    expect(course.courseTitle.value).toBe('Invented Course Title');
    expect(course.semester.value).toBe(3);
  });

  it('reads the title on the line after a semester of its own', () => {
    // 2csbssyll.pdf p68: "Semester IV" / "DISCRETE MATHEMATICAL STRUCTURES".
    expect(one(['Semester IV', 'Invented Course Title', ...HEADER]).courseTitle.value).toBe(
      'Invented Course Title',
    );
  });

  it.each([
    ['below', ['Course Title:', 'Invented Course Title', ...HEADER]],
    ['above', ['Invented Course Title', 'Course Title:', ...HEADER]],
  ])('reads a title typeset %s its label', (_where, lines) => {
    /*
     * BPHYS102 puts the value below the label and BCHEC102 above it, because
     * the two documents merge the header cells differently. Both are the same
     * statement — the name beside the label.
     */
    expect(one(lines as string[]).courseTitle.value).toBe('Invented Course Title');
  });

  it('never reads a header cell as the course title', () => {
    expect(one(['Course Title:', 'Credits 03', ...HEADER]).courseTitle.value).not.toBe(
      'Credits 03',
    );
  });
});

describe('figures that cannot be what they say', () => {
  it('marks an impossible exam duration ambiguous and keeps what was printed', () => {
    /*
     * 2csbssyll.pdf prints "Credits 01 Exam Hours 100" for BCS358A. No
     * examination lasts a hundred hours — that cell has collected a marks
     * figure from the column beside it. §5: the reading survives for someone
     * to look at, and no consumer can mistake it for an established fact.
     */
    const course = one([
      'Course Code BQQ358 CIE Marks 50',
      'Credits 01 Exam Hours 100',
      'Course objectives:',
    ]);
    expect(course.examHours).toMatchObject({ value: 100, state: 'ambiguous' });
    expect(course.credits).toMatchObject({ value: 1, state: 'resolved' });
  });

  it('stops reading the header at the objectives, not at the first module', () => {
    /*
     * THE DEFECT THIS CATCHES. A laboratory course has no modules, so
     * "everything before the first module" was the whole document — and the
     * assessment table near its end says "Total Marks 30", which was then read
     * as the course's own total.
     */
    const course = one([
      'Course Code BQQ358 CIE Marks 50',
      'Credits 01',
      'Course objectives:',
      'To do the thing.',
      'Assessment Details (both CIE and SEE)',
      'Total Marks 30',
    ]);
    expect(course.totalMarks).toMatchObject({ value: null, state: 'unavailable' });
  });
});

describe('reading modules', () => {
  it('reads a heading that names its title', () => {
    const [module] = one([
      ...HEADER,
      'Module-1: Probability Distributions',
      'Review of basic probability theory.',
    ]).modules;
    expect(module).toMatchObject({ number: 1, title: 'Probability Distributions', page: 1 });
  });

  it('reads a heading that states only its hours', () => {
    // 2csbssyll.pdf: "Module-1 8Hours".
    const [module] = one([
      ...HEADER,
      'Module-1 8Hours',
      'Some continuous prose about the subject.',
    ]).modules;
    expect(module).toMatchObject({ number: 1, title: null, hours: 8 });
  });

  it('reads hours stated after the word, and keeps them out of the title', () => {
    // BCS403: "MODULE-1 No. of Hours: 8" was once read as the title "No. of".
    const [module] = one([
      ...HEADER,
      'MODULE-1 No. of Hours: 8',
      'Some continuous prose about the subject.',
    ]).modules;
    expect(module).toMatchObject({ hours: 8, title: null });
  });

  it('takes a title from a first body line that is a heading and nothing else', () => {
    /*
     * BPHYS102: "Module-1 (8 Hours)" / "Laser and Optical Fibers:" / content.
     * A line with content after its colon is a topic and stays one — the
     * distinction is the document's own.
     */
    const [module] = one([
      ...HEADER,
      'Module-1 (8 Hours)',
      'Laser and Optical Fibers:',
      'LASER : Characteristic properties of a LASER beam.',
    ]).modules;
    expect(module?.title).toBe('Laser and Optical Fibers');
    expect(module?.topics.map((topic) => topic.title)).toEqual(['LASER']);
  });

  it('numbers modules by what the heading says, not by position', () => {
    const parsed = one([...HEADER, 'Module-1: One', 'Content.', 'Module-3: Three', 'Content.']);
    expect(parsed.modules.map((module) => module.number)).toEqual([1, 3]);
  });

  it('records the page each module was read from', () => {
    const [course] = parseSyllabusDocument(
      pagesOf([...HEADER, 'Module-1: One', 'Content.'], ['Module-2: Two', 'Content.']),
    );
    // §9: provenance is mandatory, and the page is the part the parser supplies.
    expect(course?.modules.map((module) => module.page)).toEqual([1, 2]);
  });
});

describe('reading topics, and refusing to invent them', () => {
  it('reads the headings a module sets out', () => {
    const [module] = one([
      ...HEADER,
      'Module-1 8Hours',
      'INTRODUCTION TO DATA STRUCTURES: Data Structures, Classifications',
      'ARRAYS and STRUCTURES: Arrays, Dynamic Allocated Arrays',
      'STACKS: Stacks, Evaluation and conversion of Expressions',
    ]).modules;
    expect(module?.topics).toEqual([
      { order: 1, title: 'INTRODUCTION TO DATA STRUCTURES', page: 1 },
      { order: 2, title: 'ARRAYS and STRUCTURES', page: 1 },
      { order: 3, title: 'STACKS', page: 1 },
    ]);
  });

  it('finds no topics in a module written as prose', () => {
    /*
     * §8. Much of the mathematics is continuous prose, and the honest answer
     * is none — the alternative is splitting sentences and presenting the
     * result as the syllabus's own structure.
     */
    const [module] = one([
      ...HEADER,
      'Module-3: Statistical Inference 1',
      'Introduction, sampling distribution, standard error of a statistic.',
      'Testing of a hypothesis, level of significance, confidence limits.',
    ]).modules;
    expect(module?.topics).toEqual([]);
  });

  it('does not read the back half of a wrapped sentence as a topic', () => {
    /*
     * "Requisites of a laser system, Semiconductor Diode Laser, Applications:
     * Bar code scanner" is one sentence wrapped across lines. Reading its tail
     * as a heading would invent a subtopic the document never expressed.
     */
    const [module] = one([
      ...HEADER,
      'Module-1: Laser',
      'Requisites of a laser system, Semiconductor Diode Laser,',
      'Fiber Losses, Applications: Fiber Optic networking, Fiber Optic Communication',
    ]).modules;
    expect(module?.topics).toEqual([]);
  });

  it('does not read a bibliography line as a topic', () => {
    const [module] = one([
      ...HEADER,
      'Module-1: One',
      'REAL TOPIC: some content.',
      'Text Book: Chapter-1:1.2 Chapter-2: 2.1 to 2.7',
      'Reference Book 1: 1.1 to 1.4',
    ]).modules;
    expect(module?.topics.map((topic) => topic.title)).toEqual(['REAL TOPIC']);
  });

  it('records a topic once, however often the module repeats its heading', () => {
    const [module] = one([
      ...HEADER,
      'Module-1: One',
      'TREES: content.',
      'TREES: more content.',
    ]).modules;
    expect(module?.topics).toHaveLength(1);
  });
});

describe('reading a document', () => {
  it('separates the courses a semester-wide syllabus describes', () => {
    const parsed = parseSyllabusDocument(
      pagesOf(
        ['Invented One Semester 3', ...HEADER, 'Module-1: One', 'Content.'],
        [
          'Invented Two Semester 4',
          'Course Code BQQ401 CIE Marks 50',
          'Credits 04',
          'Course objectives:',
          'Module-1: Two',
          'Content.',
        ],
      ),
    );
    expect(parsed.map((course) => course.courseCode.value)).toEqual(['BQQ301', 'BQQ401']);
    expect(parsed.map((course) => course.semester.value)).toEqual([3, 4]);
    expect(parsed[1]?.courseTitle.value).toBe('Invented Two');
  });

  it('returns nothing for a document that describes no course', () => {
    expect(
      parseSyllabusDocument(pagesOf(['A page of prose about nothing in particular.'])),
    ).toEqual([]);
  });

  it('reads a header row typeset as separate cells', () => {
    /*
     * The header is a table: "Course Code: BQQ301" and "CIE Marks 50" share a
     * baseline, and reading in document order would interleave them.
     */
    const parsed = parseSyllabusDocument([
      {
        page: 1,
        items: [
          { text: 'CIE Marks 50', x: 400, y: 700, width: 60, height: 10 },
          { text: 'Course Code: BQQ301', x: 50, y: 700, width: 90, height: 10 },
          { text: 'Course objectives:', x: 50, y: 686, width: 80, height: 10 },
        ],
      },
    ]);
    expect(parsed[0]?.courseCode.value).toBe('BQQ301');
    expect(parsed[0]?.cieMarks.value).toBe(50);
  });
});

describe('what sits where a title would', () => {
  it('does not read the revision stamp above the header as the title', () => {
    /*
     * THE DEFECT THIS CATCHES. The first-year documents print "16-2-2023"
     * above the header, one line above "I Semester" — exactly where a title
     * would sit. Reading the header in a single pass let the semester line
     * claim it, and the real title arrived too late to displace it.
     */
    const course = one([
      '16-2-2023',
      'I Semester',
      'Course Title: Mathematics-I for Computer Science and Engineering',
      ...HEADER,
    ]);
    expect(course.courseTitle.value).toBe('Mathematics-I for Computer Science and Engineering');
    expect(course.semester.value).toBe(1);
  });

  it('does not read a bare date as a title even with no label to prefer', () => {
    const course = one(['16-2-2023', 'Semester 3', ...HEADER]);
    expect(course.courseTitle.value).not.toBe('16-2-2023');
  });
});
