/**
 * Which reader a dropped file gets, and what the reading says about itself.
 *
 * Authority: docs/22 §22.53 · M10A.6B §11, §15, §16, §17, §37
 *
 * ---------------------------------------------------------------------------
 * THE DECISION THIS FILE GUARDS
 * ---------------------------------------------------------------------------
 *
 * A PDF that carries a text layer already holds the exact characters the
 * university printed. Rendering it to a picture and recognising that picture
 * would swap certainty for a guess — silently, and with plausible-looking
 * output. So OCR must be reached ONLY when extraction comes back with nothing,
 * and a regression in that order would cost accuracy nobody would notice.
 *
 * The engine itself is stubbed. What Tesseract does with a bitmap is not the
 * question here, and jsdom has no canvas to give it.
 *
 * Every value is synthetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportLine } from '../src/domain/result-import.js';
import type { OcrPageResult } from '../src/domain/ocr-layout.js';

const state = {
  lines: [] as ImportLine[],
  hasTextLayer: true,
  pageCount: 1,
  rendered: [] as number[],
};

/*
 * A canvas stand-in whose `getContext` yields nothing. jsdom has no 2D context,
 * and a reading pipeline that cannot copy the pixels back falls to ONE pass —
 * which is what these tests are about. The two-pass choice is a pure function,
 * `betterReading`, and is tested as one below.
 */
const { fakeCanvas } = vi.hoisted(() => ({
  fakeCanvas: () =>
    ({ width: 800, height: 1000, getContext: () => null }) as unknown as HTMLCanvasElement,
}));

const { PdfReadError } = vi.hoisted(() => ({ PdfReadError: class PdfReadError extends Error {} }));
const { OcrError } = vi.hoisted(() => ({ OcrError: class OcrError extends Error {} }));

vi.mock('../src/lib/pdf-text.js', () => ({
  PdfReadError,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  extractPdfLines: vi.fn(() =>
    Promise.resolve({
      lines: state.lines,
      placed: [],
      pageCount: state.pageCount,
      hasTextLayer: state.hasTextLayer,
    }),
  ),
  renderPdfPage: vi.fn((_data: ArrayBuffer, page: number) => {
    state.rendered.push(page);
    return Promise.resolve(fakeCanvas());
  }),
}));

vi.mock('../src/lib/ocr.js', () => ({
  OcrError,
  decodeImage: vi.fn(() =>
    Promise.resolve({
      canvas: fakeCanvas(),
      width: 800,
      height: 1000,
      sourceWidth: 1600,
      sourceHeight: 2000,
    }),
  ),
  normalizeContrast: vi.fn(),
}));

const { betterReading, fileKind, readHtmlFile, readImageFile, readPdfFile, MAX_OCR_PAGES } =
  await import('../src/lib/result-file.js');
const { parseResultCard } = await import('../src/domain/result-import.js');

/** An OCR page result, as the engine would report one. */
function page(
  lines: readonly string[],
  { confidence = 90, words = 60, doubtful = 0 } = {},
): OcrPageResult {
  return {
    lines: lines.map((text) => ({ text, page: 1 })),
    placed: [],
    meanConfidence: confidence,
    wordCount: words,
    lowConfidenceWords: doubtful,
  };
}

const CARD = [
  'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
  'Semester : 4',
  'BQAS401  ALGORITHMS  44  36  80  P',
];

const recognizer = (result: OcrPageResult) => vi.fn(() => Promise.resolve(result));

beforeEach(() => {
  state.lines = [];
  state.hasTextLayer = true;
  state.pageCount = 1;
  state.rendered = [];
});

