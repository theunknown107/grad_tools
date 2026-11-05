/**
 * Liquid glass: the level is stored, survives a bad value, reaches the page,
 * and Solid / the system setting make every surface opaque again. Themes is
 * its own destination (More -> Themes).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESTINATIONS } from '../src/components/layout/nav.js';
import { DEFAULT_THEME, THEME_STORAGE_KEY, applyTheme, readStoredTheme } from '../src/lib/theme.js';

const STYLESHEET = ['src/styles/index.css', 'apps/web/src/styles/index.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate)) as string;
const CSS = readFileSync(STYLESHEET, 'utf8');
const stored = (value: unknown) => ({
  getItem: (key: string) => (key === THEME_STORAGE_KEY ? JSON.stringify(value) : null),
});

describe('the glass level', () => {
  it('defaults to regular, keeps a valid choice and drops a bad one', () => {
    expect(DEFAULT_THEME.glass).toBe('regular');
    expect(readStoredTheme(stored({ glass: 'clear' })).glass).toBe('clear');
    expect(readStoredTheme(stored({ glass: 'mirror' })).glass).toBe('regular');
    expect(readStoredTheme(stored({ accent: 'mono' })).glass).toBe('regular');
  });

  it('reaches the page as data-glass', () => {
    const root = document.createElement('html');
    applyTheme(root, { ...DEFAULT_THEME, glass: 'frosted' });
    expect(root.getAttribute('data-glass')).toBe('frosted');
  });

  it('is solid without a level, under Solid and under the system setting', () => {
    expect(CSS).toMatch(/:root \{\s*--gt-glass: 100%;/);
    expect(CSS).toMatch(/\[data-transparency='reduced'\] \{\s*--gt-glass: 100%;/);
    expect(CSS).toMatch(
      /prefers-reduced-transparency: reduce\) \{\s*:root\[data-glass\] \{\s*--gt-glass: 100%;/,
    );
  });

  it('keeps overlays readable over text whatever the level', () => {
    expect(CSS).toMatch(
      /\.gt-overlay \{\s*background-color: color-mix\(in oklab, var\(--panel\) max\(var\(--gt-glass\), 82%\)/,
    );
  });
});

describe('Themes', () => {
  it('is its own destination, in the Account group the More sheet lists', () => {
    const themes = DESTINATIONS.find((destination) => destination.to === '/themes');
    expect(themes?.group).toBe('Account');
    expect(DESTINATIONS.find((d) => d.to === '/account')?.keywords).not.toMatch(/appearance/);
  });
});
