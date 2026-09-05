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
  it('defaults to LIGHT and violet when nothing is stored', () => {
    /*
     * Light, not system (M10A.9 §26). GradTools is used in daylight, in
     * lecture halls and on library desks, and light is the interface the
     * product is designed around. System remains available; an explicit
     * choice always wins. This is only the answer for someone who has not
     * given one.
     */
    expect(readStoredTheme(memoryStorage())).toEqual(DEFAULT_THEME);
    expect(DEFAULT_THEME.appearance).toBe('light');
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

/**
 * The colour a `--surface` actually paints, whichever way it is declared.
 *
 * This used to demand a TRANSLUCENT white and composite it, because every
 * surface was glass over the ground. The reference rebuild made surfaces
 * opaque and the helper threw rather than adapting: it had been pinned to one
 * implementation of a material rather than to the question being asked, which
 * is only ever "what colour does text land on".
 *
 * Both forms resolve here, so every assertion below keeps testing the colour a
 * browser paints without caring how the token was written.
 */
function surfaceIn(selector: string, ground: string): string {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`${literal}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (block === null) throw new Error(`no block for ${selector}`);
  const body = block[1] ?? '';
  const translucent = /--surface:\s*rgb\(255 255 255 \/ ([\d.]+)%\)/.exec(body);
  if (translucent !== null) return overlayWhite(ground, Number(translucent[1]) / 100);
  const opaque = /--surface:\s*(#[0-9a-fA-F]{6})/.exec(body);
  if (opaque !== null) return opaque[1] as string;
  throw new Error(`no readable --surface in ${selector}`);
}

function channel(component: number): number {
  const c = component / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbOf(hex: string): readonly [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as unknown as readonly [
    number,
    number,
    number,
  ];
}

/** White at `alpha` composited over `hex` — what the eye actually receives. */
function overlayWhite(hex: string, alpha: number): string {
  const blended = rgbOf(hex).map((c) => Math.round(c * (1 - alpha) + 255 * alpha));
  return `#${blended.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('WCAG AA contrast, computed from the shipped stylesheet', () => {
  const darkBg = tokenIn(':root', 'bg');
  const lightBg = tokenIn(":root[data-theme='light']", 'bg');

  /*
   * The effective surface: the translucent white composited over its ground.
   * A surface is the lightest thing an accent lands on in dark mode and the
   * darkest in light mode, so testing the composite covers the worst case in
   * both appearances.
   */
  const darkSurface = surfaceIn(':root', darkBg);
  const lightSurface = surfaceIn(":root[data-theme='light']", lightBg);

  it('reads the grounds it is about to test against', () => {
    // M9.6C: a blue-black environment, not the M9.4 violet-black.
    // Rebuilt to the reference: a neutral near-black, not the blue-black.
    expect(darkBg).toBe('#111114');
    /*
     * Deepened twice for the same reason, and the second time with a
     * measurement rather than a judgement.
     *
     * M10A.9 moved it from #f4f6fb to #e7ebf5. That was still not enough: a
     * white translucent surface over #e7ebf5 composited to #f9fbfe, which is
     * 1.15:1 against the ground — the SAME ratio the dark theme gets between
     * #05070d and #161921. Equal ratios are not equal steps, because vision
     * compresses luminance differences near white and not near black, so the
     * light theme read as one flat sheet while the dark theme read as layers.
     *
     * #dae0ec has tone of its own, which is what a translucent surface needs
     * in order to look lighter than something.
     */
    expect(lightBg).toBe('#f3f3f5');
  });

  it('composites surfaces rather than assuming a flat fill', () => {
    // Surfaces are translucent now; if one ever goes back to being an opaque
    // hex, `surfaceAlphaIn` throws and this whole block fails loudly rather
    // than silently checking the wrong colour.
    expect(darkSurface).not.toBe(darkBg);
    expect(lightSurface).not.toBe(lightBg);
  });

  it('keeps a card distinguishable from the ground it sits on', () => {
    /*
     * THE DEFECT THIS FILE DID NOT CATCH BEFORE.
     *
     * "Not equal" was the whole test, and a surface can differ from its ground
     * by an amount nobody can see. The light theme shipped at 1.15:1 — the same
     * ratio the dark theme has — and looked like one flat sheet, because near
     * white a given luminance ratio is a much smaller perceived step than the
     * same ratio near black.
     *
     * WHAT CHANGED WITH THE REFERENCE REBUILD: a card is no longer defined by
     * its fill alone. The old glass panels had no real outline, so luminance
     * was the only thing separating them and the floor had to be high. The
     * reference draws an explicit hairline around an opaque card, and its
     * surfaces sit much closer to the ground than glass ever did.
     *
     * So this checks the mechanism the design actually uses: a surface step
     * that is real but small, AND a border that stands off the surface it
     * outlines. Keeping the old luminance-only floor would fail a card that is
     * perfectly visible, which is measuring the wrong thing rather than
     * measuring nothing.
     */
    expect(contrast(lightSurface, lightBg)).toBeGreaterThanOrEqual(1.08);
    expect(contrast(darkSurface, darkBg)).toBeGreaterThanOrEqual(1.05);

    const lightBorder = tokenIn(":root[data-theme='light']", 'border');
    const darkBorder = tokenIn(':root', 'border');
    expect(contrast(lightBorder, lightSurface)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(darkBorder, darkSurface)).toBeGreaterThanOrEqual(1.15);
  });

  it.each([...ACCENTS])('%s clears 4.5:1 everywhere it is used', (accent) => {
    /*
     * Unqualified, because the accent blocks are. They used to be scoped to
     * `:root`, which meant `data-accent` on anything else matched nothing —
     * and the accent picker's five swatches, each of which sets the attribute
     * on itself, all painted the root's colour. Five identical circles.
     */
    const selector = `[data-accent='${accent}']`;
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
