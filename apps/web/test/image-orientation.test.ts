/**
 * A photo whose PIXELS are sideways (M2.2).
 *
 * The engine is faked: each canvas carries the quarter turn it was drawn at,
 * and the fake engine reads a page well only at the turn that makes it upright.
 * That isolates the decision `readImageFile` makes (when to look for a turn,
 * which turn to keep, when to give up), which is what M2.2 changed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { OcrPageResult } from '../src/domain/ocr-layout.js';
import type { PlacedLike } from '../src/domain/timetable-import.js';

type FakeCanvas = HTMLCanvasElement & { turns: number };
const { decoded, turnCanvas } = vi.hoisted(() => {
  const make = (turns: number, width: number, height: number) =>
    ({
      turns,
      width,
      height,
      getContext: () => ({ getImageData: () => ({}), putImageData: () => undefined }),
    }) as unknown as HTMLCanvasElement & { turns: number };
  const decoded: (HTMLCanvasElement & { turns: number })[] = [];
  return {
    decoded,
    turnCanvas: vi.fn((source: HTMLCanvasElement & { turns: number }, q: number) =>
      make(
        (source.turns + q) % 4,
        q % 2 ? source.height : source.width,
        q % 2 ? source.width : source.height,
      ),
    ),
    make,
  };
});

vi.mock('../src/lib/ocr.js', () => ({
  OcrError: class OcrError extends Error {},
  UPSCALE_TO: 3000,
  decodeImage: vi.fn(() => {
    const canvas = {
      turns: 0,
      width: 1200,
      height: 1600,
      getContext: () => ({ getImageData: () => ({}), putImageData: () => undefined }),
    } as unknown as FakeCanvas;
    decoded.push(canvas);
    return Promise.resolve({
      canvas,
      width: 1200,
      height: 1600,
      sourceWidth: 1200,
      sourceHeight: 1600,
    });
  }),
  normalizeContrast: vi.fn(),
  turnCanvas,
}));

const { readImageFile } = await import('../src/lib/result-file.js');
const { parseTimetable } = await import('../src/domain/timetable-import.js');

const at = (text: string, x: number, y: number, width = 40): PlacedLike => ({
  text,
  x,
  y,
  width,
  height: 10,
  page: 1,
});
const WEEK: PlacedLike[] = [
  at('DAY/TIME', 20, 700, 60),
  at('10:00-10:55am', 100, 700, 80),
  at('10:55-11:50am', 200, 700, 80),
  ...['MONDAY', 'TUESDAY', 'WEDNESDAY'].flatMap((day, i) => [
    at(day, 20, 660 - i * 40, 60),
    at('MAT', 120, 660 - i * 40),
    at('PHY', 220, 660 - i * 40),
  ]),
  at('BQATS101 Mathematics-I MAT Prof. Anita R 2+2+2', 60, 300, 600),
  at('BQHYS102 Applied Physics PHY Prof. Bala V 2+2+2', 60, 280, 600),
];
function page(placed: PlacedLike[], meanConfidence: number, wordCount = 250): OcrPageResult {
  const rows = new Map<number, PlacedLike[]>();
  for (const item of placed) rows.set(item.y, [...(rows.get(item.y) ?? []), item]);
  const lines = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => ({ text: row.map((item) => item.text).join(' '), page: 1 }));
  return { lines, placed, meanConfidence, wordCount, lowConfidenceWords: 0 };
}
const NOISE = page([at('ll', 10, 10), at('|| ~', 30, 30)], 33);
const GOOD = page(WEEK, 70);

/** An engine for a page that is upright at quarter turn `upright` (clockwise). */
const engineFor = (upright: number, read: { good?: OcrPageResult; bad?: OcrPageResult } = {}) =>
  vi.fn((canvas: HTMLCanvasElement) =>
    Promise.resolve(
      (canvas as FakeCanvas).turns === upright ? (read.good ?? GOOD) : (read.bad ?? NOISE),
    ),
  );
const file = () => new File(['x'], 'timetable.jpg', { type: 'image/jpeg' });
const turnsSeen = (recognize: ReturnType<typeof engineFor>) =>
  recognize.mock.calls.map((call) => (call[0] as FakeCanvas).turns);

describe('a photo that is sideways in its pixels', () => {
  it('is read at the turn that makes it upright (90° anticlockwise), not refused', async () => {
    turnCanvas.mockClear();
    const recognize = engineFor(3);
    const got = await readImageFile(file(), recognize);
    expect(parseTimetable(got.placed.map((item) => ({ ...item, page: 1 }))).classes).toHaveLength(
      6,
    );
    expect(turnsSeen(recognize).filter((t) => t === 3).length).toBeGreaterThanOrEqual(2); // probe + full read
  });

  it('is read when it needs 90° clockwise instead', async () => {
    const recognize = engineFor(1);
    const got = await readImageFile(file(), recognize);
    expect(got.placed).toEqual(GOOD.placed);
    expect(turnsSeen(recognize)).toContain(1);
  });

  it('is read when it is upside down', async () => {
    const recognize = engineFor(2);
    expect((await readImageFile(file(), recognize)).placed).toEqual(GOOD.placed);
  });

  it('turns a fresh decode, never the canvas that was already read', async () => {
    decoded.length = 0;
    turnCanvas.mockClear();
    await readImageFile(file(), engineFor(3));
    const sources = turnCanvas.mock.calls.map((call) => call[0]);
    const fresh = decoded[decoded.length - 1];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source === fresh)).toBe(true);
    expect(sources).not.toContain(decoded[0]);
  });
});

describe('a photo that is the right way up', () => {
  it('never pays for a turn when it reads well', async () => {
    turnCanvas.mockClear();
    const recognize = engineFor(0);
    expect((await readImageFile(file(), recognize)).placed).toEqual(GOOD.placed);
    expect(turnCanvas).not.toHaveBeenCalled();
    expect(turnsSeen(recognize).every((t) => t === 0)).toBe(true);
  });

  it('keeps the upright reading when no turn reads clearly better', async () => {
    // An upright but poor photo: read, not recognised, low confidence. Turning it only reads noise.
    const poor = page([at('Some', 10, 10), at('words', 60, 10)], 46, 220);
    const recognize = engineFor(0, { good: poor, bad: page([at('x', 1, 1)], 30) });
    const got = await readImageFile(file(), recognize);
    expect(got.placed).toEqual(poor.placed);
    expect(turnsSeen(recognize).filter((t) => t !== 0)).toEqual([3, 1, 2]); // one probe each, nothing more
  });

  it('a turn that is only slightly more confident is not trusted', async () => {
    const better = page(WEEK, 40); // 7 points above the upright noise: below the margin
    const recognize = engineFor(3, { good: better });
    await expect(readImageFile(file(), recognize)).rejects.toThrow();
  });
});

describe('when the page cannot be read at all', () => {
  it('is still refused, with no plausible-looking timetable invented', async () => {
    const recognize = vi.fn(() => Promise.resolve(NOISE));
    await expect(readImageFile(file(), recognize)).rejects.toThrow();
  });

  it('is refused safely when the browser cannot draw a turned canvas', async () => {
    turnCanvas.mockImplementationOnce(() => null as unknown as FakeCanvas);
    const recognize = engineFor(3);
    await expect(readImageFile(file(), recognize)).rejects.toThrow();
  });
});
