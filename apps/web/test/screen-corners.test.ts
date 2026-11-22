/**
 * Rounded screen corners (Android app): edge-anchored surfaces curve with the
 * display instead of being clipped by it, and nothing changes on a square
 * screen or in a browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCorners } from '../src/lib/system-appearance.js';

const STYLESHEET = ['src/styles/index.css', 'apps/web/src/styles/index.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate)) as string;
const CSS = readFileSync(STYLESHEET, 'utf8');

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-rounded-screen');
});

describe('the screen corners the native side reports', () => {
  it('reach CSS, and mark a rounded screen', () => {
    const root = document.documentElement;
    applyCorners(root, { top: 50, bottom: 50 });
    expect(root.style.getPropertyValue('--gt-corner-bottom')).toBe('50px');
    expect(root.hasAttribute('data-rounded-screen')).toBe(true);
  });

  it('unmark the screen when the window no longer touches a rounded corner', () => {
    const root = document.documentElement;
    applyCorners(root, { top: 50, bottom: 50 });
    applyCorners(root, { top: 0, bottom: 0 }); // e.g. the top half of split screen
    expect(root.hasAttribute('data-rounded-screen')).toBe(false);
  });
});

describe('the surfaces that curve with them', () => {
  it('default to square corners, so a browser is unchanged', () => {
    expect(CSS).toMatch(/--gt-corner-bottom:\s*0px/);
  });

  it('keep the dock clear of the gesture bar AND inside the corner curve', () => {
    const dock = /--gt-dock-bottom:\s*([^;]+);/.exec(CSS)?.[1] ?? '';
    expect(dock).toContain('var(--gt-safe-bottom)');
    expect(dock).toContain('calc(var(--gt-corner-bottom) - 2rem)');
  });

  it('round a sheet concentrically with the screen', () => {
    expect(CSS).toContain('[data-rounded-screen] .gt-sheet');
    expect(CSS).toContain('calc(var(--gt-corner-bottom) - 0.5rem)');
  });
});
