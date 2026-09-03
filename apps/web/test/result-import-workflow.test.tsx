/**
 * Upload, review, correct, confirm — and only then a saved result.
 *
 * Authority: docs/22 §22.50 · M10A.6 §15, §16, §17, §18, §19, §37
 *
 * The pipeline below is driven through the SCREEN, with the PDF read replaced
 * by a stub. What the extraction layer produces is already proved against a
 * real engine over real generated PDFs in `pdf-text.test.ts`; what this file
 * asks is a different question — whether a student can see what was read,
 * correct it, and end up with an ordinary result record.
 *
 * The assertion that matters most is the negative one: nothing is saved until
 * the confirm button is pressed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import type { ImportLine } from '../src/domain/result-import.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

/* ---------------------------------------------------------------------- */
/* The PDF read, stubbed at the module boundary                            */
/* ---------------------------------------------------------------------- */

const extractions = new Map<string, { lines: ImportLine[]; hasTextLayer: boolean }>();
let failWith: string | null = null;

/*
 * Hoisted so the mock factory and the tests share ONE error class. Throwing a
 * look-alike would fail the component's `instanceof` check and silently take
 * the generic branch — the test would pass for the wrong reason.
 */
const { PdfReadError } = vi.hoisted(() => ({
  PdfReadError: class PdfReadError extends Error {},
}));

vi.mock('../src/lib/pdf-text.js', () => ({
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  PdfReadError,
  extractPdfLines: vi.fn(async () => {
    if (failWith !== null) throw new PdfReadError(failWith);
    const next = [...extractions.values()][0];
    return Promise.resolve({
      lines: next?.lines ?? [],
      pageCount: 1,
      hasTextLayer: next?.hasTextLayer ?? true,
    });
  }),
  renderPdfPage: vi.fn(() => Promise.resolve({ width: 800, height: 1000 })),
}));

/* ---------------------------------------------------------------------- */
/* The recogniser, stubbed at the same boundary                            */
/* ---------------------------------------------------------------------- */

/*
 * What Tesseract does with a picture is not what this file is asking about, and
 * jsdom has no canvas to give it. So the ENGINE is replaced and the pipeline
 * around it is exercised: whether a scan reaches the recogniser at all, whether
 * one worker serves the batch, whether it is closed, and whether the review
 * says plainly that these figures came from a picture.
 *
 * `ocrLines` is what the stub "recognises"; `ocrFailsWith` makes the engine
 * refuse to start, which is a real outcome on a device that cannot fetch it.
 */
let ocrLines: ImportLine[] = [];
let ocrFailsWith: string | null = null;
const ocrCalls = { started: 0, recognised: 0, closed: 0 };

const { OcrError } = vi.hoisted(() => ({ OcrError: class OcrError extends Error {} }));

vi.mock('../src/lib/ocr.js', () => ({
  OcrError,
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  decodeImage: vi.fn(() =>
    Promise.resolve({
      canvas: { width: 800, height: 1000 },
      width: 800,
      height: 1000,
      sourceWidth: 800,
      sourceHeight: 1000,
    }),
  ),
  normalizeContrast: vi.fn(),
  stretchGrey: vi.fn(() => true),
  startOcr: vi.fn(() => {
    if (ocrFailsWith !== null) return Promise.reject(new OcrError(ocrFailsWith));
    ocrCalls.started += 1;
    return Promise.resolve({
      recognize: (_canvas: unknown, page = 1) => {
        ocrCalls.recognised += 1;
        return Promise.resolve({
          lines: ocrLines.map((line) => ({ ...line, page })),
          meanConfidence: 91,
          wordCount: 60,
          lowConfidenceWords: 2,
        });
      },
      close: () => {
        ocrCalls.closed += 1;
        return Promise.resolve();
      },
    });
  }),
}));

const { ResultsPage } = await import('../src/features/results/ResultsPage.js');

/** A synthetic card, as the extraction layer would hand it over. */
function cardLines(semester: number, rows: readonly string[]): ImportLine[] {
  return [
    'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
    'VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION',
    'University Seat Number : 9ZZ99ZZ999',
    `Semester : ${String(semester)}`,
    'Subject Code  Subject Name  Internal Marks  External Marks  Total  Result',
    ...rows,
  ].map((text) => ({ text, page: 1 }));
}

