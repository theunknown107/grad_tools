/**
 * The VTU 2022 CSE scheme, semesters I and II, exactly as the document states them.
 *
 * Authority: docs/09 §9.22 · docs/22 §22.46 · M10A.4
 *
 * ---------------------------------------------------------------------------
 * THE SOURCE
 * ---------------------------------------------------------------------------
 *
 *   Visvesvaraya Technological University, Belagavi
 *   "Scheme of Teaching and Examinations - 2022"
 *   Outcome-Based Education (OBE) and Choice Based Credit System (CBCS)
 *   Effective from the academic year 2022-23
 *   Document version line: 29052023/V10 scheme for Computer Science and
 *   Engineering and allied branches (CSE/ISE and BT all allied branches of CSE)
 *
 *   https://vtu.ac.in/pdf/2022syll/csesch.pdf
 *   sha256 0082c2289a43a53e9fc5f0f70140c9d41cf5f73695a07c83c561cde33c12e04e
 *   12 pages · retrieved 2026-09-02 · read with `pdftotext -layout`
 *
 * The PDF itself is NOT in this repository. The hash is what identifies it: a
 * scheme is revised, and the same URL will serve a different table next year,
 * so a URL alone names a location rather than a document (M10A.4 §18).
 *
 * ---------------------------------------------------------------------------
 * EVERY FIELD BELOW WAS READ OFF A NUMBERED PAGE
 * ---------------------------------------------------------------------------
 *
 * `page` is the page of THAT document. A twelve-page scheme holds four
 * semester tables and two elective expansions, so "it is in the scheme" sends
 * the next reader through all of them.
 *
 * `l`, `t`, `p` are the scheme's Teaching Hours/Week columns — the SCHEME's
 * hours. A college may teach different ones; a real timetable prints both and
 * they differ. Those would be a separate fact in separate columns, not a
 * better version of these (M10A.4 §15).
 *
 * `hasSee` is true for every row here, and it is now a READING rather than the
 * assumption M10A.2 had to retract: both semester tables carry a SEE Marks
 * column and every row in them prints 50. A course assessed on CIE alone would
 * print 0 there. None of these does — the CIE-only courses in this programme
 * are in later semesters, which this document does not cover.
 *
 * `category` is a NORMALISATION, not a quotation. The source labels courses
 * ASC / ESC / ETC / PLC / AEC / HSMC / HSMS / SDC. The ASC and ESC core rows
 * map to `core`; AEC / HSMC / HSMS / SDC to `mandatory`; and the ESC-I, ETC-I
 * and PLC-I group alternatives — which a student CHOOSES between — to
 * `elective`. Recorded here so a reviewer can see the mapping is ours rather
 * than VTU's wording.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------------------------------------------------------
 *
 * - **`BESCK104x`, `BETCK105x`, `BPLCK205x`.** The `x` is a placeholder for a
 *   family, not a course code. The families themselves ARE here, from the
 *   expansion tables on pages 3 and 6.
 *
 * - **The Chemistry-group semester-I table (page 7).** A second, parallel
 *   curriculum for the SAME semester — BCHES102 and BCEDK103 where the Physics
 *   group has BPHYS102 and BPOPS103. `subjects` has no column saying which
 *   group a row belongs to, so seeding both would put two curricula in one
 *   semester with nothing to tell them apart.
 *
 * - **`KIDTK258`**, printed in the semester-II row 8 group. Every sibling code
 *   in this scheme begins with `B`, so this is either a typo in the document or
 *   an artefact of a merged cell. Reading it either way would be a guess.
 *
 * - **Semesters III to VIII.** This document covers I and II only. Nothing
 *   here supports a semester-3 subject, and none is invented.
 *
 * - **A programme credit total.** Each semester table prints its own TOTAL of
 *   20 credits. The document states no total for the degree, so OQ-034 cannot
 *   be closed from it: summing two semesters of an eight-semester programme
 *   and calling it the requirement would be exactly the fabrication this
 *   milestone forbids.
 */

