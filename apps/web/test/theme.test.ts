/**
 * Theme preference, and the contrast of every accent it can produce.
 *
 * Authority: docs/05 §5.21 · docs/22 §22.30 (M9.6) · docs/27 §27.2
 *
 * The contrast block is the important half. Five accents times two appearances
 * is ten palettes, and nobody is going to eyeball ten palettes on every change.
 * So the ratios are COMPUTED FROM index.css: the test parses the stylesheet
 * that ships, not a copy of the values, which means a hue edited in CSS is
 * checked here without anyone remembering to update a fixture.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  ACCENT_GROUPS,
  ACCENT_INFO,
  APPEARANCES,
  accentName,
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
    const preference: ThemePreference = {
      appearance: 'dark',
      accent: 'turquoise',
      reducedMotion: false,
      reducedTransparency: false,
      glass: 'regular',
      density: 'comfortable',
    };
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
    // `reducedMotion` absent from storage reads as off, which is the whole
    // contract for a preference added after people already had stored ones.
    expect(stored).toEqual({
      appearance: DEFAULT_THEME.appearance,
      accent: 'rose',
      reducedMotion: false,
      reducedTransparency: false,
      glass: 'regular',
      density: 'comfortable',
    });
  });

  it('rejects an accent outside the curated set', () => {
    const stored = readStoredTheme(
      memoryStorage(JSON.stringify({ appearance: 'dark', accent: '#ff0000' })),
    );
    expect(stored).toEqual({
      appearance: 'dark',
      accent: DEFAULT_THEME.accent,
      reducedMotion: false,
      reducedTransparency: false,
      glass: 'regular',
      density: 'comfortable',
    });
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
    expect(() =>
      writeStoredTheme(hostile, {
        appearance: 'dark',
        accent: 'emerald',
        reducedMotion: false,
        reducedTransparency: false,
        glass: 'regular',
        density: 'comfortable',
      }),
    ).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Applying to the document                                                    */
/* -------------------------------------------------------------------------- */

