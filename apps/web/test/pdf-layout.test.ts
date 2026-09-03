/**
 * Rebuilding printed rows from PDF coordinates.
 *
 * Authority: docs/22 §22.49 · M10A.6 §8
 *
 * A PDF has no rows — it has glyphs at coordinates, emitted in whatever order
 * the producer chose. For a table that is frequently column by column. So the
 * case that matters is not "does it join text", it is "does it still produce
 * the right rows when the items arrive in the wrong order".
 */

import { describe, expect, it } from 'vitest';
import { itemsToLines, type PositionedText } from '../src/domain/pdf-layout.js';

/** One run of text at a position. Height defaults to a typical body size. */
function at(text: string, x: number, y: number, width = text.length * 5, height = 10) {
  return { text, x, y, width, height };
}

describe('rebuilding rows from coordinates', () => {
  it('groups items on one baseline into one line, left to right', () => {
    const items = [at('80', 300, 700), at('BQAS401', 50, 700), at('ALGORITHMS', 120, 700)];
    expect(itemsToLines(items)).toEqual([{ text: 'BQAS401 ALGORITHMS 80', page: 1 }]);
  });

  it('rebuilds a table emitted COLUMN BY COLUMN', () => {
    /*
     * THE CASE THIS MODULE EXISTS FOR. Reading order here is every code, then
     * every title, then every mark — which joined naively produces one line of
     * nonsense and parses to nothing.
     */
    const items = [
      at('BQAS401', 50, 700),
      at('BQAS402', 50, 680),
      at('ALGORITHMS', 120, 700),
      at('FINANCE', 120, 680),
      at('80', 300, 700),
      at('59', 300, 680),
    ];
    expect(itemsToLines(items)).toEqual([
      { text: 'BQAS401 ALGORITHMS 80', page: 1 },
      { text: 'BQAS402 FINANCE 59', page: 1 },
    ]);
  });

  it('orders rows top to bottom, which is how a page is read', () => {
    // Larger y is HIGHER on the page, so descending y is reading order — and
    // the "Semester : N" line has to precede the rows the parser attaches to it.
    const items = [at('second row', 50, 600), at('Semester : 4', 50, 700)];
    expect(itemsToLines(items).map((line) => line.text)).toEqual(['Semester : 4', 'second row']);
  });

  it('tolerates baselines that differ by a fraction of a line', () => {
    // A superscript or a font change moves a baseline slightly. Those items are
    // still the same printed row.
    const items = [at('BQAS401', 50, 700), at('ALGORITHMS', 120, 700.3), at('80', 300, 699.6)];
    expect(itemsToLines(items)).toHaveLength(1);
  });

  it('keeps genuinely different rows apart', () => {
    const items = [at('BQAS401', 50, 700), at('BQAS402', 50, 680)];
    expect(itemsToLines(items)).toHaveLength(2);
  });

  it('anchors a row to its first item rather than chaining item to item', () => {
    /*
     * THE DIFFERENCE BETWEEN ANCHORING AND CHAINING. Each baseline below is
     * within tolerance (5) of the one before it, so a rule that compared each
     * item to its PREDECESSOR would chain all four into a single row that spans
     * 12 points — swallowing a genuinely separate printed row on the way.
     *
     * Anchoring to the row's first item bounds a row at +/- one tolerance, so
     * the drift stops: 712 and 708 are one row, 704 and 700 another.
     */
    const items = [at('A', 50, 700), at('B', 100, 704), at('C', 50, 708), at('D', 100, 712)];
    const lines = itemsToLines(items);
    expect(lines.map((line) => line.text)).toEqual(['C D', 'A B']);
  });
});

describe('spacing between items', () => {
  it('does not split a word the producer emitted in pieces', () => {
    /*
     * pdf.js routinely splits one word across items — kerning pairs, a font
     * change, a ligature. A space between these would turn MATHEMATICS into
     * MATHE MATICS and destroy the subject title.
     */
    const items = [at('MATHE', 50, 700, 25), at('MATICS', 75, 700, 30)];
    expect(itemsToLines(items)[0]?.text).toBe('MATHEMATICS');
  });

  it('inserts a space where there is a real gap', () => {
    const items = [at('BQAS401', 50, 700, 35), at('ALGORITHMS', 120, 700, 50)];
    expect(itemsToLines(items)[0]?.text).toBe('BQAS401 ALGORITHMS');
  });

  it('inserts one space for a wide gap, not a run of them', () => {
    // The parser separates columns with `\s+`, so padding a gap to its visual
    // width buys nothing and makes every assertion depend on font metrics.
    const items = [at('BQAS401', 50, 700, 35), at('80', 400, 700, 10)];
    expect(itemsToLines(items)[0]?.text).toBe('BQAS401 80');
  });

  it('scales the gap threshold to the text size', () => {
    /*
     * ONE IDENTICAL GAP OF 4 POINTS, read two ways. At 6pt text that is most of
     * a character width and means a word break; at 24pt it is a kerning pair
     * inside one word. A fixed threshold has to be wrong for one of them.
     */
    const small = [at('AB', 50, 700, 6, 6), at('CD', 60, 700, 6, 6)];
    const large = [at('AB', 50, 700, 6, 24), at('CD', 60, 700, 6, 24)];
    expect(itemsToLines(small)[0]?.text).toBe('AB CD');
    expect(itemsToLines(large)[0]?.text).toBe('ABCD');
  });
});

describe('degenerate input', () => {
  it('returns nothing for an empty page', () => {
    expect(itemsToLines([])).toEqual([]);
  });

  it('ignores the zero-width positioning runs a PDF is full of', () => {
    const items = [at('', 50, 700, 0, 0), at('  ', 60, 700, 0, 0), at('BQAS401', 70, 700)];
    expect(itemsToLines(items)).toEqual([{ text: 'BQAS401', page: 1 }]);
  });

  it('survives items with no height rather than dividing by zero', () => {
    const items = [at('A', 50, 700, 5, 0), at('B', 100, 700, 5, 0)];
    expect(itemsToLines(items)).toHaveLength(1);
  });

  it('carries the page number through', () => {
    expect(itemsToLines([at('BQAS401', 50, 700)], 3)[0]?.page).toBe(3);
  });
});

describe('a whole synthetic result page, emitted out of order', () => {
  it('reconstructs lines the result parser can read', () => {
    /*
     * End to end for this module: a page whose items arrive column-first, as a
     * real producer emits a table, rebuilt into the lines the parser expects.
     * All values synthetic.
     */
    const items: PositionedText[] = [
      at('Semester : 4', 50, 760),
      at('University Seat Number : 9ZZ99ZZ999', 50, 780),
      // codes
      at('BQAS401', 50, 700),
      at('BQAS402', 50, 680),
      // titles
      at('ALGORITHMS', 130, 700),
      at('FINANCIAL MANAGEMENT', 130, 680),
      // marks, status, date
      at('44', 320, 700),
      at('36', 360, 700),
      at('80', 400, 700),
      at('P', 440, 700),
      at('2026-07-23', 470, 700),
      at('40', 320, 680),
      at('19', 360, 680),
      at('59', 400, 680),
      at('P', 440, 680),
      at('2026-07-23', 470, 680),
    ];

    expect(itemsToLines(items).map((line) => line.text)).toEqual([
      'University Seat Number : 9ZZ99ZZ999',
      'Semester : 4',
      'BQAS401 ALGORITHMS 44 36 80 P 2026-07-23',
      'BQAS402 FINANCIAL MANAGEMENT 40 19 59 P 2026-07-23',
    ]);
  });
});
