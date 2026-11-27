/**
 * The divider between two option sub-tables printed side by side.
 *
 * Authority: catalogue title-extraction audit (2026-10-25) §3–§4.
 *
 * The first-year Engineering-Science / ETC tables put two option tables on one
 * row, each with its own code and title column:
 *
 *   BESCK104A  Introduction to Civil Engineering  3 0 0 │ BETCK105A  Smart Materials and Systems  3 0 0
 *
 * `nextTableCodeX` finds the x where the right table begins, so a left title
 * stops before it. The expected x-values below are read off the coordinates by
 * hand, not taken from the function, and a layout where the two codes are
 * adjacent (an alternative sharing one title) must NOT be treated as a divider.
 */

import { describe, expect, it } from 'vitest';
import { nextTableCodeX, type PositionedText } from '@gradtools/vtu-catalogue';

const cell = (text: string, x: number, y = 100): PositionedText => ({
  text,
  x,
  y,
  width: text.length * 5,
  height: 10,
});
const BAND = 6;

describe('nextTableCodeX', () => {
  it('finds the right sub-table’s code as the divider, with a title between', () => {
    const left = cell('BESCK104A', 82);
    const cells = [
      left,
      cell('Introduction to Civil Engineering', 151),
      cell('3', 362),
      cell('0', 379),
      cell('0', 397),
      cell('BETCK105A', 415),
      cell('Smart Materials and Systems', 484),
      cell('3', 717),
    ];
    expect(nextTableCodeX(cells, left, BAND)).toBe(415);
  });

  it('returns Infinity for the rightmost table (no code to its right)', () => {
    const right = cell('BETCK105A', 415);
    const cells = [
      cell('BESCK104A', 82),
      cell('Introduction to Civil Engineering', 151),
      right,
      cell('Smart Materials and Systems', 484),
    ];
    expect(nextTableCodeX(cells, right, BAND)).toBe(Number.POSITIVE_INFINITY);
  });

  it('does NOT treat an adjacent alternative code as a divider (no title between)', () => {
    // "BMEL305 BME305  Introduction to Modelling…" — two codes, one shared title
    // after them. Clipping at BME305 would leave the title empty, so BME305 is
    // not a divider.
    const head = cell('BMEL305', 140);
    const cells = [
      head,
      cell('BME305', 182),
      cell('Introduction to Modelling and Design', 240),
      cell('1', 760),
    ];
    expect(nextTableCodeX(cells, head, BAND)).toBe(Number.POSITIVE_INFINITY);
  });

  it('ignores a code on another baseline (a wrapped continuation line)', () => {
    const left = cell('BESCK104A', 82, 100);
    const cells = [
      left,
      cell('Introduction to Civil', 151, 100),
      cell('Engineering', 151, 88), // wrapped line, lower baseline, no code
      cell('BESCK104B', 82, 88), // next ROW's code, out of band and not to the right
    ];
    expect(nextTableCodeX(cells, left, BAND)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is independent of the order of the cells', () => {
    const left = cell('BESCK104A', 82);
    const base = [
      left,
      cell('Introduction to Civil Engineering', 151),
      cell('BETCK105A', 415),
      cell('Smart Materials and Systems', 484),
    ];
    const shuffled = [base[3], base[1], base[2], base[0]] as PositionedText[];
    expect(nextTableCodeX(shuffled, left, BAND)).toBe(nextTableCodeX(base, left, BAND));
  });

  it('takes the nearest dividing table when three sit in a row', () => {
    const left = cell('BAAA104A', 82);
    const cells = [
      left,
      cell('First Title', 151),
      cell('BBBB105A', 300),
      cell('Second Title', 360),
      cell('BCCC106A', 520),
      cell('Third Title', 580),
    ];
    expect(nextTableCodeX(cells, left, BAND)).toBe(300);
  });
});