const ROWS = [
  'BQAS401  ALGORITHMS            44  36  80  P  2026-07-23',
  'BQAS402  FINANCIAL MANAGEMENT  40  19  59  P  2026-07-23',
];

function setCard(semester: number, rows: readonly string[] = ROWS) {
  extractions.clear();
  extractions.set('a', { lines: cardLines(semester, rows), hasTextLayer: true });
}

/** Drops a file on the import surface. jsdom needs the list built by hand. */
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  name = 'result.pdf',
  type = 'application/pdf',
) {
  // The panel stays open after a save, so a second import does not reopen it.
  const opener = screen.queryByRole('button', { name: /import a pdf/i });
  if (opener !== null) await user.click(opener);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['%PDF-1.4'], name, { type });
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(8)) });
  /*
   * The list is built by hand and `change` dispatched directly. `user.upload`
   * is deliberately NOT used: it reads `input.files.item()` from inside a jsdom
   * event listener, where a throw becomes an unhandled error no `catch` here
   * can reach — eleven of them per run, drowning any real one.
   */
  const list = {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
    [Symbol.iterator]: function* () {
      yield file;
    },
  };
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  failWith = null;
  ocrLines = [];
  ocrFailsWith = null;
  ocrCalls.started = 0;
  ocrCalls.recognised = 0;
  ocrCalls.closed = 0;
  setCard(4);
});
afterEach(cleanup);

/* ---------------------------------------------------------------------- */

describe('importing one result PDF', () => {
  it('shows what it read, and saves nothing until it is confirmed', async () => {
    /*
     * THE ASSERTION THIS WHOLE SCREEN EXISTS FOR. An extraction that saves on
     * its own is one a student never checks, and the tenth card — the one that
     * was misread — becomes an SGPA they cannot explain.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);

    expect(await screen.findByText(/Semester 4/)).toBeTruthy();
    expect(peek.results()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /confirm and save result/i }));

    expect(peek.results()).toHaveLength(1);
    expect(peek.results()[0]?.semester).toBe(4);
    expect(peek.results()[0]?.subjects).toHaveLength(2);
  });

  it('keeps the printed marks as source values, and invents no grade', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    await user.click(await screen.findByRole('button', { name: /confirm and save result/i }));

    const subject = peek.results()[0]?.subjects[0];
    expect(subject).toMatchObject({ internal: 44, external: 36, total: 80, resultStatus: 'P' });
    // A provisional card prints none of these, so the record carries none.
    expect(subject?.gradeLetter).toBeNull();
    expect(subject?.credits).toBeNull();
  });

  it('shows the line it read beside the fields it produced', async () => {
    // When a reading is wrong this is the only thing that explains why.
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user);
    expect(await screen.findByText(/BQAS401\s+ALGORITHMS/)).toBeTruthy();
  });

  it('lets a misread field be corrected before saving', async () => {
    /*
     * ONE WRONG CELL MUST NOT MEAN ANOTHER UPLOAD (§16). The card here prints a
     * total that does not add up; the student fixes the cell and saves.
     */
    setCard(4, ['BQAS401  ALGORITHMS  44  36  90  P  2026-07-23']);
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    expect(await screen.findByText(/does not match the component marks/i)).toBeTruthy();

    const total = screen.getByLabelText(/total 1/i);
    await user.clear(total);
    await user.type(total, '80');
    await user.click(screen.getByRole('button', { name: /confirm and save result/i }));

    expect(peek.results()[0]?.subjects[0]?.total).toBe(80);
  });

  it('lets a row be removed rather than forcing all of it', async () => {
    // PARTIAL SUCCESS within one card (§33): two rows read, one kept.
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    await user.click(await screen.findByRole('button', { name: /remove row 2/i }));
    await user.click(screen.getByRole('button', { name: /confirm and save result/i }));

    expect(peek.results()[0]?.subjects).toHaveLength(1);
  });
});