describe('choosing a reader', () => {
  it('takes the declared type first', () => {
    expect(fileKind(new File([''], 'a.pdf', { type: 'application/pdf' }))).toBe('pdf');
    expect(fileKind(new File([''], 'a.jpg', { type: 'image/jpeg' }))).toBe('image');
    expect(fileKind(new File([''], 'a.png', { type: 'image/png' }))).toBe('image');
  });

  it('falls back to the extension when a picker gives no type', () => {
    /*
     * Some Android pickers hand over an empty type. The extension chooses a
     * DECODER and nothing else — what the file actually contains is settled by
     * the decoder, which fails honestly on a mislabelled file.
     */
    expect(fileKind(new File([''], 'card.JPEG', { type: '' }))).toBe('image');
    expect(fileKind(new File([''], 'card.pdf', { type: '' }))).toBe('pdf');
    expect(fileKind(new File([''], 'notes.txt', { type: '' }))).toBe('unsupported');
    expect(fileKind(new File([''], 'Result.HTM', { type: '' }))).toBe('html');
  });

  it('reads a saved web page as HTML', () => {
    expect(fileKind(new File([''], 'result.html', { type: 'text/html' }))).toBe('html');
  });

  it('refuses anything else rather than guessing', () => {
    const doc = new File([''], 'marks.docx', { type: 'application/msword' });
    expect(fileKind(doc)).toBe('unsupported');
  });
});

describe('a PDF that has its own text', () => {
  it('is never recognised, however available the engine is', async () => {
    /*
     * THE POINT OF THE FILE. Extraction yields the printed characters; OCR
     * yields a reading of a picture of them. Preferring the second would lose
     * accuracy invisibly.
     */
    state.lines = CARD.map((text) => ({ text, page: 1 }));
    const recognize = recognizer(page(['nonsense']));

    const reading = await readPdfFile(new ArrayBuffer(8), recognize);

    expect(reading.source).toBe('text');
    expect(reading.lines.map((line) => line.text)).toEqual(CARD);
    expect(recognize).not.toHaveBeenCalled();
    expect(state.rendered).toEqual([]);
  });

  it('reports no confidence, because confidence is an OCR idea', async () => {
    state.lines = CARD.map((text) => ({ text, page: 1 }));
    const reading = await readPdfFile(new ArrayBuffer(8), null);
    expect(reading.meanConfidence).toBeNull();
    expect(reading.lowConfidenceWords).toBe(0);
  });
});

