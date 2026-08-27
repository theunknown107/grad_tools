/**
 * Synthetic TSV fixtures.
 *
 * Authority: docs/22 §22.9 · M5A.4 §16 · M5A.5 §17
 *
 * Built here rather than captured from real output, so every positional test is
 * deterministic and needs neither a PDF, an OCR engine, nor the paper corpus —
 * which is not in the repository and never will be.
 *
 * The fixtures reproduce the two real formats faithfully enough to exercise the
 * geometry: a two-column descriptive paper with a right-hand `marks | L | CO`
 * table, and a single-column MCQ flow. They also reproduce the two tools'
 * DISAGREEMENTS — poppler's `par_num, block_num` order and marker rows against
 * Tesseract's `block_num, par_num` — because those differences are what
 * `geometry.ts` exists to absorb.
 */

export interface Word {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly conf?: number;
  readonly page?: number | undefined;
}

/** Tesseract's column order: block before par. */
export function ocrTsv(words: readonly Word[]): string {
  const header =
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = words.map((w, i) =>
    [
      5,
      w.page ?? 1,
      1,
      1,
      1,
      i + 1,
      w.x,
      w.y,
      w.w ?? w.text.length * 12,
      20,
      w.conf ?? 95,
      w.text,
    ].join('\t'),
  );
  return [header, ...rows].join('\n');
}

/** Poppler's column order: par before block, plus marker rows. */
export function nativeTsv(words: readonly Word[]): string {
  const header =
    'level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = [
    ['1', '1', '0', '0', '0', '0', '0', '0', '595', '842', '-1', '###PAGE###'].join('\t'),
    ...words.map((w, i) =>
      [
        5,
        w.page ?? 1,
        1,
        1,
        1,
        i + 1,
        w.x,
        w.y,
        w.w ?? w.text.length * 6,
        10,
        w.conf ?? 100,
        w.text,
      ].join('\t'),
    ),
  ];
  return [header, ...rows].join('\n');
}

/** A descriptive row: question/sub label, body, then the right-hand columns. */
export function row(
  y: number,
  cells: { label?: string; body: string; marks?: number; L?: string; co?: string; page?: number },
): Word[] {
  const words: Word[] = [];
  const page = cells.page;
  if (cells.label !== undefined) words.push({ text: cells.label, x: 40, y, w: 18, page });
  cells.body.split(' ').forEach((word, i) => {
    words.push({ text: word, x: 80 + i * 40, y, page });
  });
  if (cells.marks !== undefined) words.push({ text: String(cells.marks), x: 760, y, w: 16, page });
  if (cells.L !== undefined) words.push({ text: cells.L, x: 800, y, w: 16, page });
  if (cells.co !== undefined) words.push({ text: cells.co, x: 840, y, w: 24, page });
  return words;
}

/**
 * A token at the right-hand edge of the page.
 *
 * The marks column is located as a FRACTION of the page width, so a fixture
 * that never reaches the right margin would place the column boundary wrong.
 * Real papers always have something out there — a rule, a header, a page
 * number.
 */
export const PAGE_EDGE: Word = { text: '.', x: 900, y: 5, w: 4 };

export function pageEdge(page: number): Word {
  return { ...PAGE_EDGE, page };
}
