/**
 * Real student records do not belong in this repository, and it is public.
 *
 * Real marks reached the tree twice: once as a fixture, and again after being
 * sanitized elsewhere, under synthetic course codes.
 *
 * Deliberately holds no real value, nor a hash of one: this file is public too.
 * The checks are about SHAPE, so a disguised real row can only be caught by the
 * count below forcing a review, or by the private scanner.
 * `tests/private-record-scan.mjs` compares real values, from the private bundle.
 * Invent test marks, never transcribe them (docs/12 §12.16).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');

/** Reserved for invented students: no VTU college uses them. */
const SYNTHETIC_COLLEGES = new Set(['XX', 'AB']);
const USN = /\b[1-4]([A-Z]{2})\d{2}[A-Z]{2,3}\d{3}\b/g;

/** A course code followed by internal, external and total marks. */
const RESULT_ROW = /\b(B[A-Z]{2,4}\d{3}[A-Z]?)\b[^\n]{0,80}?\b(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\b/g;

/**
 * Every result-shaped row in a test, by file. A course code proves nothing, BQ
 * included: a real card sat here under BQ codes and an earlier version of this check
 * passed it. A new row changes the count and fails, so a person must confirm its
 * marks were invented, run tests/private-record-scan.mjs, and raise the count.
 */
const REVIEWED_ROWS: Readonly<Record<string, number>> = {
  'apps/web/test/ai-import.test.tsx': 4,
  'apps/web/test/document-type.test.ts': 1,
  'apps/web/test/fixture-privacy.test.ts': 1,
  'apps/web/test/ocr-layout.test.ts': 7,
  'apps/web/test/office-extract.test.ts': 1,
  'apps/web/test/pdf-layout.test.ts': 4,
  'apps/web/test/result-file.test.ts': 7,
  'apps/web/test/result-import-workflow.test.tsx': 9,
  'apps/web/test/result-import.test.ts': 27,
  'apps/web/test/result-reconcile.test.ts': 4,
  'apps/web/test/scheme-compat.test.ts': 1,
  'services/api/test/document-ai.test.ts': 1,
};

const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((file) => /\.(ts|tsx|mjs|md|json|txt|csv)$/.test(file))
    .filter((file) => !/(^|\/)(node_modules|dist|android)\//.test(file));

const text = (file: string): string => {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch {
    return ''; // deleted in the working tree
  }
};

describe('nothing in the repository looks like a real student record', () => {
  it('every USN uses a reserved college code', () => {
    const real: string[] = [];
    for (const file of tracked()) {
      for (const match of text(file).matchAll(USN)) {
        /* Reports the file only: a failing test must not print the USN into CI logs. */
        if (!SYNTHETIC_COLLEGES.has(match[1] as string)) real.push(file);
      }
    }
    expect([...new Set(real)]).toEqual([]);
  });

  it('counts every result row in a test, whatever its course code says', () => {
    const rows: Record<string, number> = {};
    for (const file of tracked().filter((f) => /(^|\/)tests?\//.test(f))) {
      for (const match of text(file).matchAll(RESULT_ROW)) {
        const [, , internal, external, total] = match;
        if (Number(internal) + Number(external) === Number(total)) {
          rows[file] = (rows[file] ?? 0) + 1;
        }
      }
    }
    expect(rows).toEqual(REVIEWED_ROWS);
  });

  it('would notice a real-looking record', () => {
    const row = 'BCS501 ' + '40 38 78';
    expect([...row.matchAll(RESULT_ROW)]).toHaveLength(1);
    expect([...('1' + 'QQ22CS' + '123').matchAll(USN)][0]?.[1]).toBe('QQ');
  });
});
