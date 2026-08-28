/**
 * Demo question papers.
 *
 * Authority: docs/21 §21.19 · docs/17 §17.13 · M8 §18, §39, §49
 *
 * ---------------------------------------------------------------------------
 * THIS IS SYNTHETIC CONTENT AND IT SAYS SO
 * ---------------------------------------------------------------------------
 *
 * Every paper here was written by this file. None is a VTU paper, none is
 * copied from one, and none is presented as one: the publisher is visibly
 * fictional and the interface labels the source as demo data (M8 §18).
 *
 * The `host` papers are the only documents in this project that legitimately
 * reach `presentation = 'host'`, and the reason is narrow and worth stating:
 * GradTools wrote them, so GradTools holds the rights to them. `OQ-008` — may
 * we redistribute somebody else's question paper — remains open and is
 * untouched by this file (M8 §42).
 *
 * NOT PART OF `seed.ts`, and run only on request:
 *
 *     pnpm --filter @gradtools/api seed:demo-papers
 *
 * WHAT THE FIXTURES DELIBERATELY COVER (M8 §39)
 *
 *   host / link / private / blocked      every availability mode
 *   descriptive / mcq / unknown          every format, `unknown` included
 *   catalogued subject / loose taxonomy  both ways of saying which subject
 *   missing year, missing semester       so "unknown" has to render as unknown
 *   two sittings of one subject          so near-duplicate rows are visible
 *   a very long title and subject name   so the layout is tested by data
 */

import { createHash } from 'node:crypto';
import { createClient, type Sql } from './client.js';
import { LocalObjectStore, storageKeyFor, type ObjectStore } from '../documents/storage.js';
import { loadConfig } from '../config.js';

const DEMO_SOURCE = 'demo-question-papers';
const DEMO_PUBLISHER = 'Demo University (synthetic)';

/**
 * A minimal, valid, single-page PDF.
 *
 * WRITTEN HERE RATHER THAN COMMITTED AS A FILE (M8 §18, §19). No PDF enters
 * the repository: these bytes are generated at seed time, which also means the
 * demo corpus cannot accidentally acquire a real paper by someone dropping one
 * into a fixtures directory.
 *
 * Hand-assembled rather than produced by a PDF library, because the only
 * requirement is that a browser's viewer opens it and shows the text — a
 * dependency for that would be a dependency to maintain forever.
 */
