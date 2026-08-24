/**
 * Document pipeline: validation, storage, extraction.
 *
 * Authority: docs/17 §17.3, §17.4, §17.12 · docs/13 §T-03 · M5 §6, §7, §21
 *
 * No database required. Validation and storage-key derivation are pure, and
 * extraction runs a child process, so the whole hostile-input surface is
 * testable without an upload endpoint or a running server.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BYTES,
  hashDocument,
  safeFilename,
  validateDocument,
} from '../src/documents/validate.js';
import {
  LocalObjectStore,
  MemoryObjectStore,
  keyForBytes,
  storageKeyFor,
} from '../src/documents/storage.js';
import { extractText, sectionize } from '../src/documents/extract.js';
import {
  activeContentPdf,
  decompressionBombPdf,
  encryptedPdf,
  notAPdf,
  scannedPdf,
  truncatedPdf,
  validPdf,
} from './fixtures/pdfs.js';

describe('document validation — accepts a well-formed PDF', () => {
  it('accepts a valid document and reports its properties', () => {
    const result = validateDocument(validPdf());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe('application/pdf');
    expect(result.pageCount).toBe(1);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.byteSize).toBeGreaterThan(0);
  });

  it('counts pages', () => {
    const result = validateDocument(validPdf({ pages: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pageCount).toBe(4);
  });

  it('is deterministic: the same bytes hash the same', () => {
    const bytes = validPdf();
    expect(hashDocument(bytes)).toBe(hashDocument(Buffer.from(bytes)));
  });
});

describe('document validation — hostile input', () => {
  it('rejects an empty file', () => {
    const result = validateDocument(Buffer.alloc(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty');
  });

  it('rejects a file over the size limit', () => {
    // A buffer that starts with a valid header, so size is what rejects it
    // rather than the magic-byte check firing first.
    const oversized = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_BYTES + 1)]);
    const result = validateDocument(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too_large');
  });

  /*
   * The check that matters most. A file named paper.pdf and served as
   * application/pdf is still not a PDF if its bytes say otherwise, and both of
   * those labels are attacker-controlled.
   */
  it('rejects a non-PDF regardless of what it claims to be', () => {
    const result = validateDocument(notAPdf());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_a_pdf');
  });

  it('rejects a decompression bomb without decompressing it', () => {
    const result = validateDocument(decompressionBombPdf());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('decompression_bomb');
  });

  it('rejects embedded active content', () => {
    const result = validateDocument(activeContentPdf());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('active_content');
  });

  it('rejects an encrypted PDF', () => {
    const result = validateDocument(encryptedPdf());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('encrypted');
  });

  it('rejects a truncated PDF', () => {
    const result = validateDocument(truncatedPdf());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed');
  });

  it('reports a hash even for a rejected file, so duplicates are recognised', () => {
    const result = validateDocument(notAPdf());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never echoes file content in a rejection message', () => {
    const nasty = Buffer.from('GIF89a SECRETMARKER-should-not-appear', 'latin1');
    const result = validateDocument(nasty);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('SECRETMARKER');
  });
});

describe('filenames', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\cmd.exe', 'cmd.exe'],
    ['/absolute/path/paper.pdf', 'paper.pdf'],
    ['....//....//evil.pdf', 'evil.pdf'],
  ])('strips path components from %s', (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });

  it('collapses everything outside the allowlist', () => {
    expect(safeFilename('pa per;rm -rf.pdf')).toBe('pa_per_rm_-rf.pdf');
  });

  it('defuses Windows reserved device names', () => {
    expect(safeFilename('CON.pdf')).toBe('file_CON.pdf');
    expect(safeFilename('nul')).toBe('file_nul');
  });

  it('never returns an empty name', () => {
    expect(safeFilename('///')).toBe('document.pdf');
    expect(safeFilename('...')).toBe('document.pdf');
  });

  it('bounds the length', () => {
    expect(safeFilename('a'.repeat(500)).length).toBeLessThanOrEqual(128);
  });
});