describe('applying a preference to the document', () => {
  it('stamps data-theme for an explicit choice', () => {
    const root = document.createElement('html');
    applyTheme(root, {
      appearance: 'dark',
      accent: 'amber',
      reducedMotion: false,
      reducedTransparency: false,
      glass: 'regular',
      density: 'comfortable',
    });
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-accent')).toBe('amber');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('REMOVES data-theme under system, so prefers-color-scheme can win', () => {
    // The three-state contract: the absence of the attribute is what hands
    // control to the media query. Setting data-theme="system" would match no
    // meaningful value and leave the device's preference unapplied.
    const root = document.createElement('html');
    applyTheme(root, {
      appearance: 'dark',
      accent: 'violet',
      reducedMotion: false,
      reducedTransparency: false,
      glass: 'regular',
      density: 'comfortable',
    });
    applyTheme(root, {
      appearance: 'system',
      accent: 'violet',
      reducedMotion: false,
      reducedTransparency: false,
      glass: 'regular',
      density: 'comfortable',
    });
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
const STYLESHEET = ['src/styles/index.css', 'apps/web/src/styles/index.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
if (STYLESHEET === undefined) throw new Error('index.css not found from ' + process.cwd());
const CSS = readFileSync(STYLESHEET, 'utf8');

/**
 * Pulls `--name: #hex;` out of the first block whose selector is exactly
 * `selector` at the start of a line. `selector` is literal; metacharacters are
 * escaped here so call sites stay readable.
 */
function tokenIn(selector: string, name: string): string {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`(?:^|\\n)${literal}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (block === null) throw new Error(`no block for ${selector}`);
  const found = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(block[1] ?? '');
  if (found === null) throw new Error(`no --${name} in ${selector}`);
  return found[1] as string;
}

function channel(component: number): number {
  const c = component / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(value.slice(i, i + 2), 16))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const HALVES = [
  { name: 'light', root: ':root', accentPrefix: '' },
  { name: 'dark', root: '.dark', accentPrefix: '.dark' },
] as const;

const GROUNDS = ['canvas', 'panel', 'raised'] as const;

describe('WCAG AA contrast, computed from the shipped stylesheet', () => {
  it('ships the monochrome light ground by default', () => {
    expect(tokenIn(':root', 'canvas')).toBe('#f4f2ee');
    expect(tokenIn('.dark', 'canvas')).toBe('#070708');
    // The default accent is mono: the same near-black as body text.
    expect(tokenIn(':root', 'accent')).toBe(tokenIn(':root', 'text-primary'));
  });

  it.each(HALVES)('$name: every text tone reads on every surface', ({ root }) => {
    for (const ground of GROUNDS) {
      const bg = tokenIn(root, ground);
      for (const ink of ['text-primary', 'text-secondary', 'text-muted']) {
        expect(contrast(tokenIn(root, ink), bg), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(HALVES)('$name: status colours read as text and on their own tint', ({ root }) => {
    for (const tone of ['schedule', 'progress', 'success', 'warning', 'danger', 'info']) {
      const ink = tokenIn(root, tone);
      expect(
        contrast(ink, tokenIn(root, `${tone}-weak`)),
        `${tone} on its tint`,
      ).toBeGreaterThanOrEqual(4.5);
      for (const ground of GROUNDS) {
        expect(contrast(ink, tokenIn(root, ground)), `${tone} on ${ground}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it.each(HALVES)('$name: a card border stands off the surface it outlines', ({ root }) => {
    expect(contrast(tokenIn(root, 'border'), tokenIn(root, 'raised'))).toBeGreaterThanOrEqual(1.15);
    expect(contrast(tokenIn(root, 'panel'), tokenIn(root, 'canvas'))).toBeGreaterThanOrEqual(1.04);
  });

  it.each([...ACCENTS])(
    '%s: accent text and filled labels clear 4.5:1 in both appearances',
    (accent) => {
      for (const { name, root, accentPrefix } of HALVES) {
        const selector = `${accentPrefix}[data-accent='${accent}']`;
        const ink = tokenIn(selector, 'accent-ink');
        for (const ground of GROUNDS) {
          expect(
            contrast(ink, tokenIn(root, ground)),
            `${name} accent-ink on ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        const fill = tokenIn(selector, 'accent');
        const label = tokenIn(selector, 'accent-contrast');
        expect(contrast(label, fill), `${name} label on fill`).toBeGreaterThanOrEqual(4.5);
        // A filled control must still be visible as a shape against the page.
        expect(
          contrast(fill, tokenIn(root, 'canvas')),
          `${name} fill on canvas`,
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('checks every accent the product offers, not a subset', () => {
    // 12 current + 5 original (Aug 2026) + Crimson tinted. docs/51_THEMES.md.
    expect(ACCENTS.length).toBe(18);
    for (const accent of ACCENTS) {
      expect(CSS).toContain(`\n[data-accent='${accent}']`);
      expect(CSS).toContain(`\n.dark[data-accent='${accent}']`);
    }
  });

  it('never lets an accent block touch surfaces or status colours', () => {
    const accentBlocks = CSS.match(/\n(?:\.dark)?\[data-accent='[a-z-]+'\]\s*\{[^}]*\}/g) ?? [];
    expect(accentBlocks.length).toBe(36);
    for (const block of accentBlocks) {
      const names = [...block.matchAll(/--([a-z-]+):/g)].map((m) => m[1]);
      expect(
        names.every((n) =>
          ['accent', 'accent-weak', 'accent-ink', 'accent-contrast', 'ring'].includes(n ?? ''),
        ),
      ).toBe(true);
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

/* -------------------------------------------------------------------------- */
/* The full collection                                                         */
/* -------------------------------------------------------------------------- */

describe('the palette collection (docs/51_THEMES.md)', () => {
  it('names every palette, in three groups, with ids separate from names', () => {
    expect(ACCENT_GROUPS.map((group) => group.id)).toEqual(['current', 'original', 'new']);
    const byGroup = (group: string) =>
      ACCENTS.filter((accent) => ACCENT_INFO[accent].group === group).map(
        (accent) => ACCENT_INFO[accent].label,
      );
    expect(byGroup('current')).toEqual([
      'Mono',
      'Violet',
      'Matrix',
      'Crimson',
      'Turquoise',
      'Ocean',
      'Amber',
      'Rose',
      'Indigo',
      'Emerald',
      'Solar',
      'Slate',
    ]);
    expect(byGroup('original')).toEqual(['Violet', 'Cyan', 'Amber', 'Rose', 'Green']);
    expect(byGroup('new')).toEqual(['Crimson tinted']);
    // Three names repeat across groups, so the announced name says which.
    expect(accentName('original-violet')).toBe('Violet (original)');
    expect(accentName('violet')).toBe('Violet');
  });

  it('keeps original Violet, Amber and Rose distinct from their current namesakes', () => {
    for (const name of ['violet', 'amber', 'rose'] as const) {
      expect(tokenIn(`[data-accent='original-${name}']`, 'accent')).not.toBe(
        tokenIn(`[data-accent='${name}']`, 'accent'),
      );
    }
  });

  it.each([...ACCENTS])('%s: the selector swatch is the colour the stylesheet uses', (accent) => {
    expect(tokenIn(`[data-accent='${accent}']`, 'accent')).toBe(ACCENT_INFO[accent].light);
    expect(tokenIn(`.dark[data-accent='${accent}']`, 'accent')).toBe(ACCENT_INFO[accent].dark);
  });

  it('keeps production Crimson and Crimson tinted apart', () => {
    expect(tokenIn("[data-accent='crimson']", 'accent')).toBe('#8b0015');
    expect(tokenIn(".dark[data-accent='crimson']", 'accent')).toBe('#bd1a33');
    expect(tokenIn("[data-accent='crimson-tinted']", 'accent')).not.toBe('#8b0015');
    // Only Crimson tinted sets surfaces; production Crimson stays on the ground.
    expect(CSS).toContain("\nhtml.dark[data-accent='crimson-tinted'] {");
    expect(CSS).not.toContain("\nhtml[data-accent='crimson'] {");
  });

  it.each([
    {
      name: 'light',
      root: "html[data-accent='crimson-tinted']",
      accent: "[data-accent='crimson-tinted']",
    },
    {
      name: 'dark',
      root: "html.dark[data-accent='crimson-tinted']",
      accent: ".dark[data-accent='crimson-tinted']",
    },
  ])(
    'Crimson tinted $name: its text, accent and danger read on its own surfaces',
    ({ root, accent }) => {
      for (const ground of GROUNDS) {
        const bg = tokenIn(root, ground);
        for (const ink of ['text-primary', 'text-secondary', 'text-muted']) {
          expect(contrast(tokenIn(root, ink), bg), `${ink} on ${ground}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
        expect(
          contrast(tokenIn(accent, 'accent-ink'), bg),
          `accent-ink on ${ground}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokenIn(root, 'danger'), bg), `danger on ${ground}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      expect(
        contrast(tokenIn(root, 'danger'), tokenIn(root, 'danger-weak')),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokenIn(accent, 'accent-contrast'), tokenIn(accent, 'accent')),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokenIn(accent, 'accent'), tokenIn(root, 'canvas'))).toBeGreaterThanOrEqual(
        3,
      );
      expect(contrast(tokenIn(root, 'border'), tokenIn(root, 'raised'))).toBeGreaterThanOrEqual(
        1.15,
      );
      expect(contrast(tokenIn(root, 'panel'), tokenIn(root, 'canvas'))).toBeGreaterThanOrEqual(
        1.04,
      );
    },
  );
});

describe('saved themes from earlier versions', () => {
  const read = (accent: string) =>
    readStoredTheme(memoryStorage(JSON.stringify({ appearance: 'dark', accent }))).accent;

  it('keeps every new id as saved', () => {
    for (const accent of ACCENTS) expect(read(accent)).toBe(accent);
  });

  it('still carries the pre-September ids to the successor shown since then', () => {
    // A device that saved `cyan` has shown Turquoise since September; it does
    // not switch to the restored original on update. The originals have their
    // own ids, so choosing one is explicit.
    expect(read('cyan')).toBe('turquoise');
    expect(read('green')).toBe('emerald');
    expect(read('original-cyan')).toBe('original-cyan');
  });

  it('never turns a saved Crimson into Crimson tinted, or back', () => {
    expect(read('crimson')).toBe('crimson');
    expect(read('crimson-tinted')).toBe('crimson-tinted');
  });

  it('falls back to Mono for an id that never existed', () => {
    expect(read('crimson-glass')).toBe('mono');
  });
});

describe('reduced transparency', () => {
  it('is read, written and applied like reduced motion', () => {
    const storage = memoryStorage();
    const preference: ThemePreference = { ...DEFAULT_THEME, reducedTransparency: true };
    writeStoredTheme(storage, preference);
    expect(readStoredTheme(storage).reducedTransparency).toBe(true);
    const root = document.createElement('html');
    applyTheme(root, preference);
    expect(root.getAttribute('data-transparency')).toBe('reduced');
    applyTheme(root, { ...preference, reducedTransparency: false });
    expect(root.hasAttribute('data-transparency')).toBe(false);
  });

  it('makes every glass surface opaque, as the system setting does', () => {
    for (const material of ['.gt-bar', '.gt-float', '.gt-glass']) {
      expect(CSS).toContain(`[data-transparency='reduced'] ${material}`);
    }
  });
});
