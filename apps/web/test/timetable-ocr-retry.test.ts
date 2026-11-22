/**
 * The sparse OCR pass for a timetable photo: tried whenever the ordinary
 * reading is not a whole week, not only when it is empty.
 *
 * Measured on two real VTU college timetable scans (private, counts only): the
 * ordinary pass kept one or two classes of a nine-column grid, which the old
 * gate ("any subject list and any class") accepted, so the sparse pass never
 * ran and the student was offered 2-3 entries, none of them right. The sparse
 * pass read every day, eight time columns and seven of eight subject rows.
 *
 * The engine is a stand-in returning SYNTHETIC readings; what is under test is
 * which reading the shipped pipeline keeps.
 */
import { describe, expect, it, vi } from 'vitest';
import type { OcrPageResult } from '../src/domain/ocr-layout.js';
import type { PlacedLike } from '../src/domain/timetable-import.js';

/* A canvas whose pixels can be read back, so the pipeline runs its full retry path. */
const { canvas } = vi.hoisted(() => ({
  canvas: () =>
    ({
      width: 1500,
      height: 950,
      getContext: () => ({ getImageData: () => ({}), putImageData: () => undefined }),
    }) as unknown as HTMLCanvasElement,
}));

vi.mock('../src/lib/ocr.js', () => ({
  OcrError: class OcrError extends Error {},
  UPSCALE_TO: 3000,
  decodeImage: vi.fn(() =>
    Promise.resolve({
      canvas: canvas(),
      width: 1500,
      height: 950,
      sourceWidth: 1500,
      sourceHeight: 950,
    }),
  ),
  normalizeContrast: vi.fn(),
}));

const { readImageFile } = await import('../src/lib/result-file.js');
const { parseTimetable } = await import('../src/domain/timetable-import.js');
const { classifyDocument } = await import('../src/domain/document-type.js');

const at = (text: string, x: number, y: number, width = 40): PlacedLike => ({
  text,
  x,
  y,
  width,
  height: 10,
  page: 1,
});

const HEADER = [
  at('TIME-TABLE (R1)', 400, 760, 150),
  // The lunch label the real partial reading kept, beside the grid.
  at('LUNCH BREAK', 900, 640, 90),
  at('DAY/TIME', 20, 700, 60),
  at('10:00-10:55am', 100, 700, 80),
  at('10:55-11:50am', 200, 700, 80),
  at('12.10-1:05pm', 300, 700, 80),
  at('1:05-02:00pm', 400, 700, 80),
];
const LEGEND = [
  at('BQATS101 Mathematics-I MAT Prof. Anita R 2+2+2', 60, 300, 600),
  at('BQHYS102 Applied Physics PHY Prof. Bala V 2+2+2', 60, 280, 600),
  at('BQOPS103 Programming in C POP Prof. Chandra M 3+0+2', 60, 260, 600),
  at('BQSCK104B Electrical Engineering ESC Prof. Divya K 4+0+0', 60, 240, 600),
];
const day = (name: string, y: number, cells: readonly string[]) => [
  at(name, 20, y, 60),
  ...cells.map((text, index) => at(text, 120 + index * 100, y)),
];

/** An engine reading: positioned words, plus the lines the classifier reads. */
function reading(placed: PlacedLike[]): OcrPageResult {
  const rows = new Map<number, PlacedLike[]>();
  for (const item of placed) rows.set(item.y, [...(rows.get(item.y) ?? []), item]);
  const lines = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => ({
      text: row
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(' '),
      page: 1,
    }));
  // A real page reads hundreds of words (titles, legend, footer) besides these.
  return { lines, placed, meanConfidence: 85, wordCount: 250, lowConfidenceWords: 0 };
}

/** The ruled grid defeated: one day read, the rest of the body lost. */
const PARTIAL = reading([...HEADER, ...day('MONDAY', 660, ['ESC', 'MAT']), ...LEGEND]);

/** The whole week. */
const WHOLE = reading([
  ...HEADER,
  ...day('MONDAY', 660, ['ESC', 'MAT', 'PHY', 'POP']),
  ...day('TUESDAY', 620, ['MAT', 'PHY', 'POP', 'ESC']),
  ...day('WEDNESDAY', 580, ['PHY', 'POP', 'ESC', 'MAT']),
  ...LEGEND,
]);

describe('reading a timetable photo', () => {
  it('tries the sparse pass when the ordinary reading is only part of the week, and keeps it', async () => {
    // The precondition the old gate got wrong: a partial reading HAS a subject
    // list and a class, and is still not a timetable a student can use.
    const before = parseTimetable(PARTIAL.placed.map((item) => ({ ...item, page: 1 })));
    // It IS recognised as a timetable, as the real one was: otherwise any gate
    // would try the sparse pass and this test would prove nothing.
    expect(classifyDocument(PARTIAL.lines).type).toBe('college_timetable');
    expect(before.dictionary.length).toBeGreaterThan(0);
    expect(before.classes.length).toBeGreaterThan(0);
    expect(before.coverage.looksComplete).toBe(false);

    const recognize = vi.fn(
      (_canvas: HTMLCanvasElement, _page?: number, options?: { sparse?: boolean }) =>
        Promise.resolve(options?.sparse === true ? WHOLE : PARTIAL),
    );
    const got = await readImageFile(
      new File(['x'], 'timetable.jpg', { type: 'image/jpeg' }),
      recognize,
    );

    expect(recognize.mock.calls.some((call) => call[2]?.sparse === true)).toBe(true);
    const kept = parseTimetable(got.placed.map((item) => ({ ...item, page: 1 })));
    expect(kept.classes).toHaveLength(12);
    expect(kept.coverage.looksComplete).toBe(true);
  });

  it('does not pay for the sparse pass when the ordinary reading is already a whole week', async () => {
    const recognize = vi.fn(() => Promise.resolve(WHOLE));
    const got = await readImageFile(
      new File(['x'], 'timetable.jpg', { type: 'image/jpeg' }),
      recognize,
    );

    expect(recognize.mock.calls.some((call) => (call as unknown[])[2] !== undefined)).toBe(false);
    expect(parseTimetable(got.placed.map((item) => ({ ...item, page: 1 }))).classes).toHaveLength(
      12,
    );
  });

  it('keeps the ordinary reading when the sparse pass is no better', async () => {
    const worse = reading([...HEADER, ...LEGEND]);
    const recognize = vi.fn(
      (_canvas: HTMLCanvasElement, _page?: number, options?: { sparse?: boolean }) =>
        Promise.resolve(options?.sparse === true ? worse : PARTIAL),
    );
    const got = await readImageFile(
      new File(['x'], 'timetable.jpg', { type: 'image/jpeg' }),
      recognize,
    );

    expect(parseTimetable(got.placed.map((item) => ({ ...item, page: 1 }))).classes).toHaveLength(
      parseTimetable(PARTIAL.placed.map((item) => ({ ...item, page: 1 }))).classes.length,
    );
  });
});
