/**
 * Document validation — hostile input handling.
 *
 * Authority: docs/17 §17.3 · docs/13 §T-03 · M5 §6, §7
 *
 * This is the highest-risk input surface in GradTools. Everything here assumes
 * the bytes are hostile and is written to fail closed.
 *
 * ORDER MATTERS. The cheap, certain checks run first so a malicious file is
 * rejected before anything expensive or parser-adjacent touches it. Nothing in
 * this module opens a PDF with a real parser: it reads structure at the byte
 * level only. Actual parsing happens later, in a separate child process with
 * OS-enforced limits (see extract.ts), because a poppler zero-day must be a
 * rejected document rather than a compromised server.
 *
 * THE DECLARED MIME TYPE AND FILE EXTENSION ARE IGNORED ENTIRELY. Both are
 * attacker-controlled strings. Only the bytes decide what a file is.
 */

import { createHash } from 'node:crypto';

/** docs/17 §17.3 check 1. 20 MB, matching the proxy body limit. */
export const MAX_BYTES = 20 * 1024 * 1024;
/** docs/17 §17.3 check 4. */
export const MAX_PAGES = 500;
/** docs/17 §17.3 check 5. The zip/PDF-bomb guard. */
export const MAX_DECOMPRESSION_RATIO = 100;
/** docs/17 §17.3 check 6. */
export const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
/** docs/17 §17.3 check 7. Guards against object-graph explosion. */
export const MAX_OBJECTS = 100_000;

/**
 * Active content that has no legitimate place in a question paper
 * (docs/17 §17.3 check 8). Presence of any of these is fatal, not a warning.
 */
const ACTIVE_CONTENT = [
  '/JavaScript',
  '/JS',
  '/Launch',
  '/EmbeddedFile',
  '/RichMedia',
  '/OpenAction',
] as const;

export type RejectionCode =
  | 'empty'
  | 'too_large'
  | 'not_a_pdf'
  | 'encrypted'
  | 'active_content'
  | 'too_many_pages'
  | 'too_many_objects'
  | 'decompression_bomb'
  | 'malformed';

export interface ValidationSuccess {
  readonly ok: true;
  readonly sha256: string;
  readonly byteSize: number;
  readonly mimeType: 'application/pdf';
  readonly pageCount: number;
  /** Non-fatal observations worth recording (docs/17 §17.3 check 9). */
  readonly warnings: readonly string[];
}

export interface ValidationFailure {
  readonly ok: false;
  readonly code: RejectionCode;
  /** Safe to show a user: says what was wrong, never echoes file content. */
  readonly reason: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/** SHA-256 of the bytes. Content address, duplicate key and storage key. */
export function hashDocument(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A filesystem-safe name derived from a user-supplied one.
 *
 * Used only for DISPLAY. Storage keys come from the content hash, so nothing
 * derived from user input ever reaches a path — this exists so that a filename
 * shown back in the UI cannot carry a traversal sequence, a control character
 * or a Windows device name into wherever it is rendered or logged.
 */
export function safeFilename(input: string): string {
  const base = input.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    // Allowlist, so control characters, path separators, quotes and
    // directory-traversal sequences all collapse to underscores in one step.
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 128);

  // Windows reserves these regardless of extension, and a file named CON.pdf
  // is a hazard on any system that later syncs to one.
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(cleaned)) {
    return `file_${cleaned}`;
  }
  return cleaned === '' ? 'document.pdf' : cleaned;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Sum of the declared `/Length` values across streams.
 *
 * An approximation of uncompressed size, and deliberately so: computing the
 * true figure means decompressing, which is exactly what a decompression bomb
 * wants. The declared lengths are enough to catch the attack without
 * performing it.
 */
function declaredStreamBytes(text: string): number {
  let total = 0;
  const pattern = /\/Length\s+(\d{1,12})/g;
  let match = pattern.exec(text);
  while (match !== null) {
    total += Number(match[1] ?? 0);
    match = pattern.exec(text);
  }
  return total;
}

/**
 * Validates a candidate document.
 *
 * Pure: takes bytes, returns a verdict, touches no filesystem and no network.
 * That is what makes every rejection path testable without a real upload.
 */
export function validateDocument(bytes: Buffer): ValidationResult {
  const byteSize = bytes.byteLength;
  const sha256 = hashDocument(bytes);
  const fail = (code: RejectionCode, reason: string): ValidationFailure => ({
    ok: false,
    code,
    reason,
    sha256,
    byteSize,
  });

  if (byteSize === 0) {
    return fail('empty', 'The file is empty.');
  }
  if (byteSize > MAX_BYTES) {
    return fail('too_large', `The file is larger than the ${MAX_BYTES / 1024 / 1024} MB limit.`);
  }

  // Check 2: magic bytes. The extension and declared MIME type are not consulted.
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return fail('not_a_pdf', 'The file is not a PDF. Its contents do not begin with a PDF header.');
  }

  /*
   * Read as latin1, never utf8. latin1 maps every byte to exactly one code
   * unit, so byte offsets are preserved and no byte sequence is silently
   * replaced — utf8 decoding of binary data mangles exactly the regions a
   * hostile file cares about.
   */
  const text = bytes.toString('latin1');

  if (!text.includes('%%EOF')) {
    return fail('malformed', 'The PDF is truncated or malformed: it has no end-of-file marker.');
  }

  // Check 10: encrypted files cannot be validated or extracted, so they cannot
  // be accepted — an unreadable file is not a safe file.
  if (/\/Encrypt\b/.test(text)) {
    return fail('encrypted', 'The PDF is encrypted, so its contents cannot be checked.');
  }

  // Check 8: active content.
  for (const marker of ACTIVE_CONTENT) {
    if (text.includes(marker)) {
      return fail(
        'active_content',
        'The PDF contains active content such as embedded scripts or files, which is not accepted.',
      );
    }
  }

  // Check 7: object-graph explosion.
  const objectCount = countOccurrences(text, ' obj');
  if (objectCount > MAX_OBJECTS) {
    return fail('too_many_objects', 'The PDF contains an implausible number of objects.');
  }

  /*
   * Check 4: page count, read structurally rather than by parsing.
   *
   * The trailing boundary matters: the page TREE node is `/Type /Pages`, which
   * contains `/Type /Page` as a substring. A plain substring count reports one
   * page too many on every document.
   */
  const pageCount = Math.max((text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length, 1);
  if (pageCount > MAX_PAGES) {
    return fail('too_many_pages', `The PDF has more than ${MAX_PAGES} pages.`);
  }

  // Checks 5 and 6: the bomb guards.
  const uncompressed = declaredStreamBytes(text);
  if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
    return fail('decompression_bomb', 'The PDF declares an implausible amount of stream data.');
  }
  if (uncompressed / byteSize > MAX_DECOMPRESSION_RATIO) {
    return fail(
      'decompression_bomb',
      'The PDF expands to far more data than its size suggests, which is characteristic of a decompression bomb.',
    );
  }

  // Check 9: external references. Recorded, not fatal — a footer URL in a real
  // paper is ordinary, and refusing it would reject legitimate documents.
  const warnings: string[] = [];
  if (/\/URI\s*\(/.test(text) || /\/GoToR\b/.test(text)) {
    warnings.push('Contains references to external URLs.');
  }

  return { ok: true, sha256, byteSize, mimeType: 'application/pdf', pageCount, warnings };
}
