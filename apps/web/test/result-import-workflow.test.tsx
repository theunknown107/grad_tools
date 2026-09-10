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
import { screen, waitFor } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import type { ImportLine } from '../src/domain/result-import.js';
import type { PlacedText } from '../src/lib/pdf-text.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

/* ---------------------------------------------------------------------- */
/* The PDF read, stubbed at the module boundary                            */
/* ---------------------------------------------------------------------- */

const extractions = new Map<
  string,
  { lines: ImportLine[]; hasTextLayer: boolean; placed?: PlacedText[] }
>();
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
      /*
       * A scheme is read from POSITIONS, not lines — its credits column is
       * identified by where it sits — so the stub has to be able to hand back
       * placed text as well.
       */
      placed: next?.placed ?? [],
      pageCount: 1,
      hasTextLayer: next?.hasTextLayer ?? true,
    });
  }),
  renderPdfPage: vi.fn(() => Promise.resolve({ width: 800, height: 1000, getContext: () => null })),
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
      canvas: { width: 800, height: 1000, getContext: () => null },
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
          /* Boxes are what a grid needs; these tests are about lists. */
          placed: [],
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
/**
 * Opens a course row onto its fields.
 *
 * The review reads before it edits — the approved design makes a course a line
 * until it is asked to be a form — so a test that reaches for a field opens the
 * row first, the way a person does. A row that needs an ANSWER is already open
 * and has no toggle, which is why this looks for a collapsed one.
 */