describe('object storage', () => {
  it('derives keys from the content hash, never from a name', () => {
    const key = keyForBytes(validPdf());
    expect(key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
  });

  it('refuses a key that is not a hex hash', () => {
    expect(() => storageKeyFor('../../etc/passwd')).toThrow();
    expect(() => storageKeyFor('NOTHEX')).toThrow();
  });

  it('round-trips bytes', async () => {
    const store = new MemoryObjectStore();
    const bytes = validPdf();
    const key = keyForBytes(bytes);

    await store.put(key, bytes);
    expect(await store.exists(key)).toBe(true);
    expect((await store.get(key)).equals(bytes)).toBe(true);

    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
  });

  it('stores identical bytes once', async () => {
    const store = new MemoryObjectStore();
    const bytes = validPdf();
    await store.put(keyForBytes(bytes), bytes);
    await store.put(keyForBytes(Buffer.from(bytes)), bytes);
    expect(store.size).toBe(1);
  });

  /*
   * The traversal guard. Keys are hash-derived so this should be unreachable —
   * asserted anyway, because "should be unreachable" is how traversal bugs get
   * written.
   */
  it('refuses a path that escapes the storage root', () => {
    const store = new LocalObjectStore('/tmp/gradtools-test-root');
    expect(store.get('../../../etc/passwd')).rejects.toThrow(/outside the storage root/);
  });
});

describe('text extraction', () => {
  it('extracts text from a PDF that has a text layer', async () => {
    const result = await extractText(validPdf({ text: 'ANALYSIS AND DESIGN OF ALGORITHMS' }), 1);
    expect(result.status).toBe('text_available');
    expect(result.text).toContain('ALGORITHMS');
    expect(result.extractorVersion).toBe('pdftotext-v1');
  }, 30_000);

  /*
   * The scan case. GradTools reports that OCR would be needed and stops; it
   * does not silently OCR, because a document whose text was guessed and one
   * whose text was read must stay distinguishable (M5 §15).
   */
  it('reports ocr_required for a PDF with no usable text layer', async () => {
    const result = await extractText(scannedPdf(), 1);
    expect(result.status).toBe('ocr_required');
    expect(result.text).toBe('');
  }, 30_000);

  it('returns a failure result rather than throwing on unparseable input', async () => {
    const result = await extractText(Buffer.from('%PDF-1.7 not really a pdf', 'latin1'), 1);
    expect(['extraction_failed', 'ocr_required']).toContain(result.status);
  }, 30_000);

  it('records how long extraction took', async () => {
    const result = await extractText(validPdf(), 1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

describe('sectionizing', () => {
  it('splits pages and blocks with positions', () => {
    const sections = sectionize('Block one\n\nBlock two\fPage two block');
    expect(sections).toEqual([
      { pageNumber: 1, ordinal: 0, content: 'Block one' },
      { pageNumber: 1, ordinal: 1, content: 'Block two' },
      { pageNumber: 2, ordinal: 0, content: 'Page two block' },
    ]);
  });

  it('drops empty blocks rather than storing blank sections', () => {
    expect(sectionize('\n\n\n\nreal content\n\n\n\n')).toEqual([
      { pageNumber: 1, ordinal: 0, content: 'real content' },
    ]);
  });

  it('produces nothing for empty text', () => {
    expect(sectionize('')).toEqual([]);
  });

  /*
   * Deliberately structural. Question segmentation is the later intelligence
   * milestone (M5 §16); this asserts we are NOT guessing at question
   * boundaries, because a stored guess is far harder to retract than an
   * absent one.
   */
  it('does not attempt to identify questions', () => {
    const sections = sectionize('1 a) Define an algorithm. (6 marks)\n\nb) Explain. (4 marks)');
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section).not.toHaveProperty('questionNumber');
      expect(section).not.toHaveProperty('marks');
    }
  });
});
