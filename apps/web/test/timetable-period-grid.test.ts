/**
 * Section × period timetables: days as block headers, numbered section columns,
 * period numbers down the left margin, course codes in the cells, and NO clock
 * header. The standard parser is built around the time header, so it read these
 * as empty; `parsePeriodGrid` reads them deterministically from geometry.
 *
 * Every fixture is synthetic — positions chosen by hand, no real document.
 */
import { describe, expect, it } from 'vitest';
import { parsePeriodGrid, parseTimetable } from '../src/domain/timetable-import.js';

/** One positioned run. height 8 → the parser's band is 8. */
function at(text: string, x: number, y: number) {
  return { text, x, y, width: text.length * 6, height: 8, page: 1 };
}

/** A small, clean section/period grid: 4 sections, 2 days, 3 periods. */
const GRID = [
  at('B.Tech 3rd Semester', 40, 2),
  at('Section', 40, 10),
  at('1', 100, 10),
  at('2', 200, 10),
  at('3', 300, 10),
  at('4', 400, 10),
  at('MONDAY', 250, 30),
  at('1', 50, 45),
  at('2', 50, 70),
  at('3', 50, 95),
  at('CSE101', 100, 45), // Monday, period 1, section 1
  at('CSE101', 100, 45), // a repeated/merged heading — must count once
  at('CSE102', 200, 70), // Monday, period 2, section 2
  at('MAT201', 300, 95), // Monday, period 3, section 3
  at('LUNCH', 200, 95), // a break cell — no code, not a class
  at('TUESDAY', 250, 120),
  at('1', 50, 135),
  at('2', 50, 160),
  at('PHY101', 400, 135), // Tuesday, period 1, section 4
  at('CSE102', 100, 160), // Tuesday, period 2, section 1
];

describe('parsePeriodGrid', () => {
  it('reads classes with the right day, period and section, inventing no time', () => {
    const grid = parsePeriodGrid(GRID);
    expect(grid).not.toBeNull();
    const got = grid?.classes.map((c) => `${c.day} P${c.period} S${c.section} ${c.code}`).sort();
    expect(got).toEqual([
      'Mon P1 S1 CSE101',
      'Mon P2 S2 CSE102',
      'Mon P3 S3 MAT201',
      'Tue P1 S4 PHY101',
      'Tue P2 S1 CSE102',
    ]);
    expect(grid?.sections).toEqual(['1', '2', '3', '4']);
    // No PeriodClass has any clock-time field at all — time is simply unknown.
    for (const c of grid?.classes ?? []) expect(c).not.toHaveProperty('start');
  });

  it('does not manufacture a class from a break or an empty cell', () => {
    const grid = parsePeriodGrid(GRID);
    expect(grid?.classes.some((c) => /LUNCH/i.test(c.sourceText))).toBe(false);
  });

  it('counts a repeated heading once, never as a duplicate', () => {
    const grid = parsePeriodGrid(GRID);
    const monP1 = grid?.classes.filter(
      (c) => c.day === 'Mon' && c.period === 1 && c.code === 'CSE101',
    );
    expect(monP1).toHaveLength(1);
  });

  it('surfaces the period grid through parseTimetable without inventing time slots', () => {
    const parsed = parseTimetable(GRID);
    expect(parsed.periodGrid).not.toBeNull();
    expect(parsed.periodGrid?.classes.length).toBe(5);
    expect(parsed.slots).toEqual([]); // no fabricated clock columns
    expect(parsed.classes).toEqual([]); // no timed classes
  });

  it('refuses a document that is not a section/period grid (no section header)', () => {
    const notAGrid = [
      at('MONDAY', 100, 10),
      at('CSE101', 100, 40),
      at('TUESDAY', 100, 60),
      at('CSE102', 100, 90),
    ];
    expect(parsePeriodGrid(notAGrid)).toBeNull();
  });

  it('leaves an ordinary timed timetable to the standard parser', () => {
    // A time-header grid: no "Section" numbered-column header, so period-grid
    // detection returns null and the timed path handles it.
    const timed = [
      at('09:00 - 09:55', 100, 10),
      at('10:00 - 10:55', 200, 10),
      at('MONDAY', 20, 40),
      at('CN', 100, 40),
      at('OS', 200, 40),
    ];
    expect(parsePeriodGrid(timed)).toBeNull();
  });
});