export const SCHEME_DOCUMENT_URL = 'https://vtu.ac.in/pdf/2022syll/csesch.pdf';
export const SCHEME_DOCUMENT_SHA256 =
  '0082c2289a43a53e9fc5f0f70140c9d41cf5f73695a07c83c561cde33c12e04e';
export const SCHEME_DOCUMENT_VERSION = '29052023/V10';
export const SCHEME_RETRIEVED_AT = '2026-09-02';
export const SCHEME_EFFECTIVE_FROM = '2022-23';

export interface SchemeRow {
  readonly code: string;
  readonly title: string;
  readonly credits: number;
  readonly semester: number;
  readonly category: 'core' | 'elective' | 'mandatory';
  /** Scheme lecture / tutorial / practical hours per week. */
  readonly l: number;
  readonly t: number;
  readonly p: number;
  readonly page: number;
}

/* Semester I, Physics group (page 1); elective expansions (page 3). */
const SEMESTER_ONE: readonly SchemeRow[] = [
  {
    code: 'BMATS101',
    title: 'Mathematics-I for CSE Stream',
    credits: 4,
    semester: 1,
    category: 'core',
    l: 2,
    t: 2,
    p: 2,
    page: 1,
  },
  {
    code: 'BPHYS102',
    title: 'Applied Physics for CSE stream',
    credits: 4,
    semester: 1,
    category: 'core',
    l: 2,
    t: 2,
    p: 2,
    page: 1,
  },
  {
    code: 'BPOPS103',
    title: 'Principles of Programming Using C',
    credits: 3,
    semester: 1,
    category: 'core',
    l: 2,
    t: 0,
    p: 2,
    page: 1,
  },
  {
    code: 'BENGK106',
    title: 'Communicative English',
    credits: 1,
    semester: 1,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 1,
  },
  {
    code: 'BPWSK106',
    title: 'Professional Writing Skills in English',
    credits: 1,
    semester: 1,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 1,
  },
  {
    code: 'BKSKK107',
    title: 'Samskrutika Kannada',
    credits: 1,
    semester: 1,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 1,
  },
  {
    code: 'BKBKK107',
    title: 'Balake Kannada',
    credits: 1,
    semester: 1,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 1,
  },
  {
    code: 'BICOK107',
    title: 'Indian Constitution',
    credits: 1,
    semester: 1,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 1,
  },
  {
    code: 'BIDTK158',
    title: 'Innovation and Design Thinking',
    credits: 1,
    semester: 1,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 1,
  },
  {
    code: 'BSFHK158',
    title: 'Scientific Foundations of Health',
    credits: 1,
    semester: 1,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 1,
  },

  /*
   * ESC-I / ETC-I / PLC-I. Titles and hours come from the expansion on page 3;
   * credits from the main table's group row on page 1, which prints 03 for the
   * group as a whole. `page` records where the course's identity is stated.
   */
  {
    code: 'BESCK104A',
    title: 'Introduction to Civil Engineering',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BESCK104B',
    title: 'Introduction to Electrical Engineering',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BESCK104C',
    title: 'Introduction to Electronics Communication',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BESCK104D',
    title: 'Introduction to Mechanical Engineering',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BESCK104E',
    title: 'Introduction to C Programming',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 3,
  },

  {
    code: 'BETCK105A',
    title: 'Smart Materials and Systems',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105B',
    title: 'Green Buildings',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105C',
    title: 'Introduction to Nano Technology',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105D',
    title: 'Introduction to Sustainable Engineering',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105E',
    title: 'Renewable Energy Sources',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105F',
    title: 'Waste Management',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105G',
    title: 'Emerging Applications of Biosensors',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105H',
    title: 'Introduction to Internet of Things (IOT)',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105I',
    title: 'Introduction to Cyber Security',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },
  {
    code: 'BETCK105J',
    title: 'Introduction to Embedded System',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 3,
  },

  {
    code: 'BPLCK105A',
    title: 'Introduction to Web Programming',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 3,
  },
  {
    code: 'BPLCK105B',
    title: 'Introduction to Python Programming',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 3,
  },
  {
    code: 'BPLCK105C',
    title: 'Basics of JAVA programming',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 3,
  },
  {
    code: 'BPLCK105D',
    title: 'Introduction to C++ Programming',
    credits: 3,
    semester: 1,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 3,
  },
];

