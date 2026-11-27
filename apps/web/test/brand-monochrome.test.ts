/**
 * The app's identity is monochrome on every startup and branding surface: a
 * hollow black cap on white, never a red badge. These read the real shipped
 * sources — the stylesheet, the canonical mark and the generated Android
 * resources — so a stale red asset fails here, not on a phone.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/styles/index.css');
const RES = '../android/app/src/main/res/';

/** The body of the first `selector { … }` rule in the stylesheet. */
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
};

describe('the launch splash is black on white', () => {
  it('uses a white ground and black ink, with no red', () => {
    const splash = rule('.gt-splash');
    expect(splash).toMatch(/background:\s*#ffffff/i);
    expect(splash).toMatch(/color:\s*#000000/i);
    expect(splash).not.toMatch(/#8b0015/i);
  });

  it('stays white from the native splash to the overlay: no dark frame between', () => {
    expect(rule('html.gt-booting body')).toMatch(/background:\s*#ffffff/i);
    expect(JSON.parse(read('../capacitor.config.json')).backgroundColor).toBe('#ffffff');
    expect(read(`${RES}values/styles.xml`)).toMatch(
      /AppTheme\.NoActionBar"[\s\S]*?android:windowBackground">@color\/ic_launcher_background</,
    );
  });

  it('shows the brand logo and fades it in (no red, no draw-on)', () => {
    expect(css).toMatch(/\.gt-splash-mark > img/);
    expect(css).toMatch(/@keyframes gt-splash-mark/);
  });
});

describe('the in-app logo tile never takes the accent colour', () => {
  it('has no accent override for the brand surface', () => {
    expect(css).not.toMatch(/--brand-surface:\s*var\(--accent\)/);
    expect(css).toMatch(
      /--brand-surface:\s*var\(--raised\);\s*--brand-mark:\s*var\(--text-primary\);/,
    );
  });
});

describe('the official logo is the one brand asset everywhere', () => {
  it('is the supplied raster, read as-is by the header/splash and the favicon', () => {
    expect(() => read('../src/brand/gradtools-logo.png')).not.toThrow();
    expect(read('../src/brand/GradToolsLogo.tsx')).toMatch(/gradtools-logo\.png/);
    expect(read('../src/components/layout/LaunchSplash.tsx')).toMatch(/gradtools-logo\.png/);
    expect(read('../index.html')).toMatch(/rel="icon"[^>]*gradtools-favicon\.png/);
  });

  it('the old vector mark is no longer referenced by any surface', () => {
    for (const file of [
      '../src/brand/GradToolsLogo.tsx',
      '../src/components/layout/LaunchSplash.tsx',
      '../index.html',
    ]) {
      expect(read(file)).not.toMatch(/gradtools-mark\.svg/);
    }
  });

  it('the launcher ground is white, and the adaptive icon has no colour-tinted layer', () => {
    expect(read(`${RES}values/ic_launcher_background.xml`)).toMatch(/>#FFFFFF</i);
    const adaptive = read(`${RES}mipmap-anydpi-v26/ic_launcher.xml`);
    expect(adaptive).toMatch(/@color\/ic_launcher_background/);
    expect(adaptive).toMatch(/@drawable\/ic_launcher_foreground/);
    // A white-ground raster has no alpha to tint: no monochrome/themed layer.
    expect(adaptive).not.toMatch(/<monochrome/);
  });
});
