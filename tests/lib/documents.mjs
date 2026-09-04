/**
 * Synthetic result documents, built byte by byte.
 *
 * Authority: docs/22 §22.50, §22.54, §22.56
 *
 * ---------------------------------------------------------------------------
 * WHY THE HARNESSES BUILD THEIR OWN PDFs
 * ---------------------------------------------------------------------------
 *
 * A fixture file checked into the repository would either be somebody's real
 * result card or a copy of one, and neither belongs here. Generating the
 * document instead means every value is invented, the shape can be varied per
 * test, and there is nothing to leak.
 *
 * Three harnesses need the same builders — import, OCR, and the workflow sweep —
 * so they live in one place rather than in three copies that drift.
 *
 * EVERY VALUE PRODUCED HERE IS SYNTHETIC. The seat number is a deliberately
 * impossible pattern, and the subject codes use a `BQ` prefix that no VTU
 * scheme issues.
 */
import { Buffer } from 'node:buffer';

/**
 * A PDF with a text layer, one page per group of placed items.
 *
 * Items are placed by coordinate rather than written as lines, because that is
 * how a real producer emits a table — column by column — and joining text in
 * reading order is exactly the mistake the row reader exists to avoid.
 */
export function makePdf(pages, { width = 612, height = 792 } = {}) {
  const escape = (text) => text.replace(/([\\()])/g, '\\$1');

  const contents = pages.map(
    (placed) =>
      'BT\n' +
      placed
        .map(
          (item) =>
            `/F1 10 Tf\n1 0 0 1 ${String(item.x)} ${String(item.y)} Tm\n(${escape(item.text)}) Tj`,
        )
        .join('\n') +
      '\nET',
  );

  /*
   * Object numbering: 1 catalogue, 2 pages, 3 font, then a content stream and a
   * page object per page. Kept explicit rather than computed from a builder,
   * because an xref table that is off by one produces a file that opens in some
   * readers and not others — the worst kind of test fixture.
   */
  const contentFirst = 4;
  const pageFirst = contentFirst + pages.length;
  const kids = pages.map((_, index) => `${String(pageFirst + index)} 0 R`).join(' ');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...contents.map((content) => `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`),
    ...pages.map(
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}]` +
        ` /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentFirst + index)} 0 R >>`,
    ),
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** The heading block a VTU card prints above its table. */
export function cardHeading(semester, { withSemester = true } = {}) {
  const placed = [
    { text: 'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', x: 60, y: 750 },
    { text: 'VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION', x: 60, y: 735 },
    { text: 'University Seat Number : 9ZZ99ZZ999', x: 60, y: 715 },
    { text: 'Subject Code', x: 60, y: 680 },
    { text: 'Internal Marks', x: 300, y: 680 },
    { text: 'External Marks', x: 380, y: 680 },
  ];
  if (withSemester) placed.push({ text: `Semester : ${String(semester)}`, x: 60, y: 700 });
  return placed;
}

/** Table rows, placed at the column positions a real card uses. */
export function cardRows(rows, { from = 660 } = {}) {
  const placed = [];
  rows.forEach((row, index) => {
    const y = from - index * 18;
    const xs = [60, 140, 310, 390, 450, 495, 525];
    row.forEach((cell, column) => placed.push({ text: cell, x: xs[column], y }));
  });
  return placed;
}

/** A one-page card. */
export function resultPdf(semester, rows) {
  return makePdf([[...cardHeading(semester), ...cardRows(rows)]]);
}

/**
 * A card whose subjects run over two pages.
 *
 * The heading — and therefore the semester — appears only on page one, exactly
 * as a real continued document prints it. The rows on page two must still join
 * the same semester rather than becoming a semester of their own.
 */
export function multiPageResultPdf(semester, firstPage, secondPage) {
  return makePdf([
    [...cardHeading(semester), ...cardRows(firstPage)],
    [{ text: 'VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION', x: 60, y: 750 }, ...cardRows(secondPage, { from: 700 })],
  ]);
}

/** `count` invented subject rows, all passed, with the given code prefix. */
export function graded(prefix, count, { internal = 40, external = 30 } = {}) {
  return Array.from({ length: count }, (_, index) => [
    `${prefix}${String(index)}`,
    `SUBJECT ${String(index)}`,
    String(internal),
    String(external),
    String(internal + external),
    'P',
    '2026-03-13',
  ]);
}

/**
 * An academic calendar, as a text PDF.
 *
 * Shaped after a real one: a heading naming the term, a table of dated
 * milestones, and — crucially — the paperwork that surrounds them. The
 * notification number, the circular reference and the distribution list all
 * carry dates and none of them is an event, which is the case the parser has
 * to get right (M10A.7 §20).
 */
export function calendarPdf({
  academicYear = '2026-27',
  semester = 'V',
  rows = [
    ['Commencement of classes for the semester', '07 Sep 2026'],
    ['Last date for registration without late fee', '11 Sep 2026'],
    ['Semester end examinations', '05 Dec 2026 to 24 Dec 2026'],
    ['Last working day of the semester', '04 Dec 2026'],
  ],
  withPaperwork = true,
} = {}) {
  const placed = [
    { text: 'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', x: 60, y: 750 },
    { text: `ACADEMIC CALENDAR FOR THE ODD SEMESTER ${academicYear}`, x: 60, y: 730 },
    { text: `${semester} SEMESTER B.E.`, x: 60, y: 712 },
    { text: 'Event', x: 60, y: 685 },
    { text: 'Date', x: 400, y: 685 },
  ];

  rows.forEach((row, index) => {
    const y = 660 - index * 20;
    placed.push({ text: row[0], x: 60, y });
    placed.push({ text: row[1], x: 400, y });
  });

  if (withPaperwork) {
    const y = 660 - rows.length * 20 - 30;
    placed.push({ text: 'Note : As per Notification No. EX/BGM/598/2026-27/4718 dt. 05/12/2026', x: 60, y });
    placed.push({ text: 'Ref No. EX/ACA/2026-27 dated 01/08/2026', x: 60, y: y - 18 });
    placed.push({ text: 'Copy to: The Principal, all affiliated colleges — 01/09/2026', x: 60, y: y - 36 });
  }

  return makePdf([placed]);
}

/**
 * A university examination schedule.
 *
 * Academic, dated, university-issued — and not one of the three documents
 * GradTools reads. It exists here so the classifier's refusal can be proved
 * against the document that most resembles a calendar without being one.
 */
export function examSchedulePdf() {
  const placed = [
    { text: 'Visvesvaraya Technological University, Belagavi', x: 60, y: 750 },
    { text: 'Draft Time Table for Eligible Students of B.E. III & IV Examinations, Dec.2026', x: 60, y: 730 },
    { text: 'Date, Day', x: 60, y: 700 },
    { text: 'III - Semester', x: 260, y: 700 },
    { text: 'IV - Semester', x: 420, y: 700 },
  ];
  [
    ['23-01-2027, Friday', 'BQAT301', '--'],
    ['27-01-2027, Tuesday', '--', 'BQOK407'],
    ['28-01-2027, Wednesday', 'BQAT302', '--'],
  ].forEach((row, index) => {
    const y = 675 - index * 20;
    placed.push({ text: row[0], x: 60, y });
    placed.push({ text: row[1], x: 260, y });
    placed.push({ text: row[2], x: 420, y });
  });
  placed.push({ text: 'Registrar (Evaluation)', x: 400, y: 580 });
  return makePdf([placed]);
}

/**
 * A class timetable, laid out as a real one is.
 *
 * A GRID, not rows of text: each cell is placed under the time column it
 * belongs to, because that is the only thing that tells the parser what hour a
 * cell means. Shaped after the reference document — a header of time ranges,
 * six day rows, break and lunch columns, batch-split cells, a lab across two
 * columns, and a subject table at the foot that is the only place the initials
 * are defined.
 *
 * EVERY VALUE IS SYNTHETIC: no real college, subject, room or person.
 */
export function timetablePdf({
  revision = 'R2',
  effective = '07/11/2026',
  className = 'I (E) CSBS SEMESTER I',
  monday = ['ESC', 'MAT', 'BREAK', 'PHY', 'POP', 'LUNCH', 'ETC', null],
} = {}) {
  /* Column x positions, one per time slot. */
  const xs = [150, 250, 350, 440, 530, 620, 720, 820];
  const placed = [
    { text: 'EXAMPLE INSTITUTE OF TECHNOLOGY', x: 60, y: 670 },
    { text: `CLASS: ${className}`, x: 60, y: 652 },
    { text: `TIME-TABLE (${revision})`, x: 420, y: 652 },
    { text: 'ACADEMIC YEAR: 2026-27', x: 60, y: 634 },
    { text: 'ROOM NO.: B205', x: 700, y: 634 },
    { text: `W.E.F: ${effective}`, x: 700, y: 616 },
    { text: 'DAY/TIME', x: 50, y: 590 },
  ];

  [
    '10:00-10:55am',
    '10:55-11:50am',
    '11:50-12.10pm',
    '12.10-1:05pm',
    '1:05-02:00pm',
    '2:00-03:10pm',
    '03:10-04:05pm',
    '04:05-05:00pm',
  ].forEach((slot, index) => {
    placed.push({ text: slot, x: xs[index], y: 590 });
  });

  const rows = [
    ['MONDAY', monday],
    ['TUESDAY', ['PHYE1/POPE2', null, 'BREAK', 'IDT', 'POP', 'LUNCH', null, null]],
    ['WEDNESDAY', ['ETC', 'ESC', 'BREAK', 'MAT', 'POP', 'LUNCH', null, null]],
    ['THURSDAY', ['PHYE2/POPE1', null, 'BREAK', 'PHY', 'ETC', 'LUNCH', 'MAT LAB(E1+E2)', null]],
    ['FRIDAY', ['ETC', 'MAT', 'BREAK', 'PHY', 'ENG', 'LUNCH', 'ESC', null]],
    ['SATURDAY', ['MAT', 'ICO', 'BREAK', 'PHY', 'ESC', 'LUNCH', null, null]],
  ];

  rows.forEach(([day, cells], index) => {
    const y = 560 - index * 24;
    placed.push({ text: day, x: 50, y });
    cells.forEach((cell, column) => {
      if (cell !== null) placed.push({ text: cell, x: xs[column], y });
    });
  });

  /* The subject table: the ONLY place the grid's initials are defined. */
  [
    ['BQATS101', 'Mathematics-I for CSE Stream', 'MAT', 'Prof. Anita R', '2+2+2', '2+2+2'],
    ['BQHYS102', 'Applied Physics for CSE stream', 'PHY', 'Prof. Bala V', '2+2+2', '2+2+2'],
    ['BQOPS103', 'Principles of Programming', 'POP', 'Prof. Chandra M', '3+0+2', '2+0+2'],
    ['BQSCK104B', 'Introduction to Electrical', 'ESC', 'Prof. Divya K', '4+0+0', '3+0+0'],
    ['BQTCK105I', 'Introduction to Cyber Security', 'ETC', 'Dr. Esha G', '2+0+2', '2+0+2'],
    ['BQNGK106', 'Communicative English', 'ENG', 'Prof. Farid S', '1+0+0', '1+0+0'],
    ['BQCOK107', 'Indian Constitution', 'ICO', 'Adv. Gita D', '1+0+0', '1+0+0'],
    ['BQDTK158', 'Innovation and Design Thinking', 'IDT', 'Prof. Hari C', '1+0+0', '1+0+0'],
  ].forEach((row, index) => {
    placed.push({ text: row.join('  '), x: 60, y: 400 - index * 20 });
  });

  /*
   * LANDSCAPE, because a timetable is. Eight time columns do not fit across a
   * portrait page, and text placed past the MediaBox is not merely off the
   * edge of the design — it is not in the document at all, which is how the
   * first version of this fixture silently lost half its grid.
   */
  return makePdf([placed], { width: 1000, height: 700 });
}

/** An invoice. Not academic at all. */
export function invoicePdf() {
  return makePdf([
    [
      { text: 'ACME SUPPLIES LIMITED', x: 60, y: 700 },
      { text: 'Invoice 4417', x: 60, y: 680 },
      { text: 'Date: 03/06/2026', x: 60, y: 660 },
      { text: 'Amount due: 12,400.00', x: 60, y: 640 },
    ],
  ]);
}

/**
 * A one-page PDF whose only content is a JPEG: a scan, or "print to PDF" from
 * a photo. It carries no text layer, so it must be rendered before it is read.
 *
 * The image is embedded as a `/DCTDecode` XObject, so its bytes go in unaltered
 * and there is no filter to implement here.
 */
export function scannedPdf(jpeg, width, height) {
  const w = String(width);
  const h = String(height);
  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ`;

  const parts = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [5 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h}` +
      ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode` +
      ` /Length ${String(jpeg.length)} >>\nstream\n`,
    '\nendstream\nendobj\n',
    `4 0 obj\n<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]` +
      ` /Resources << /XObject << /Im0 3 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  ];

  /*
   * Assembled as BYTES. The JPEG is binary, and a latin1 round trip through the
   * offset bookkeeping is how an xref table ends up pointing a few bytes past
   * where its object actually starts.
   */
  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];
  const push = (buffer) => {
    chunks.push(buffer);
    offset += buffer.length;
  };

  offsets.push(offset);
  push(Buffer.from(parts[0], 'latin1'));
  offsets.push(offset);
  push(Buffer.from(parts[1], 'latin1'));
  offsets.push(offset);
  push(Buffer.from(parts[2], 'latin1'));
  push(jpeg);
  push(Buffer.from(parts[3], 'latin1'));
  offsets.push(offset);
  push(Buffer.from(parts[4], 'latin1'));
  offsets.push(offset);
  push(Buffer.from(parts[5], 'latin1'));

  const xref = offset;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (const value of offsets) table += `${String(value).padStart(10, '0')} 00000 n \n`;
  table += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`;
  push(Buffer.from(table, 'latin1'));

  return Buffer.concat(chunks);
}

