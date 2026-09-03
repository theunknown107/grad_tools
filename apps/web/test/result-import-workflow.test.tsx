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
async function choose(user: ReturnType<typeof userEvent.setup>, name = 'result.pdf') {
  // The panel stays open after a save, so a second import does not reopen it.
  const opener = screen.queryByRole('button', { name: /import a pdf/i });
  if (opener !== null) await user.click(opener);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['%PDF-1.4'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(8)) });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await user.upload(input, file).catch(() => undefined);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  failWith = null;
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

describe('a file that cannot be read', () => {
  it('reports a scan instead of saving an empty result', async () => {
    extractions.clear();
    extractions.set('a', { lines: [], hasTextLayer: false });

    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await choose(user, 'scan.pdf');

    expect(await screen.findByText(/no selectable text/i)).toBeTruthy();
    expect(peek.results()).toHaveLength(0);
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
