/**
 * An image's width and height, read from its header — before it is decoded.
 *
 * WHY. Decoding allocates width × height × 4 bytes, whatever the file size. A
 * few-kilobyte PNG can declare 50,000 × 50,000 pixels: 10GB of bitmap, which
 * kills the WebView before any size check on the decoded image can run. The
 * dimensions are in the first bytes of every format GradTools accepts, so they
 * are read there, and an image too large to decode safely is refused before
 * the decoder is ever called.
 *
 * Pure: bytes in, dimensions (or null) out. Null means the header could not be
 * read — and an image whose size cannot be established is not decoded.
 */

/** Enough for any JPEG's metadata segments (EXIF, ICC) ahead of its frame header. */
export const IMAGE_HEADER_BYTES = 1024 * 1024;

/**
 * The largest image decoded. 64 megapixels (a 256MB bitmap) admits every
 * phone's normal camera output — the device this was tested on shoots 50MP —
 * and refuses the rest. 16,384px is the edge browsers cap canvases and bitmaps
 * at; past it the decode fails anyway, after allocating.
 */
export const MAX_SOURCE_PIXELS = 64_000_000;
export const MAX_SOURCE_EDGE = 16_384;

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number): number =>
  (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number): number =>
  (((b[at] ?? 0) << 24) >>> 0) +
  (((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0));
const ascii = (b: Uint8Array, at: number, text: string): boolean =>
  [...text].every((char, index) => b[at + index] === char.charCodeAt(0));

function sized(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function png(b: Uint8Array): ImageSize | null {
  // Signature, then the IHDR chunk, which the format requires to come first.
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  return sized(u32be(b, 16), u32be(b, 20));
}

function jpeg(b: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    // Fill bytes, and markers that carry no length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    // Image data or end of image before any frame header: not a usable JPEG.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return sized(u16be(b, at + 7), u16be(b, at + 5));
    }
    // Skipping by segment length also skips the EXIF thumbnail's own frame.
    at += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageSize | null {
  if (ascii(b, 12, 'VP8 ')) {
    // Key frame start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const [b1, b2, b3, b4] = [b[21] ?? 0, b[22] ?? 0, b[23] ?? 0, b[24] ?? 0];
    return sized(
      1 + (((b2 & 0x3f) << 8) | b1),
      1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    );
  }
  if (ascii(b, 12, 'VP8X')) return sized(1 + u24le(b, 24), 1 + u24le(b, 27));
  return null;
}

/** Dimensions from a PNG, JPEG or WebP header; null when they cannot be read. */
export function imageDimensions(bytes: Uint8Array): ImageSize | null {
  if (bytes[0] === 0x89 && ascii(bytes, 1, 'PNG')) return png(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return webp(bytes);
  return null;
}

/** Whether an image of this size may be decoded at all. */
export function decodable(size: ImageSize): boolean {
  return (
    Math.max(size.width, size.height) <= MAX_SOURCE_EDGE &&
    size.width * size.height <= MAX_SOURCE_PIXELS
  );
}