describe('a PDF that is a scan', () => {
  it('is rendered and recognised, page by page', async () => {
    state.hasTextLayer = false;
    state.pageCount = 2;
    const recognize = recognizer(page(CARD));

    const reading = await readPdfFile(new ArrayBuffer(8), recognize);

    expect(state.rendered).toEqual([1, 2]);
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(reading.source).toBe('ocr');
    expect(reading.pageCount).toBe(2);
  });

  it('says so plainly when there is no recogniser to hand', async () => {
    /*
     * A device that cannot run OCR gets a sentence it can act on, not an empty
     * result that reads like a parse failure.
     */
    state.hasTextLayer = false;
    await expect(readPdfFile(new ArrayBuffer(8), null)).rejects.toThrow(/no selectable text/i);
  });

  it('refuses a scan longer than a result card could be', async () => {
    /*
     * Recognition costs seconds per page on a phone. Grinding through twenty
     * pages would look like a hang, and twenty pages is not a result card.
     */
    state.hasTextLayer = false;
    state.pageCount = MAX_OCR_PAGES + 1;
    const recognize = recognizer(page(CARD));

    await expect(readPdfFile(new ArrayBuffer(8), recognize)).rejects.toThrow(/scanned pages/i);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('refuses a scan that produced nothing worth reviewing', async () => {
    /*
     * A photograph of a wall, or a card too blurred to read. Presenting its
     * output as a result manufactures rows a student then has to disprove.
     */
    state.hasTextLayer = false;
    const recognize = recognizer(page(['sdf'], { confidence: 20, words: 3 }));

    await expect(readPdfFile(new ArrayBuffer(8), recognize)).rejects.toThrow(/could not be made/i);
  });
});

describe('a photograph', () => {
  it('is recognised, and says it was', async () => {
    const recognize = recognizer(page(CARD, { doubtful: 3 }));
    const reading = await readImageFile(
      new File([''], 'card.jpg', { type: 'image/jpeg' }),
      recognize,
    );

    expect(reading.source).toBe('ocr');
    expect(reading.lines.map((line) => line.text)).toEqual(CARD);
    expect(reading.lowConfidenceWords).toBe(3);
  });

  it('is refused when it yields only junk', async () => {
    const recognize = recognizer(page(['##', 'sdf'], { confidence: 18, words: 4 }));
    await expect(
      readImageFile(new File([''], 'wall.jpg', { type: 'image/jpeg' }), recognize),
    ).rejects.toThrow(/could not be made/i);
  });
});

describe('the confidence summary', () => {
  it('weights pages by how much text they held', async () => {
    /*
     * A page with three words must not drag the mean about as much as a full
     * one. The number is a REASON TO LOOK; an unweighted average would make it
     * a misleading one.
     */
    state.hasTextLayer = false;
    state.pageCount = 2;
    const results = [
      page(CARD, { confidence: 90, words: 90, doubtful: 1 }),
      page(['x'], { confidence: 30, words: 10, doubtful: 4 }),
    ];
    let call = 0;
    const recognize = vi.fn(() => Promise.resolve(results[call++] as OcrPageResult));

    const reading = await readPdfFile(new ArrayBuffer(8), recognize);

    // (90*90 + 30*10) / 100
    expect(reading.meanConfidence).toBeCloseTo(84, 5);
    expect(reading.lowConfidenceWords).toBe(5);
  });
});

describe('choosing between two readings of the same page', () => {
  /**
   * Preprocessing is not a setting that can be chosen in advance.
   *
   * Measured on two genuine VTU result cards: a dim phone screenshot went from
   * 53 words raw to 187 with the contrast stretch, and from one readable row to
   * seven — without the stretch it is unusable. A sharper screenshot carrying
   * the university's diagonal watermark went the OTHER way: raw, all nine rows
   * with their marks; stretched, the marks gone from six of them.
   *
   * No statistic separates them — the card that NEEDS the stretch has the wider
   * dynamic range of the pair. So the choice is measured, not predicted.
   */
  const reading = (lines: readonly string[], words: number, confidence: number): OcrPageResult => ({
    lines: lines.map((text) => ({ text, page: 1 })),
    placed: [],
    meanConfidence: confidence,
    wordCount: words,
    lowConfidenceWords: 0,
  });

  const ROW = (code: string) => `${code} SUBJECT 44 36 80 P 2026-07-23`;

  it('keeps the reading that yields more importable rows', () => {
    const few = reading([ROW('BQAS401')], 60, 95);
    const many = reading([ROW('BQAS401'), ROW('BQAS402'), ROW('BQAS403')], 40, 70);
    expect(betterReading(few, many)).toBe(many);
    expect(betterReading(many, few)).toBe(many);
  });

  it('ignores confidence, because the confident reading lost the marks', () => {
    /*
     * THE EXACT REAL FAILURE. On the watermarked card the stretched pass was
     * the MORE confident of the two and its digits had vanished: a page can be
     * sure of a heading while losing every mark under a watermark.
     */
    const confidentAndEmpty = reading(['VTU PROVISIONAL RESULTS'], 80, 96);
    const unsureWithRows = reading([ROW('BQAS401'), ROW('BQAS402')], 50, 61);
    expect(betterReading(confidentAndEmpty, unsureWithRows)).toBe(unsureWithRows);
  });

  it('breaks a tie on rows by preferring fewer rows it could not read', () => {
    const clean = reading([ROW('BQAS401')], 40, 90);
    const lossy = reading([ROW('BQAS401'), 'BQAS402 FINANCIAL 19 2026-07-'], 40, 90);
    expect(betterReading(lossy, clean)).toBe(clean);
  });

  it('breaks a remaining tie on how much text was found', () => {
    const thin = reading([ROW('BQAS401')], 30, 90);
    const full = reading([ROW('BQAS401')], 90, 90);
    expect(betterReading(thin, full)).toBe(full);
  });

  it('keeps the first reading when neither is better', () => {
    // Stable by design: the first pass is the stretched one, which is what
    // rescues the dim screenshots.
    const first = reading([ROW('BQAS401')], 50, 90);
    const second = reading([ROW('BQAS401')], 50, 99);
    expect(betterReading(first, second)).toBe(first);
  });
});

/* ---------------------------------------------------------------------- */
/* A result page saved from the browser (Save page as → HTML)              */
/* ---------------------------------------------------------------------- */

/*
 * The provisional-result page's structure, synthetically filled: the student
 * block is a two-column <table>, the marks are `divTableRow` / `divTableCell`
 * divs, and the page carries its own scripts. No real student data.
 */
function vtuPage(rows: readonly (readonly string[])[], extra = ''): string {
  const cells = (row: readonly string[]) =>
    `<div class="divTableRow">${row.map((cell) => `<div class="divTableCell">${cell}</div>`).join('')}</div>`;
  return `<!DOCTYPE html><html><head><title>VTU Results</title>
<script>window.__ranHead = true;</script><style>.x{color:red}</style></head>
<body><nav><a href="/">Home</a></nav>
<div class="container"><div class="panel-body">
<b>VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION</b>
<table><tr><td><b>University Seat Number </b></td><td><b> : 1XX22CS001</b></td></tr>
<tr><td><b>Student Name</b></td><td><b> : SYNTHETIC STUDENT</b></td></tr></table>
<div style="text-align:center;padding:5px;"><b>Semester : 4</b></div>
<div class="divTable"><div class="divTableBody">
${cells(['<b>Subject Code</b>', '<b>Subject Name</b>', '<b>Internal Marks</b>', '<b>External Marks</b>', '<b>Total</b>', '<b>Result</b>', '<b>Announced / Updated on</b>'])}
${rows.map(cells).join(' ')}
</div></div>
<div>P -&gt; PASS, F -&gt; FAIL, A -&gt; ABSENT</div>
${extra}
</div></div></body></html>`;
}

const htmlFile = (html: string) => new File([html], 'result.html', { type: 'text/html' });

describe('a saved result page', () => {
  it('reads each table row as one line, in the shape the card parser reads', async () => {
    const reading = await readHtmlFile(
      htmlFile(
        vtuPage([
          ['BQAS401 ', 'ALGORITHMS &amp; DATA', '44', '36', '80', 'P', '2026-07-23'],
          ['BQAS402', 'FINANCIAL MANAGEMENT', '40', '12', '52', 'F', '2026-07-23'],
        ]),
      ),
    );
    const text = reading.lines.map((line) => line.text);

    expect(text).toContain('University Seat Number : 1XX22CS001');
    expect(text).toContain('Semester : 4');
    expect(text).toContain('BQAS401 ALGORITHMS & DATA 44 36 80 P 2026-07-23');
    expect(reading).toMatchObject({ source: 'text', pageCount: 1, meanConfidence: null });

    const card = parseResultCard(reading.lines);
    expect(card).toMatchObject({
      semester: 4,
      seatNumber: '1XX22CS001',
      looksLikeResultCard: true,
    });
    expect(card.rows.map((row) => [row.subjectCode, row.total, row.resultStatus])).toEqual([
      ['BQAS401', 80, 'P'],
      ['BQAS402', 52, 'F'],
    ]);
  });

  it('never runs the page: scripts and handlers are inert, and their text is not read', async () => {
    const hits = globalThis as { __ranHead?: boolean; __ranBody?: boolean; __ranHandler?: boolean };
    const reading = await readHtmlFile(
      htmlFile(
        vtuPage(
          [['BQAS401', 'ALGORITHMS', '44', '36', '80', 'P', '2026-07-23']],
          `<script>window.__ranBody = true; document.body.innerHTML = ''; throw new Error('ran');</script>
<img src="x.png" onerror="window.__ranHandler = true"><iframe srcdoc="<p>framed</p>"></iframe>`,
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(hits.__ranHead).toBeUndefined();
    expect(hits.__ranBody).toBeUndefined();
    expect(hits.__ranHandler).toBeUndefined();
    const all = reading.lines.map((line) => line.text).join(' ');
    expect(all).not.toMatch(/__ran|throw|framed|color:red/);
    expect(parseResultCard(reading.lines).rows).toHaveLength(1);
  });

  it('has the headings of a result page but no rows, and is therefore not a result card', async () => {
    const reading = await readHtmlFile(htmlFile(vtuPage([])));
    const card = parseResultCard(reading.lines);
    expect(card.rows).toEqual([]);
    expect(card.looksLikeResultCard).toBe(false);
  });

  it('refuses a file far too large to be a result page, before reading it', async () => {
    const huge = htmlFile('x');
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 });
    await expect(readHtmlFile(huge)).rejects.toThrow(/too large/i);
  });
});