/*
 * Semester II for students who took semester I under the Physics group
 * (page 4); elective expansions (page 6).
 */
const SEMESTER_TWO: readonly SchemeRow[] = [
  {
    code: 'BMATS201',
    title: 'Mathematics-II for CSE Stream',
    credits: 4,
    semester: 2,
    category: 'core',
    l: 2,
    t: 2,
    p: 2,
    page: 4,
  },
  {
    code: 'BCHES202',
    title: 'Applied Chemistry for CSE Stream',
    credits: 4,
    semester: 2,
    category: 'core',
    l: 2,
    t: 2,
    p: 2,
    page: 4,
  },
  {
    code: 'BCEDK203',
    title: 'Computer-Aided Engineering Drawing',
    credits: 3,
    semester: 2,
    category: 'core',
    l: 2,
    t: 0,
    p: 2,
    page: 4,
  },
  {
    code: 'BPWSK206',
    title: 'Professional Writing Skills in English',
    credits: 1,
    semester: 2,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 4,
  },
  {
    code: 'BENGK206',
    title: 'Communicative English',
    credits: 1,
    semester: 2,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 4,
  },
  {
    code: 'BICOK207',
    title: 'Indian Constitution',
    credits: 1,
    semester: 2,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 4,
  },
  {
    code: 'BKSKK207',
    title: 'Samskrutika Kannada',
    credits: 1,
    semester: 2,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 4,
  },
  {
    code: 'BKBKK207',
    title: 'Balake Kannada',
    credits: 1,
    semester: 2,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 4,
  },
  {
    code: 'BSFHK258',
    title: 'Scientific Foundations of Health',
    credits: 1,
    semester: 2,
    category: 'mandatory',
    l: 1,
    t: 0,
    p: 0,
    page: 4,
  },

  {
    code: 'BESCK204A',
    title: 'Introduction to Civil Engineering',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BESCK204B',
    title: 'Introduction to Electrical Engineering',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BESCK204C',
    title: 'Introduction to Electronics Communication',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BESCK204D',
    title: 'Introduction to Mechanical Engineering',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BESCK204E',
    title: 'Introduction to C Programming',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 6,
  },

  {
    code: 'BETCK205A',
    title: 'Smart materials and Systems',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205B',
    title: 'Green Buildings',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205C',
    title: 'Introduction to Nano Technology',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205D',
    title: 'Introduction to Sustainable Engineering',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205E',
    title: 'Renewable Energy Sources',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205F',
    title: 'Waste Management',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205G',
    title: 'Emerging Applications of Biosensors',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205H',
    title: 'Introduction to Internet of Things(IoT)',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205I',
    title: 'Introduction to Cyber Security',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },
  {
    code: 'BETCK205J',
    title: 'Introduction to Embedded System',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 3,
    t: 0,
    p: 0,
    page: 6,
  },

  {
    code: 'BPLCK205A',
    title: 'Introduction to Web Programming',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 6,
  },
  {
    code: 'BPLCK205B',
    title: 'Introduction to Python Programming',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 6,
  },
  {
    code: 'BPLCK205C',
    title: 'Basics of JAVA programming',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 6,
  },
  {
    code: 'BPLCK205D',
    title: 'Introduction to C++ Programming',
    credits: 3,
    semester: 2,
    category: 'elective',
    l: 2,
    t: 0,
    p: 2,
    page: 6,
  },
];

export const SCHEME_ROWS: readonly SchemeRow[] = [...SEMESTER_ONE, ...SEMESTER_TWO];

/**
 * The credits each semester table prints as its own TOTAL.
 *
 * A CHECK on the extraction, not a programme requirement. A student takes one
 * course from each OR-group, so summing every row above gives a larger number
 * than any student carries — and these totals are what the document says a
 * semester is worth.
 */
export const SEMESTER_CREDIT_TOTALS: Readonly<Record<number, number>> = { 1: 20, 2: 20 };