describe('a semester the document did not print', () => {
  it('asks rather than guessing, and will not save until answered', async () => {
    const lines = cardLines(4, ROWS).filter((line) => !/^Semester/.test(line.text));
    extractions.clear();
    extractions.set('a', { lines, hasTextLayer: true });

    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user, 'semester4.pdf');

    // The FILENAME says semester 4. That is not evidence (§8).
    expect(await screen.findByText(/semester not detected/i)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /confirm and save result/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await user.selectOptions(screen.getByLabelText(/^semester$/i), '4');
    await user.click(screen.getByRole('button', { name: /confirm and save result/i }));

    expect(peek.results()[0]?.semester).toBe(4);
  });
});

describe('a scan, a photo, and a file that cannot be read', () => {
  it('sends a PDF with no text layer to the recogniser, and says so', async () => {
    /*
     * A PDF whose pages are pictures. Extraction finds nothing, so the pages
     * are rendered and recognised — and the review says the figures came from a
     * picture, because presenting them like extracted text would imply the two
     * are equally reliable.
     */
    extractions.clear();
    extractions.set('a', { lines: [], hasTextLayer: false });
    ocrLines = cardLines(4, ROWS);

    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user, 'scan.pdf');

    expect(await screen.findByText(/check every mark against the card/i)).toBeTruthy();
    expect(await screen.findByText(/rows read from a picture/i)).toBeTruthy();
    expect(ocrCalls.recognised).toBe(1);
    // Still nothing saved. Recognition changes where the figures came from, not
    // whether a person has to confirm them.
    expect(peek.results()).toHaveLength(0);
  });

  it('reads a photograph of a card', async () => {
    ocrLines = cardLines(4, ROWS);

    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user, 'card.jpg', 'image/jpeg');

    expect(await screen.findByText(/check every mark against the card/i)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /confirm and save result/i }));

    const saved = peek.results();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.subjects.map((subject) => subject.subjectCode)).toEqual([
      'BQAS401',
      'BQAS402',
    ]);
  });

  it('starts one engine for a batch and closes it when the panel does', async () => {
    /*
     * ONE WORKER. A worker per file would put several copies of a 3.7MB engine
     * and a 2.8MB model in memory at once, which on a phone kills the tab.
     */
    ocrLines = cardLines(4, ROWS);

    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user, 'one.jpg', 'image/jpeg');
    await choose(user, 'two.jpg', 'image/jpeg');
    await screen.findAllByText(/rows read from a picture/i);

    expect(ocrCalls.started).toBe(1);
    expect(ocrCalls.recognised).toBe(2);

    await user.click(screen.getByRole('button', { name: /^done$|^cancel$/i }));
    expect(ocrCalls.closed).toBeGreaterThan(0);
  });

  it('says the recogniser could not start, and offers manual entry', async () => {
    // A device that cannot fetch the engine. An honest limit beats a spinner.
    ocrFailsWith = 'The text recogniser could not start. You can still enter this result by hand.';

    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user, 'card.png', 'image/png');

    expect(await screen.findByText(/could not start/i)).toBeTruthy();
    expect(peek.results()).toHaveLength(0);
  });

  it('refuses a file that is neither a PDF nor a picture', async () => {
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user, 'marks.docx', 'application/vnd.openxmlformats');
    expect(await screen.findByText(/reads PDFs and photos/i)).toBeTruthy();
  });

  it('reports a corrupt file with a message, not a stack', async () => {
    failWith = 'This file could not be opened as a PDF.';
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user, 'broken.pdf');
    expect(await screen.findByText(/could not be opened as a PDF/i)).toBeTruthy();
  });
});

describe('a semester that already has a result', () => {
  it('is blocked rather than silently replaced', async () => {
    /*
     * ONE SAVED RESULT PER SEMESTER is the existing invariant, and an import
     * must not be the way around it (§18).
     */
    const user = userEvent.setup();
    const { bundle } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    await user.click(await screen.findByRole('button', { name: /confirm and save result/i }));

    // The same card again.
    await choose(user);
    expect(await screen.findByText(/already has a saved result/i)).toBeTruthy();
  });
});

describe('the filename', () => {
  it('is shown as text and used for nothing else', async () => {
    // Not identity, not a path, not semester evidence (§22).
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user, '<script>alert(1)</script>.pdf');
    const list = await screen.findByText(/<script>alert\(1\)<\/script>\.pdf/);
    expect(list.textContent).toContain('<script>');
    // Rendered as text: no element was created from it.
    expect(document.querySelector('script')).toBeNull();
  });
});
