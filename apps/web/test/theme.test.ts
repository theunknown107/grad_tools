/**
 * Theme preference, and the contrast of every accent it can produce.
 *
 * Authority: docs/05 §5.21 · docs/22 §22.30 (M9.6) · docs/27 §27.2
 *
 * The contrast block is the important half. Five accents times two appearances
 * is ten palettes, and nobody is going to eyeball ten palettes on every change.
 * So the ratios are COMPUTED FROM tokens.css: the test parses the stylesheet
 * that ships, not a copy of the values, which means a hue edited in CSS is
 * checked here without anyone remembering to update a fixture.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  APPEARANCES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  resolveAppearance,
  writeStoredTheme,
  type ThemePreference,
} from '../src/lib/theme.js';

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/** The two methods this module actually uses, and nothing else. */
function memoryStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe('reading a stored preference', () => {
  it('defaults to system and violet when nothing is stored', () => {
    expect(readStoredTheme(memoryStorage())).toEqual(DEFAULT_THEME);
    expect(DEFAULT_THEME.appearance).toBe('system');
  });

  it('round-trips a written preference', () => {
    const storage = memoryStorage();
    const preference: ThemePreference = { appearance: 'dark', accent: 'cyan' };
    writeStoredTheme(storage, preference);
    expect(readStoredTheme(storage)).toEqual(preference);
  });

  it.each([
    ['not JSON at all', 'not json'],
    ['a JSON primitive', '"dark"'],
    ['null', 'null'],
  ])('falls back to the default for %s', (_label, raw) => {
    expect(readStoredTheme(memoryStorage(raw))).toEqual(DEFAULT_THEME);
  });

  it('keeps the valid half of a partly-corrupt preference', () => {
    // Losing someone's accent because their appearance failed to parse is a
    // worse outcome than either failure on its own.
    const stored = readStoredTheme(
      memoryStorage(JSON.stringify({ appearance: 'sideways', accent: 'rose' })),
    );
    expect(stored).toEqual({ appearance: DEFAULT_THEME.appearance, accent: 'rose' });
  });

  it('rejects an accent outside the curated set', () => {
    const stored = readStoredTheme(
      memoryStorage(JSON.stringify({ appearance: 'dark', accent: '#ff0000' })),
    );
    expect(stored).toEqual({ appearance: 'dark', accent: DEFAULT_THEME.accent });
  });

  it('survives storage that throws, rather than taking the page down with it', () => {
    const hostile = {
      getItem: () => {
        throw new Error('site data disabled');
      },
      setItem: () => {
        throw new Error('site data disabled');
      },
    } as unknown as Storage;

    expect(readStoredTheme(hostile)).toEqual(DEFAULT_THEME);
    expect(() => writeStoredTheme(hostile, { appearance: 'dark', accent: 'green' })).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Applying to the document                                                    */
/* -------------------------------------------------------------------------- */

describe('applying a preference to the document', () => {
  it('stamps data-theme for an explicit choice', () => {
    const root = document.createElement('html');
    applyTheme(root, { appearance: 'dark', accent: 'amber' });
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-accent')).toBe('amber');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('REMOVES data-theme under system, so prefers-color-scheme can win', () => {
    // The three-state contract: the absence of the attribute is what hands
    // control to the media query. Setting data-theme="system" would match no
    // block in tokens.css and silently strand the page on the dark defaults.
    const root = document.createElement('html');
    applyTheme(root, { appearance: 'dark', accent: 'violet' });
    applyTheme(root, { appearance: 'system', accent: 'violet' });
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.style.colorScheme).toBe('light dark');
  });
});

describe('resolving what system means', () => {
  it.each([
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ])('leaves an explicit %s alone whatever the device says', (appearance, dark, expected) => {
    expect(resolveAppearance(appearance as 'light' | 'dark', dark)).toBe(expected);
  });

  it('follows the device under system', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
  });
});

/* -------------------------------------------------------------------------- */
/* Contrast — every accent, every appearance                                   */
/* -------------------------------------------------------------------------- */

/*
 * Resolved from the working directory rather than `import.meta.url`: Vitest
 * runs this file through a transform whose module URL is not a file URL, and
 * the project may be invoked from the repo root or from apps/web.
 */
const TOKENS = ['src/styles/tokens.css', 'apps/web/src/styles/tokens.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
if (TOKENS === undefined) throw new Error('tokens.css not found from ' + process.cwd());
const CSS = readFileSync(TOKENS, 'utf8');

/**
 * Pulls `--name: #hex;` out of the first block whose selector matches.
 *
 * `selector` is a LITERAL CSS selector; every regex metacharacter is escaped
 * here so call sites stay readable and cannot get the escaping wrong.
 */
function tokenIn(selector: string, name: string): string {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`${literal}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (block === null) throw new Error(`no block for ${selector}`);
  const found = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block[1] ?? '');
  if (found === null) throw new Error(`no --${name} in ${selector}`);
  return found[1] as string;
}

function channel(component: number): number {
  const c = component / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return (
    0.2126 * channel(rgb[0] as number) +
    0.7152 * channel(rgb[1] as number) +
    0.0722 * channel(rgb[2] as number)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('WCAG AA contrast, computed from the shipped stylesheet', () => {
  // Grounds an accent can land on, read from the appearance blocks themselves.
  const darkBg = tokenIn(':root', 'bg');
  const darkSurface = tokenIn(':root', 'surface');
  const lightBg = tokenIn(":root[data-theme='light']", 'bg');
  const lightSurface = tokenIn(":root[data-theme='light']", 'surface');

  it('reads the grounds it is about to test against', () => {
    expect(darkBg).toBe('#0b0a12');
    expect(lightBg).toBe('#f2f1f9');
  });

  it.each([...ACCENTS])('%s clears 4.5:1 everywhere it is used', (accent) => {
    // Violet is also the bare-`:root` default, but it carries its own
    // data-accent block too, so one selector shape reads every accent.
    const selector = `:root[data-accent='${accent}']`;
    const onDark = tokenIn(selector, 'a-on-dark');
    const onLight = tokenIn(selector, 'a-on-light');
    const fill = tokenIn(selector, 'a-fill');

    // Accent text on both dark grounds.
    expect(contrast(onDark, darkBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(onDark, darkSurface)).toBeGreaterThanOrEqual(4.5);
    // Accent text on both light grounds.
    expect(contrast(onLight, lightBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(onLight, lightSurface)).toBeGreaterThanOrEqual(4.5);
    // White label on the accent's own fill — the primary button.
    expect(contrast('#ffffff', fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('checks every accent the product offers, not a subset', () => {
    // Guards the loop above: adding an accent to ACCENTS without adding a
    // block to tokens.css must fail here rather than ship unchecked.
    expect(ACCENTS.length).toBe(5);
    for (const accent of ACCENTS) {
      expect(CSS).toContain(`data-accent='${accent}'`);
    }
  });

  it('offers exactly the three appearances the tokens support', () => {
    expect([...APPEARANCES]).toEqual(['light', 'dark', 'system']);
  });
});

describe('the storage key', () => {
  it('is NOT account-scoped, because a theme belongs to the device', () => {
    // Repository keys look like `gradtools:v1:u:<id>:...`. A theme deliberately
    // does not, so it survives sign-out and never enters a sync payload.
    expect(THEME_STORAGE_KEY).toBe('gradtools:v1:theme');
    expect(THEME_STORAGE_KEY).not.toContain(':u:');
    expect(THEME_STORAGE_KEY).not.toContain('anon');
  });
});