async function openRow(user: ReturnType<typeof userEvent.setup>, index = 0) {
  /* The document is still being read when this is called; wait for the row. */
  await waitFor(() => {
    expect(document.querySelectorAll('button[aria-expanded="false"]').length).toBeGreaterThan(
      index,
    );
  });
  const toggle = document.querySelectorAll('button[aria-expanded="false"]')[index];
  await user.click(toggle as HTMLElement);
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  name = 'result.pdf',
  type = 'application/pdf',
) {
  // The panel stays open after a save, so a second import does not reopen it.
  const opener = screen.queryByRole('button', { name: /add academic document/i });
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

    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

    expect(peek.results()).toHaveLength(1);
    expect(peek.results()[0]?.semester).toBe(4);
    expect(peek.results()[0]?.subjects).toHaveLength(2);
  });

  it('keeps the printed marks as source values, and invents no grade', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    await user.click(await screen.findByRole('button', { name: /confirm and save/i }));

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
    await openRow(user);
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
    await openRow(user);
    expect(await screen.findByText(/does not match the component marks/i)).toBeTruthy();

    const total = screen.getByLabelText(/total 1/i);
    await user.clear(total);
    await user.type(total, '80');
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

    expect(peek.results()[0]?.subjects[0]?.total).toBe(80);
  });

  it('lets a row be removed rather than forcing all of it', async () => {
    // PARTIAL SUCCESS within one card (§33): two rows read, one kept.
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    await openRow(user, 1);
    await user.click(await screen.findByRole('button', { name: /remove row 2/i }));
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

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
      (screen.getByRole('button', { name: /confirm and save/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.selectOptions(screen.getByLabelText(/^semester$/i), '4');
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

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
    await user.click(await screen.findByRole('button', { name: /confirm and save/i }));

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

  it('refuses a file that is neither a PDF nor a picture, and names it', async () => {
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user, 'marks.docx', 'application/vnd.openxmlformats');

    /*
     * The refusal moved EARLIER and got more specific.
     *
     * It used to come out of `read()` after the file had been handed to the
     * pipeline, and said "GradTools reads PDFs and photos" — true, and no help
     * to somebody who dropped four files and cannot tell which one it means.
     * `FileDropzone` now checks the kind before the pipeline sees it, which is
     * the validation step the workflow always claimed to have, and names the
     * offending file.
     */
    const message = await screen.findByText(/marks\.docx/i);
    expect(message.textContent).toMatch(/PDF, JPEG, PNG, WebP/i);
    // And it says what to do about the commonest case, rather than only "no".
    expect(message.textContent).toMatch(/saved as a PDF/i);
  });

  it('reports a corrupt file with a message, not a stack', async () => {
    failWith = 'This file could not be opened as a PDF.';
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user, 'broken.pdf');
    expect(await screen.findByText(/could not be opened as a PDF/i)).toBeTruthy();
  });
});

describe('the one question a result card cannot answer', () => {
  it('asks about a final exam only for the row that needs it', async () => {
    /*
     * "ASK ONLY WHEN NECESSARY", tested as a negative as much as a positive.
     *
     * A zero external reads identically as "this course has no final exam" and
     * "sat it and scored nothing" (DEC-037), and those have opposite outcomes —
     * so that row genuinely needs a person. A row with marks in the exam does
     * not: the marks prove the exam happened. Asking about both would make the
     * question noise, and noise is what gets clicked through.
     */
    const user = userEvent.setup();
    setCard(4, [
      'BQAS401  ALGORITHMS            44  36  80  P  2026-07-23',
      'BQAS459  MANDATORY COURSE      96   0  96  P  2026-07-23',
    ]);
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });
    await choose(user);

    expect(await screen.findByText(/Semester 4/)).toBeTruthy();
    const asked = screen.getAllByLabelText(/^final exam/i);
    expect(asked).toHaveLength(1);
  });

  it('carries the answer into the saved record', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    setCard(4, ['BQAS459  MANDATORY COURSE  96  0  96  P  2026-07-23']);
    renderWith(<ResultsPage />, { repositories: bundle });
    await choose(user);

    await screen.findByText(/Semester 4/);
    await user.selectOptions(screen.getByLabelText(/^final exam/i), 'no');
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

    // Answered, so the row is no longer unknown and the semester can be graded.
    expect(peek.results()[0]?.subjects[0]?.hasSee).toBe(false);
  });

  it('leaves the row unknown when the student does not know either', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    setCard(4, ['BQAS459  MANDATORY COURSE  96  0  96  P  2026-07-23']);
    renderWith(<ResultsPage />, { repositories: bundle });
    await choose(user);

    await screen.findByText(/Semester 4/);
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

    // "Not sure" is a real answer and must stay null rather than defaulting to
    // true, which would report a backlog the university never gave.
    expect(peek.results()[0]?.subjects[0]?.hasSee).toBeNull();
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
    await user.click(await screen.findByRole('button', { name: /confirm and save/i }));

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

/* -------------------------------------------------------------------------- */
/* What happens after Confirm                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The reported symptom was "Done freezes". It did not freeze — it finished
 * invisibly. The review stayed fully rendered with the button swapped for a
 * 24px "Saved" pill at the foot of a long form, so the screen after a
 * successful import looked exactly like the screen before it.
 *
 * Worse, `setDone(true)` ran SYNCHRONOUSLY, before the write, and the panel
 * above called `void saveResult(result)` — so the pill appeared whether or not
 * anything reached storage, and a rejected write was swallowed entirely.
 */
describe('confirming an import', () => {
  it('says so, unmistakably, and leaves the review', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    await screen.findByText(/Semester 4/);
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

    expect(await screen.findAllByText(/Data confirmed and recorded/i)).not.toHaveLength(0);
    expect(peek.results()).toHaveLength(1);

    // And the review is gone, rather than sitting there looking unfinished.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /confirm and save/i })).toBeNull(),
    );
  });

  it('offers the way on to the saved record', async () => {
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user);
    await screen.findByText(/Semester 4/);
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

    expect(await screen.findByRole('link', { name: /view results/i })).toBeTruthy();
  });

  it('keeps the review, and everything typed into it, when the write fails', async () => {
    /*
     * THE ONE THING A STUDENT CANNOT GET BACK is the work of reviewing. A
     * failed write used to show "Saved" anyway, because the rejection went into
     * a `void` — the record looked stored, was only in memory, and vanished on
     * the next reload.
     */
    const user = userEvent.setup();
    const { bundle } = createMemoryRepositories();
    const failing = {
      ...bundle,
      results: {
        ...bundle.results,
        upsert: () => Promise.reject(new Error('the disk is full')),
      },
    };
    renderWith(<ResultsPage />, { repositories: failing });

    await choose(user);
    await screen.findByText(/Semester 4/);
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));

    expect(await screen.findByText(/could not be recorded/i)).toBeTruthy();
    expect(screen.getByText(/the disk is full/i)).toBeTruthy();
    // The button is back, so it can be retried, and the rows are still there —
    // with everything typed into them, which is what a row opened onto its
    // fields proves.
    expect(screen.getByRole('button', { name: /confirm and save/i })).toBeTruthy();
    await openRow(user);
    expect(screen.getByLabelText(/^Subject code 1$/i)).toBeTruthy();
  });

  it('records one semester however many times Confirm is pressed', async () => {
    /*
     * Disabling the button is not enough on its own: the disable only lands on
     * the render AFTER the first click, so a double click, a held Enter or an
     * impatient retry can all get two writes in first.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user);
    await screen.findByText(/Semester 4/);

    const confirmButton = screen.getByRole('button', { name: /confirm and save/i });
    await user.tripleClick(confirmButton);
    await screen.findAllByText(/Data confirmed and recorded/i);

    expect(peek.results()).toHaveLength(1);
    expect(peek.results().filter((entry) => entry.semester === 4)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The scheme of teaching, which carries the credits                          */
/* -------------------------------------------------------------------------- */

/**
 * THE DOCUMENT THAT UNBLOCKS EVERY OTHER FIGURE.
 *
 * A result card prints no credits and SGPA is credit-weighted, so on a device
 * that has never reached the reference API a card can never be graded. That
 * was the reported bug in one line: four imported semesters, no SGPA, no
 * CGPA, and an analytics page that said "no figures yet".
 *
 * The fixture reproduces the LAYOUT of a scheme — the credits set on their own
 * baseline in the rightmost column — with invented codes. The real document is
 * not in the repository (Phase 7C §7).
 */
describe('importing a scheme of teaching', () => {
  const place = (text: string, x: number, y: number): PlacedText => ({
    text,
    x,
    y,
    width: text.length * 5,
    height: 11,
    page: 1,
  });

  const SCHEME_LINES: ImportLine[] = [
    { text: 'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', page: 1 },
    { text: 'Scheme of Teaching and Examinations 2022', page: 1 },
    { text: 'Outcome Based Education (OBE) and Choice Based Credit System (CBCS)', page: 1 },
    { text: 'Sl. No Course Code Course Title Teaching Hours /Week Credits', page: 1 },
    { text: 'IV SEMESTER', page: 1 },
  ];

  const schemeRow = (y: number, code: string, title: string, credits: number): PlacedText[] => [
    place(code, 140, y),
    place(title, 195, y),
    place('TD:CB', 423, y + 7),
    place('100', 750, y + 6),
    place(String(credits), 789, y + 6),
    place('3', 493, y),
    place('0', 526, y),
    place('0', 559, y),
    place('03', 632, y),
    place('50', 670, y),
    place('50', 711, y),
  ];

  beforeEach(() => {
    extractions.clear();
    extractions.set('a', {
      lines: SCHEME_LINES,
      hasTextLayer: true,
      placed: [
        place('B.E. in Invented Studies', 313, 491),
        place('Scheme of Teaching and Examinations 2022', 319, 477),
        place('IV SEMESTER', 56, 435),
        ...schemeRow(322, 'BQQ401', 'Invented Course One', 4),
        ...schemeRow(298, 'BQQ402', 'Invented Course Two', 3),
      ],
    });
  });

  it('routes to the scheme review rather than to the result parser', async () => {
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user, 'scheme.pdf');

    expect(await screen.findByText(/Scheme of teaching/i)).toBeTruthy();
    expect(screen.getByText('Invented Course One')).toBeTruthy();
    expect(screen.getByText(/4 credits/)).toBeTruthy();
    // Nothing is saved before the confirm, here as everywhere.
    expect(screen.getByRole('button', { name: /confirm and save these credits/i })).toBeTruthy();
  });

  it('records the credits as the catalogue’s, and says so unmistakably', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user, 'scheme.pdf');
    await screen.findByText(/Scheme of teaching/i);
    await user.click(screen.getByRole('button', { name: /confirm and save these credits/i }));

    expect(await screen.findAllByText(/Data confirmed and recorded/i)).not.toHaveLength(0);
    await waitFor(() => expect(peek.schemeCourses()).toHaveLength(2));
    expect(peek.schemeCourses().map((course) => [course.code, course.credits])).toEqual([
      ['BQQ401', 4],
      ['BQQ402', 3],
    ]);
  });

  it('does not save the same scheme twice when Confirm is pressed twice', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user, 'scheme.pdf');
    await screen.findByText(/Scheme of teaching/i);
    await user.dblClick(screen.getByRole('button', { name: /confirm and save these credits/i }));
    await screen.findAllByText(/Data confirmed and recorded/i);

    await waitFor(() => expect(peek.schemeCourses()).toHaveLength(2));
  });
});