/**
 * Draws an academic calendar IN THE BROWSER and returns a data URL.
 *
 * The picture path for a calendar is the SAME pipeline the result cards use —
 * decode, recognise, classify, parse — so this exists to prove the shared
 * route works end to end, not to test a second OCR engine (M10A.7 §41, §42).
 */
export const DRAW_CALENDAR = ({ academicYear, rows, mime }) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 560;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  const line = (text, x, y, size = 20, weight = '') => {
    ctx.font = `${weight} ${String(size)}px "DejaVu Sans", Arial, sans-serif`.trim();
    ctx.fillText(text, x, y);
  };

  line('VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', 50, 40, 22, 'bold');
  line(`ACADEMIC CALENDAR FOR THE ODD SEMESTER ${academicYear}`, 50, 80, 21);
  line('V SEMESTER B.E.', 50, 118, 20);
  line('Event', 50, 170, 20, 'bold');
  line('Date', 640, 170, 20, 'bold');

  rows.forEach((row, index) => {
    const y = 220 + index * 46;
    line(row[0], 50, y, 20);
    line(row[1], 640, y, 20);
  });

  return canvas.toDataURL(mime ?? 'image/png');
};

/**
 * Draws a result card onto a canvas IN THE BROWSER and returns a data URL.
 *
 * Passed to `page.evaluate`, so it must be self-contained: it closes over
 * nothing and takes everything it needs as one argument.
 */
