/**
 * Purity guard for the academic-rules package.
 *
 * Authority: docs/16 §16.2, docs/19 §19.2, docs/33 §33.4 invariants 1-2
 *
 * This is the runtime half of the two-part guard. The other half is the
 * `no-restricted-imports` / `no-restricted-globals` block in eslint.config.mjs.
 * A lint rule can be disabled with a comment; this test reads the source files
 * and cannot be.
 *
 * The package must stay portable and deterministic so that:
 *   - the browser and the server compute identical values (docs/07 §7.3), and
 *   - no model, network call or clock can ever influence an academic number
 *     (docs/19 §19.2 — enforced architecturally, not by policy).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

const sourceFiles = collectSourceFiles(SRC_DIR);

/** Strips block and line comments so documentation prose is not scanned as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('academic-rules purity', () => {
  it('contains source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(5);
  });

  it('declares no runtime dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
  });

  it.each(sourceFiles)('%s imports nothing outside the package', (file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    const importPattern = /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/g;

    for (const match of code.matchAll(importPattern)) {
      const specifier = match[1];
      expect(
        specifier?.startsWith('./') === true || specifier?.startsWith('../') === true,
        `${file} imports "${String(specifier)}". academic-rules must import only ` +
          `relative paths within the package (docs/16 §16.2).`,
      ).toBe(true);
    }
  });

  it.each(sourceFiles)('%s uses no dynamic import or require', (file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
  });

  it.each(sourceFiles)('%s touches no environment, I/O, clock or randomness', (file) => {
    const code = stripComments(readFileSync(file, 'utf8'));

    const forbidden: readonly (readonly [RegExp, string])[] = [
      [/\bprocess\s*\./, 'process (environment access)'],
      [/\bwindow\s*\./, 'window (browser global)'],
      [/\bdocument\s*\./, 'document (UI access)'],
      [/\blocalStorage\b/, 'localStorage'],
      [/\bfetch\s*\(/, 'fetch (network I/O)'],
      [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
      [/\bMath\s*\.\s*random\s*\(/, 'Math.random (non-deterministic)'],
      [/\bDate\s*\.\s*now\s*\(/, 'Date.now (clock access)'],
      [/\bnew\s+Date\s*\(/, 'new Date (clock access)'],
      [/\bsetTimeout\s*\(/, 'setTimeout'],
      [/\bglobalThis\s*\./, 'globalThis'],
      [/\beval\s*\(/, 'eval'],
    ];

    for (const [pattern, description] of forbidden) {
      expect(pattern.test(code), `${file} uses ${description}, which breaks purity.`).toBe(false);
    }
  });

  it('never references the obsolete 0.75-offset percentage formula', () => {
    // docs/32 DEC-009 and the M3 authorization §10: the obsolete formula must
    // not exist anywhere in the active implementation.
    for (const file of sourceFiles) {
      const code = readFileSync(file, 'utf8');
      expect(code).not.toMatch(/cgpa_minus_0_75/i);
      expect(stripComments(code)).not.toMatch(/0\.75/);
    }
  });
});
