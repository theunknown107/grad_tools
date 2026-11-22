/**
 * Interface signs that must not come back: uppercase tracked labels, text under
 * the 12px floor, and gloss on the shared buttons. A source scan, because these
 * are spread across every screen and each regression is one class name.
 */
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return screens(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Every line of interface code matching `pattern`, comments left out. */
function offenders(pattern: RegExp): string[] {
  return screens(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line) && pattern.test(line))
      .map((line) => `${file}: ${line.trim()}`),
  );
}

describe('interface signs', () => {
  it('uses sentence case labels, with no uppercase or wide tracking', () => {
    expect(offenders(/(?<![\w-])uppercase(?=[\s'"`])/)).toEqual([]);
    expect(offenders(/tracking-(?:wide|wider|widest|\[0\.)/)).toEqual([]);
  });

  it('keeps every text size at 12px or above', () => {
    expect(offenders(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/)).toEqual([]);
  });

  it('keeps the shared buttons free of gradient gloss', () => {
    const css = readFileSync(join(SRC, 'styles', 'index.css'), 'utf8');
    const glass = css.slice(css.indexOf('.gt-glass {'), css.indexOf('Glass OFF.'));
    expect(glass).not.toContain('linear-gradient');
    expect(glass).not.toContain('inset 0 1px 0');
  });
});