/* -------------------------------------------------------------------------- */
/* The screens follow the save, with no reload                                */
/* -------------------------------------------------------------------------- */

/**
 * PHASE 7C §19. A student who imports a result and then has to reload the
 * browser to see it has, from where they are sitting, imported nothing.
 *
 * The derived academic state is memoised on the three collections, and
 * `useCollection` updates those optimistically before awaiting storage — so
 * the figures recompute on the same render pass as the save. This asserts that
 * end to end, through the screen, with nothing remounted in between.
 */
describe('after a save, the figures follow', () => {
  it('recomputes the overview without a reload', async () => {
    const user = userEvent.setup();
    setCard(4);
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    // BEFORE. Nothing saved, so there is no overview to carry a CGPA at all.
    await screen.findByRole('button', { name: /add academic document/i });
    expect(screen.queryByText('CGPA')).toBeNull();

    await choose(user);
    await screen.findByText(/Semester 4/);
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));
    expect(await screen.findAllByText(/Data confirmed and recorded/i)).not.toHaveLength(0);

    /*
     * Done closes the panel. This is the control the student presses after an
     * import, and its own behaviour is part of what is being asserted: the
     * page behind it must already be up to date when it reappears.
     */
    await user.click(screen.getByRole('button', { name: /^Done$/ }));

    /*
     * AFTER. The overview — the default view — carries a real CGPA. Nothing
     * was remounted in between, which matters because a remount is exactly
     * what a browser reload does.
     */
    /*
     * The overview is there, and carries the figures this card supports. The
     * CGPA is NOT among them — the fixture's rows have no credits, so it says
     * "Unavailable" with its reason, which is the correct answer and not an
     * empty screen (§4, §5).
     */
    const passed = await screen.findByText('Passed');
    expect(passed.closest('div')?.textContent ?? '').toMatch(/2/);
    expect(screen.getByText('CGPA').closest('div')?.textContent ?? '').toMatch(/Unavailable/);
  });

  it('leaves the other figures standing when the CGPA cannot be computed', async () => {
    /*
     * §4 asserted through the screen. The card's rows carry no credits, so no
     * SGPA and no CGPA exist — and the subject count, the pass count and the
     * semester list must all survive that, because none of them needed either.
     */
    const user = userEvent.setup();
    setCard(4);
    renderWith(<ResultsPage />, { repositories: createMemoryRepositories().bundle });

    await choose(user);
    await screen.findByText(/Semester 4/);
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));
    expect(await screen.findAllByText(/Data confirmed and recorded/i)).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^Done$/ }));

    const subjects = await screen.findByText('Subjects');
    expect(subjects.closest('div')?.textContent ?? '').toMatch(/2/);
    // "Semesters" is also the tab's own label, so the metric is taken by role.
    expect(screen.getByRole('tab', { name: /semesters/i })).toBeTruthy();
  });
});
