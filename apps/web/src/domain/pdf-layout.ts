/**
 * Turning positioned PDF text back into the rows a person sees.
 *
 * Authority: docs/17 §17.20 · M10A.6 §6, §8, §46
 *
 * ---------------------------------------------------------------------------
 * WHY READING ORDER IS NOT ROW ORDER
 * ---------------------------------------------------------------------------
 *
 * A PDF has no rows. It has glyphs at coordinates, emitted in whatever order
 * the producer chose — which for a table is frequently column by column, or
 * header-then-body, or interleaved. `items.map(i => i.str).join(' ')` therefore
 * produces text that reads correctly to nobody and parses correctly to nothing.
 *
 * So the row is REBUILT from geometry: items sharing a baseline are one row,
 * ordered left to right by their x. That is deterministic, it does not depend
 * on the producer, and it is the only step that makes the rest of the import
 * pipeline able to work on lines.
 *
 * ---------------------------------------------------------------------------
 * THE TWO HEURISTICS, BOTH DELIBERATE
 * ---------------------------------------------------------------------------
 *
 * **Which items share a row.** Baselines of one printed row are not bit-equal —
 * a superscript, a different font size, or a rounding in the transform moves
 * them by a fraction of a point. So items within a tolerance of each other are
 * one row. The tolerance is derived from the items' own height rather than
 * fixed, because a 6pt footnote and a 20pt heading need different answers.
 *
 * **Whether two items need a space between them.** pdf.js routinely splits one
 * word into several items with no gap at all — kerning pairs, a change of font,
 * a ligature. Joining those with a space turns MATHEMATICS into MATHE MATICS
 * and destroys the subject title. So a space is inserted only where there is a
 * real horizontal gap, measured against the text size rather than in absolute
 * points.
 *
 * Neither heuristic guesses at MEANING. They reconstruct what was printed; the
 * parser decides what it says.
 */

import type { ImportLine } from './result-import.js';

/**
 * One positioned run of text.
 *
 * Deliberately not pdf.js's own type: this module is pure and testable without
 * loading a PDF engine, and the adapter that produces these is the only place
 * that knows about pdf.js.
 */
export interface PositionedText {
  readonly text: string;
  /** Left edge, in PDF user space. */
  readonly x: number;
  /** Baseline, in PDF user space. Larger is HIGHER on the page. */
  readonly y: number;
  readonly width: number;
  /** Rendered text height, used to scale both tolerances. */
  readonly height: number;
}

/**
 * How far apart two baselines may be and still be one row, as a fraction of
 * text height. Half a line is comfortably inside the gap to the next row and
 * comfortably outside the jitter within one.
 */
const ROW_TOLERANCE = 0.5;

/**
 * How wide a gap must be before it means a space, as a fraction of text height.
 * Below this the items are parts of one word that the producer happened to
 * split.
 */
const SPACE_THRESHOLD = 0.18;

/**
 * How close two runs' left edges must be to be the same COLUMN, as a fraction
 * of text height. A column's entries are set flush, so this is jitter-sized
 * rather than layout-sized; it must stay well under the gap between adjacent
 * columns of a dense table.
 */
const COLUMN_TOLERANCE = 0.5;

function medianHeight(items: readonly PositionedText[]): number {
  const heights = items
    .map((item) => item.height)
    .filter((height) => height > 0)
    .sort((a, b) => a - b);
  return heights.length === 0 ? 10 : (heights[Math.floor(heights.length / 2)] as number);
}

/**
 * Positioned text as printed lines, top to bottom.
 *
 * Empty items are dropped before clustering: a PDF is full of zero-width
 * positioning runs, and letting them vote on row membership widens rows for no
 * reason.
 */
export function itemsToLines(items: readonly PositionedText[], page = 1): ImportLine[] {
  const usable = items.filter((item) => item.text.trim() !== '');
  if (usable.length === 0) return [];

  const tolerance = medianHeight(usable) * ROW_TOLERANCE;

  /*
   * Sorted by descending y so rows come out top-to-bottom, which is the order a
   * person reads and the order the parser's "Semester : N" line needs to
   * precede its rows in.
   */
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: PositionedText[][] = [];
  for (const item of sorted) {
    const current = rows[rows.length - 1];
    /*
     * Compared against the row's FIRST item rather than a running mean: a mean
     * drifts as a row accumulates items, so a long row can slowly swallow the
     * row beneath it.
     */
    const anchor = current?.[0];
    if (current !== undefined && anchor !== undefined && Math.abs(anchor.y - item.y) <= tolerance) {
      current.push(item);
    } else {
      rows.push([item]);
    }
  }

  /*
   * A PRINTED LINE IS NOT A ROW OF THE TABLE.
   *
   * A cell too long for its column wraps, and the wrapped remainder is printed
   * on its own line with every other column of that row left blank:
   *
   *     BPOPS103  PRINCIPLES OF        39  27  66  P  2025-03-13
   *               PROGRAMMING USING
   *               C
   *
   * Read as three lines, the second and third are not subject rows — they have
   * no code and no marks — so they were dropped, and the subject was imported
   * as "PRINCIPLES OF". Six of the real Semester 1–4 cards' titles are cut this
   * way, and nothing on screen said a word was missing.
   *
   * A line is a continuation when it starts in a column the line above uses but
   * NOT in that line's first one, and every run it has stands in one of those
   * columns. That is the shape of a wrap and not the shape of a new row, a
   * heading or a legend: each of those either starts the table's first column
   * or stands somewhere the row above has nothing.
   */
  const continues = (line: readonly PositionedText[], above: readonly PositionedText[]) => {
    const head = line[0];
    const first = above[0];
    if (head === undefined || first === undefined) return false;
    const slack = medianHeight(above) * COLUMN_TOLERANCE;
    if (Math.abs(head.x - first.x) <= slack) return false;
    return line.every((run) => above.some((column) => Math.abs(run.x - column.x) <= slack));
  };

  const merged: PositionedText[][] = [];
  for (const row of rows) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && continues(row, previous)) {
      previous.push(...row);
      continue;
    }
    merged.push([...row]);
  }

  return merged.map((row) => {
    /*
     * By column, and within a column top to bottom: that puts a wrapped title
     * back together in the middle of its row, where the marks still follow it.
     */
    const ordered = [...row].sort((a, b) => a.x - b.x || b.y - a.y);
    const gapThreshold = medianHeight(ordered) * SPACE_THRESHOLD;

    let text = '';
    let cursor: number | null = null;
    let baseline: number | null = null;
    for (const item of ordered) {
      if (cursor !== null) {
        /*
         * Two printed LINES are always two words, whatever their x says. The
         * same tolerance that decided they were different lines decides it
         * here, so a run nudged off its baseline within one line is unaffected.
         */
        if (baseline !== null && Math.abs(item.y - baseline) > tolerance) {
          text += ' ';
          cursor = null;
        }
      }
      if (cursor !== null) {
        const gap = item.x - cursor;
        /*
         * A gap wider than the threshold becomes ONE space, not a proportional
         * run of them. The parser separates columns with `\s+`, so padding the
         * gap to its visual width would add nothing it can use — and would make
         * every assertion in the tests depend on font metrics.
         */
        if (gap > gapThreshold) text += ' ';
      }
      text += item.text;
      cursor = item.x + item.width;
      baseline = item.y;
    }

    return { text: text.trim(), page };
  });
}
