/**
 * Positional token geometry — the common representation.
 *
 * Authority: docs/17 §17.16 · M5A.4 §3, §13
 *
 * ONE REPRESENTATION, TWO SOURCES.
 *
 *   native PDF   pdftotext -tsv   ─┐
 *                                  ├─► PositionedToken ─► structural parser
 *   scanned PDF  tesseract tsv    ─┘
 *
 * Both tools emit TSV with the same column names, which is why the downstream
 * parser can be written once. They are NOT byte-compatible, and the differences
 * are the whole reason this module exists:
 *
 *   1. COLUMN ORDER DIFFERS. Poppler emits `par_num, block_num`; Tesseract
 *      emits `block_num, par_num`. Parsing by position would silently swap two
 *      grouping keys and scramble every line. Both are therefore parsed by
 *      HEADER NAME, never by index.
 *
 *   2. UNITS DIFFER. Poppler reports PDF points (1/72 inch); Tesseract reports
 *      pixels at whatever DPI the page was rasterized at. Everything is
 *      converted to points so one set of geometric thresholds works for both.
 *
 *   3. POPPLER EMITS MARKER ROWS (`###PAGE###`, `###FLOW###`) that are layout
 *      structure, not words. They are dropped.
 *
 * TSV rather than hOCR: same information, same speed, half the bytes, and no
 * XML parser — but mainly because hOCR has no native-PDF counterpart, and a
 * common representation is worth more than a marginally richer one.
 */

/** A word with a position, in PDF points, origin top-left. */
export interface PositionedToken {
  readonly page: number;
  /** Grouping keys as reported by the source, normalised in meaning. */
  readonly block: number;
  readonly paragraph: number;
  readonly line: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 0-100 where the source reports it; null where it does not. */
  readonly confidence: number | null;
  readonly text: string;
}

/** Tokens sharing a line, ordered left to right, with the line's own box. */
export interface PositionedLine {
  readonly page: number;
  readonly tokens: readonly PositionedToken[];
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly bottom: number;
  /** Lowest token confidence on the line; null when unreported. */
  readonly minConfidence: number | null;
}

export type TsvSource = 'native' | 'ocr';

const POINTS_PER_INCH = 72;

/** Poppler's structural markers, which are not words. */
const MARKERS = new Set(['###PAGE###', '###FLOW###', '###BLOCK###', '###LINE###']);

/**
 * Parses TSV from either tool into the common representation.
 *
 * `dpi` is required for OCR output and ignored for native output, because only
 * the OCR side has pixels to convert.
 */
export function parseTsv(tsv: string, source: TsvSource, dpi = 150): PositionedToken[] {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0]?.split('\t').map((name) => name.trim());
  if (header === undefined) return [];

  // By NAME. Poppler and Tesseract disagree on the order of block/par.
  const col = (name: string): number => header.indexOf(name);
  const iLevel = col('level');
  const iPage = col('page_num');
  const iBlock = col('block_num');
  const iPar = col('par_num');
  const iLine = col('line_num');
  const iLeft = col('left');
  const iTop = col('top');
  const iWidth = col('width');
  const iHeight = col('height');
  const iConf = col('conf');
  const iText = col('text');

  // Tesseract pixels -> points. Native output is already in points.
  const scale = source === 'ocr' ? POINTS_PER_INCH / dpi : 1;

  const tokens: PositionedToken[] = [];
  for (const raw of lines.slice(1)) {
    const cells = raw.split('\t');
    // Level 5 is a word in both tools; anything else is a container.
    if (Number(cells[iLevel]) !== 5) continue;

    const text = (cells[iText] ?? '').trim();
    if (text === '' || MARKERS.has(text)) continue;

    const confidence = Number(cells[iConf]);
    tokens.push({
      page: Number(cells[iPage] ?? 1),
      block: Number(cells[iBlock] ?? 0),
      paragraph: Number(cells[iPar] ?? 0),
      line: Number(cells[iLine] ?? 0),
      x: Number(cells[iLeft] ?? 0) * scale,
      y: Number(cells[iTop] ?? 0) * scale,
      width: Number(cells[iWidth] ?? 0) * scale,
      height: Number(cells[iHeight] ?? 0) * scale,
      confidence: Number.isFinite(confidence) && confidence >= 0 ? confidence : null,
      text,
    });
  }
  return tokens;
}

/**
 * Groups tokens into lines.
 *
 * The tools' own line numbering is used where it agrees, but it is NOT trusted
 * across blocks: on a two-column exam paper, the question text and its marks
 * column are different blocks, and their line numbers restart. A row of the
 * marks table is therefore reassembled by VERTICAL OVERLAP, which is what
 * actually makes `question | marks | L | CO` recoverable as one record.
 *
 * `tolerance` is a fraction of token height rather than an absolute distance,
 * so it scales with the type size instead of needing tuning per document.
 */
export function groupIntoLines(
  tokens: readonly PositionedToken[],
  tolerance = 0.6,
): PositionedLine[] {
  const byPage = new Map<number, PositionedToken[]>();
  for (const token of tokens) {
    const bucket = byPage.get(token.page) ?? [];
    bucket.push(token);
    byPage.set(token.page, bucket);
  }

  const lines: PositionedLine[] = [];
  for (const [page, pageTokens] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const remaining = [...pageTokens].sort((a, b) => a.y - b.y || a.x - b.x);

    while (remaining.length > 0) {
      const seed = remaining.shift();
      if (seed === undefined) break;

      const band = seed.height * tolerance;
      const centre = seed.y + seed.height / 2;
      const row: PositionedToken[] = [seed];

      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const candidate = remaining[i];
        if (candidate === undefined) continue;
        const candidateCentre = candidate.y + candidate.height / 2;
        if (Math.abs(candidateCentre - centre) <= band) {
          row.push(candidate);
          remaining.splice(i, 1);
        }
      }

      row.sort((a, b) => a.x - b.x);
      const confidences = row.map((t) => t.confidence).filter((c): c is number => c !== null);

      lines.push({
        page,
        tokens: row,
        text: row.map((t) => t.text).join(' '),
        x: Math.min(...row.map((t) => t.x)),
        y: Math.min(...row.map((t) => t.y)),
        right: Math.max(...row.map((t) => t.x + t.width)),
        bottom: Math.max(...row.map((t) => t.y + t.height)),
        minConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
      });
    }
  }

  return lines.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

/** The rightmost extent of any token, used to locate the marks columns. */
export function pageRight(lines: readonly PositionedLine[], page: number): number {
  const onPage = lines.filter((line) => line.page === page);
  return onPage.length === 0 ? 0 : Math.max(...onPage.map((line) => line.right));
}