export const DRAW_CARD = ({ rows, semester, blur, skew, scale, mime }) => {
  const width = Math.round(1000 * scale);
  const height = Math.round(700 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.scale(scale, scale);
  if (skew !== 0) {
    ctx.translate(500, 350);
    ctx.rotate((skew * Math.PI) / 180);
    ctx.translate(-500, -350);
  }
  if (blur > 0) ctx.filter = `blur(${String(blur)}px)`;

  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  const line = (text, x, y, size = 18, weight = '') => {
    ctx.font = `${weight} ${String(size)}px "DejaVu Sans", Arial, sans-serif`.trim();
    ctx.fillText(text, x, y);
  };

  line('VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', 60, 40, 20, 'bold');
  line('VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION', 60, 70);
  line('University Seat Number : 9ZZ99ZZ999', 60, 110);
  line(`Semester : ${semester}`, 60, 140);

  const columns = [60, 210, 560, 660, 760, 850];
  ['Subject Code', 'Subject Name', 'Internal', 'External', 'Total', 'Result'].forEach(
    (heading, index) => {
      line(heading, columns[index], 190, 17, 'bold');
    },
  );

  rows.forEach((row, index) => {
    const y = 230 + index * 44;
    row.forEach((cell, column) => {
      line(cell, columns[column], y, 19);
    });
  });

  return canvas.toDataURL(mime ?? 'image/png');
};
