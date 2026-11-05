/**
 * An image's size is known before it is decoded, and a dangerous one never is.
 *
 * A few-kilobyte file can declare 50,000 × 50,000 pixels, and decoding it
 * allocates 10GB before any check on the result can run. These tests pin the
 * header reader for every accepted format and the rule that `decodeImage`
 * refuses such a file WITHOUT calling the decoder. (The reader was also
 * checked against real PNG, JPEG and WebP encoder output at 1234×567.)
 *
 * SYNTHETIC BYTES ONLY.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SOURCE_EDGE,
  MAX_SOURCE_PIXELS,
  decodable,
  imageDimensions,
} from '../src/lib/image-header.js';
import { OcrError, decodeImage } from '../src/lib/ocr.js';

const be32 = (n: number): number[] => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];
const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const le24 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const text = (value: string): number[] => [...value].map((char) => char.charCodeAt(0));

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0x89,
    ...text('PNG'),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...text('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

/** SOI, an APP1 whose EXIF thumbnail carries its OWN (small) frame header, then the real SOF0. */
function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  const thumbnail = [0xff, 0xc0, ...be16(11), 8, ...be16(120), ...be16(160), 1, 1, 0x11, 0];
  const app1 = [0xff, 0xe1, ...be16(2 + 6 + thumbnail.length), ...text('Exif'), 0, 0, ...thumbnail];
  const sof0 = [
    0xff,
    0xc0,
    ...be16(17),
    8,
    ...be16(height),
    ...be16(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof0, 0xff, 0xda, 0, 0]);
}

const riff = (chunk: number[]): Uint8Array =>
  new Uint8Array([
    ...text('RIFF'),
    0,
    0,
    0,
    0,
    ...text('WEBP'),
    ...chunk,
    ...new Array(16).fill(0),
  ]);

describe('reading dimensions from the header', () => {
  it('reads PNG', () => {
    expect(imageDimensions(png(1600, 1200))).toEqual({ width: 1600, height: 1200 });
  });

  it('reads JPEG from the frame header, not from the EXIF thumbnail in front of it', () => {
    expect(imageDimensions(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });

  it('reads all three WebP layouts', () => {
    const lossy = riff([
      ...text('VP8 '),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      ...le16(1920),
      ...le16(1080),
    ]);
    expect(imageDimensions(lossy)).toEqual({ width: 1920, height: 1080 });

    // VP8L packs 14-bit (width-1, height-1) little-endian after a 0x2f signature.
    const bits = (1920 - 1) | ((1080 - 1) << 14);
    const lossless = riff([
      ...text('VP8L'),
      0,
      0,
      0,
      0,
      0x2f,
      ...le16(bits & 0xffff),
      ...le16(bits >>> 16),
    ]);
    expect(imageDimensions(lossless)).toEqual({ width: 1920, height: 1080 });

    const extended = riff([...text('VP8X'), 0, 0, 0, 0, 0, 0, 0, 0, ...le24(1919), ...le24(1079)]);
    expect(imageDimensions(extended)).toEqual({ width: 1920, height: 1080 });
  });

  it('gives no size for malformed or unrecognised metadata', () => {
    expect(imageDimensions(png(1600, 1200).slice(0, 20))).toBeNull(); // truncated IHDR
    expect(imageDimensions(png(0, 1200))).toBeNull(); // zero width
    const broken = jpeg(4000, 3000);
    broken[2] = 0x12; // a segment that does not start with a marker
    expect(imageDimensions(broken)).toBeNull();
    expect(
      imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 0, 0, 0, 0, 0, 0])),
    ).toBeNull(); // scan before frame
    expect(imageDimensions(new Uint8Array(text('GIF89a')))).toBeNull();
  });
});

describe('what may be decoded', () => {
  it('admits a phone camera photo, including a 50MP one', () => {
    expect(decodable({ width: 4000, height: 3000 })).toBe(true);
    expect(decodable({ width: 8160, height: 6120 })).toBe(true);
  });

  it('refuses too many pixels, or an edge past what a bitmap can hold', () => {
    expect(decodable({ width: 50_000, height: 50_000 })).toBe(false);
    expect(decodable({ width: 10_000, height: 10_000 })).toBe(false); // 100MP > 64MP
    expect(decodable({ width: MAX_SOURCE_EDGE + 1, height: 100 })).toBe(false);
    expect(MAX_SOURCE_PIXELS).toBe(64_000_000);
  });
});

describe('decodeImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function decoder() {
    const created = vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', created);
    return created;
  }

  it('decodes a normal image', async () => {
    const created = decoder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    const image = await decodeImage(new Blob([png(1600, 1200)], { type: 'image/png' }));
    expect(created).toHaveBeenCalledTimes(1);
    expect(image.width).toBe(1600);
  });

  it('refuses huge declared dimensions without ever calling the decoder', async () => {
    const created = decoder();
    const bomb = new Blob([png(50_000, 50_000)], { type: 'image/png' }); // a few dozen bytes
    await expect(decodeImage(bomb)).rejects.toBeInstanceOf(OcrError);
    await expect(decodeImage(bomb)).rejects.toThrow(/50000×50000 pixels — too large/);
    expect(created).not.toHaveBeenCalled();
  });

  it('refuses an image whose size cannot be read, without decoding it', async () => {
    const created = decoder();
    const broken = png(1600, 1200).slice(0, 20);
    await expect(decodeImage(new Blob([broken]))).rejects.toThrow(/could not be opened/);
    expect(created).not.toHaveBeenCalled();
  });
});