function demoPdf(lines: readonly string[]): Buffer {
  const escape = (text: string) => text.replace(/([\\()])/g, '\\$1');
  const content =
    'BT /F1 13 Tf 60 760 Td 16 TL\n' +
    lines.map((line) => `(${escape(line)}) Tj T*`).join('\n') +
    '\nET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(Buffer.byteLength(content))} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(xrefAt)}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

interface DemoPaper {
  readonly title: string;
  /** A code in the seeded catalogue links by id; anything else uses the loose columns. */
  readonly subjectCode: string | null;
  readonly subjectTitle: string | null;
  readonly semester: number | null;
  readonly examYear: number | null;
  readonly examSession: string | null;
  readonly format: 'descriptive' | 'mcq' | 'unknown';
  readonly availability: 'host' | 'link' | 'private' | 'blocked';
  readonly sourceUrl?: string;
  readonly body?: readonly string[];
  readonly note: string;
}

/**
 * The fixtures.
 *
 * Codes are shaped like VTU codes and the subjects are real subjects, because
 * a library full of `SUBJ101 — Test Subject` would not exercise the layout a
 * student actually meets. The PAPERS are invented; nothing here was copied.
 */
const DEMO_PAPERS: readonly DemoPaper[] = [
  {
    title: 'DEMO — Database Management Systems, June/July 2025',
    subjectCode: 'BCS403',
    subjectTitle: 'Database Management Systems',
    semester: 4,
    examYear: 2025,
    examSession: 'June/July 2025',
    format: 'descriptive',
    availability: 'host',
    note: 'Written by GradTools. Hosted because GradTools holds the rights to it.',
    body: [
      'DEMO DATA - Demo University (synthetic)',
      'This is not a VTU question paper.',
      '',
      'BCS403  Database Management Systems',
      'Fourth Semester  -  June/July 2025  -  Time: 3 hrs  -  Max Marks: 100',
      '',
      'Module-1',
      '1. a) Define a relation. Explain the difference between a candidate',
      '      key and a primary key.                                      8',
      '   b) Draw an ER diagram for a library that lends books to',
      '      students.                                                  12',
      '',
      'Module-2',
      '2. a) Write relational algebra for all students with no backlogs.',
      '                                                                 10',
      '   b) Explain normalisation up to BCNF with one worked example.',
      '                                                                 10',
    ],
  },
  {
    title: 'DEMO — Database Management Systems, January 2025',
    subjectCode: 'BCS403',
    subjectTitle: 'Database Management Systems',
    semester: 4,
    examYear: 2025,
    examSession: 'January 2025',
    format: 'descriptive',
    availability: 'host',
    note: 'A second sitting of the same subject, so two near-identical rows are visible.',
    body: [
      'DEMO DATA - Demo University (synthetic)',
      'This is not a VTU question paper.',
      '',
      'BCS403  Database Management Systems',
      'Fourth Semester  -  January 2025  -  Time: 3 hrs  -  Max Marks: 100',
      '',
      'Module-1',
      '1. a) Explain the three-schema architecture.                     10',
      '   b) Distinguish between DDL and DML with examples.             10',
    ],
  },
  {
    title: 'DEMO — Mathematics-I for CSE Stream, June/July 2024',
    // In the seeded catalogue, so this paper links by subject id.
    subjectCode: 'BMATS101',
    subjectTitle: null,
    semester: null,
    examYear: 2024,
    examSession: 'June/July 2024',
    format: 'descriptive',
    availability: 'host',
    note: 'Catalogued subject: scheme, branch and semester come from the subject row.',
    body: [
      'DEMO DATA - Demo University (synthetic)',
      'This is not a VTU question paper.',
      '',
      'BMATS101  Mathematics-I for CSE Stream',
      'First Semester  -  June/July 2024',
      '',
      '1 a. Find the radius of curvature of r = a(1 + cos t).     (08 Marks)',
      '  b. Expand log(1 + x) as a Maclaurin series up to x^4.    (06 Marks)',
      '  c. Evaluate the double integral of xy over the unit square.',
      '                                                           (06 Marks)',
    ],
  },
  {
    title: 'DEMO — Principles of Programming Using C, model paper',
    subjectCode: 'BPOPS103',
    subjectTitle: null,
    semester: null,
    // A model paper belongs to no sitting. The year stays unknown rather than
    // being filled in with the year the file was made (M8 §7).
    examYear: null,
    examSession: 'Model question paper',
    format: 'unknown',
    availability: 'host',
    note: 'Format genuinely unknown, and year genuinely absent. Both must render as unknown.',
    body: [
      'DEMO DATA - Demo University (synthetic)',
      'This is not a VTU question paper.',
      '',
      'BPOPS103  Principles of Programming Using C',
      'Model question paper  -  no examination sitting',
      '',
      '1. Write a C program to reverse an array in place.',
      '2. Explain call by value and call by reference.',
    ],
  },
  {
    title: 'DEMO — Analysis and Design of Algorithms, multiple choice, 2025',
    subjectCode: 'BCS401',
    subjectTitle: 'Analysis and Design of Algorithms',
    semester: 4,
    examYear: 2025,
    examSession: 'June/July 2025',
    format: 'mcq',
    availability: 'host',
    note: 'An MCQ paper, so the format filter has something to select.',
    body: [
      'DEMO DATA - Demo University (synthetic)',
      'This is not a VTU question paper.',
      '',
      'BCS401  Analysis and Design of Algorithms',
      'Fourth Semester  -  June/July 2025  -  50 questions  -  1 mark each',
      '',
      '1. The worst-case time complexity of quicksort is',
      '   (A) O(n)      (B) O(n log n)    (C) O(n^2)    (D) O(log n)',
      '',
      '2. A stable sorting algorithm among the following is',
      '   (A) Quicksort (B) Heapsort      (C) Merge sort (D) Selection sort',
    ],
  },
  {
    title:
      'DEMO — Object Oriented Programming with Java and an unusually long paper title that exists ' +
      'specifically to prove the library layout does not break when a real one runs on',
    subjectCode: 'BCS306A',
    subjectTitle:
      'Object Oriented Programming with Java, including inheritance, interfaces and exception handling',
    semester: 3,
    examYear: 2024,
    examSession: 'December 2024/January 2025',
    format: 'descriptive',
    availability: 'host',
    note: 'Long title and long subject name, so the layout is tested by data rather than by hand.',
    body: [
      'DEMO DATA - Demo University (synthetic)',
      'This is not a VTU question paper.',
      '',
      'BCS306A  Object Oriented Programming with Java',
      'Third Semester  -  December 2024/January 2025',
      '',
      '1 a. Explain method overloading and method overriding.     (10 Marks)',
      '  b. Write a Java program demonstrating interface inheritance.',
      '                                                           (10 Marks)',
    ],
  },
  {
    /*
     * LINK. GradTools holds metadata and nothing else.
     *
     * The URL is example.org on purpose: pointing a demo fixture at a real
     * paper site would be presenting somebody's material as part of this
     * library, which is the exact thing rights are meant to prevent (M8 §42).
     */
    title: 'DEMO — Discrete Mathematical Structures, 2024 (link only)',
    subjectCode: 'BCS405A',
    subjectTitle: 'Discrete Mathematical Structures',
    semester: 4,
    examYear: 2024,
    examSession: 'June/July 2024',
    format: 'descriptive',
    availability: 'link',
    sourceUrl: 'https://example.org/demo/papers/bcs405a-2024',
    note: 'Metadata only. GradTools does not have this file and must not fetch it.',
  },
  {
    title: 'DEMO — Operating Systems, 2023 (link only, year known, semester not)',
    subjectCode: 'BCS303',
    subjectTitle: 'Operating Systems',
    // A paper whose semester nobody recorded. It must still be findable.
    semester: null,
    examYear: 2023,
    examSession: null,
    format: 'unknown',
    availability: 'link',
    sourceUrl: 'https://example.org/demo/papers/bcs303-2023',
    note: 'Partial metadata: the missing fields must show as unknown, not as defaults.',
  },
  {
    title: 'DEMO — a private upload that must never appear in the public library',
    subjectCode: 'BCS402',
    subjectTitle: 'Microcontrollers',
    semester: 4,
    examYear: 2024,
    examSession: 'June/July 2024',
    format: 'descriptive',
    availability: 'private',
    note: 'Exists so the private exclusion is demonstrable rather than merely asserted.',
    body: ['DEMO DATA - a private document. It must not be reachable from the library.'],
  },
  {
    title: 'DEMO — a blocked paper that must never be offered for opening',
    subjectCode: 'BCS404',
    subjectTitle: 'Data Structures',
    semester: 4,
    examYear: 2023,
    examSession: 'January 2023',
    format: 'descriptive',
    availability: 'blocked',
    note: 'Exists so the blocked exclusion is demonstrable rather than merely asserted.',
  },
];

/**
 * Writes the demo library.
 *
 * Idempotent by content hash: the documents table makes `sha256` unique, so
 * running this twice updates the same ten rows rather than creating twenty.
 */
export async function seedDemoPapers(sql: Sql, store: ObjectStore): Promise<number> {
  await sql`
    INSERT INTO sources (
      id, kind, publisher, canonical_url, authority, access_method,
      robots_status, terms_status, rights_status, verification, enabled, notes
    ) VALUES (
      ${DEMO_SOURCE}, 'question_papers', ${DEMO_PUBLISHER},
      'https://example.org/demo/papers', 'user', 'none',
      'unknown', 'unknown', 'permitted', 'draft', false,
      'Synthetic demo papers written by GradTools. Not a real source, never fetched, and deliberately left disabled.'
    )
    ON CONFLICT (id) DO NOTHING
  `;

  let written = 0;

  for (const paper of DEMO_PAPERS) {
    const held = paper.availability === 'host' || paper.availability === 'private';
    const bytes = demoPdf(paper.body ?? [`DEMO DATA - ${paper.title}`]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = held ? storageKeyFor(sha256) : null;
    if (storageKey !== null) await store.put(storageKey, bytes);

    /*
     * Catalogued subject, or loose taxonomy — never both. The database CHECK
     * refuses the combination, so the choice is made here explicitly rather
     * than by writing every column and hoping.
     */
    const [catalogued] = await sql<{ id: string }[]>`
      SELECT id::text FROM subjects WHERE code = ${paper.subjectCode ?? ''} LIMIT 1
    `;
    const subjectId = catalogued?.id ?? null;

    /*
     * `user_private` for the private fixture: the database will not let that
     * rights status be presented any way but privately, which is the rule
     * being demonstrated. Everything else GradTools wrote, so `permitted` is a
     * statement about our own material and not a claim about anyone else's.
     */
    const rightsStatus =
      paper.availability === 'private'
        ? 'user_private'
        : paper.availability === 'blocked'
          ? 'unknown'
          : 'permitted';
    const rightsDeterminedAt = rightsStatus === 'permitted' ? new Date().toISOString() : null;

    await sql`
      INSERT INTO documents (
        source_id, title, sha256, byte_size, mime_type, page_count,
        storage_key, state, extraction_status,
        rights_status, rights_determined_at, rights_note, presentation,
        source_url, document_kind,
        subject_id, subject_code, scheme_id, branch_id, semester,
        exam_year, exam_session
      ) VALUES (
        ${paper.availability === 'private' ? null : DEMO_SOURCE},
        ${paper.title}, ${sha256}, ${bytes.length}, 'application/pdf', 1,
        ${storageKey}, 'validated', ${paper.body === undefined ? 'pending' : 'text_available'},
        ${rightsStatus}, ${rightsDeterminedAt},
        ${`DEMO DATA. ${paper.note}`}, ${paper.availability},
        ${paper.sourceUrl ?? null}, 'question_paper',
        ${subjectId}::uuid,
        ${subjectId === null ? paper.subjectCode : null},
        ${subjectId === null ? 'vtu-2022' : null},
        ${subjectId === null ? 'cse' : null},
        ${subjectId === null ? paper.semester : null},
        ${paper.examYear}, ${paper.examSession}
      )
      ON CONFLICT (sha256) DO UPDATE SET
        title = EXCLUDED.title,
        presentation = EXCLUDED.presentation,
        document_kind = EXCLUDED.document_kind,
        exam_year = EXCLUDED.exam_year,
        exam_session = EXCLUDED.exam_session
    `;

    /*
     * The format lives on the document, and is set separately because it is a
     * detection outcome rather than something the library chooses. `unknown`
     * is written as `unknown` (docs/17 §17.12).
     */
    await sql`UPDATE documents SET paper_format = ${paper.format} WHERE sha256 = ${sha256}`;

    written += 1;
  }

  return written;
}

/* Entry point: pnpm --filter @gradtools/api seed:demo-papers */
if (process.argv[1]?.includes('seed-demo-papers')) {
  const config = loadConfig();
  const sql = createClient(config.DATABASE_URL);
  seedDemoPapers(sql, new LocalObjectStore(config.DOCUMENT_STORAGE_ROOT))
    .then((count) => {
      // eslint-disable-next-line no-console
      console.log(`Seeded ${String(count)} DEMO question papers. They are labelled as synthetic.`);
    })
    .finally(() => sql.end());
}
