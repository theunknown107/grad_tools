/**
 * Generates every launcher, splash and favicon asset from the supplied brand
 * logo.
 *
 *   pnpm --filter @gradtools/web android:icons
 *
 * Source of truth: src/brand/gradtools-logo.png — the official asset, black
 * line art on a solid white ground, used AS-IS (no recolour, no knock-out).
 * Nothing here redraws it; it is only placed and scaled.
 *
 *   drawable-nodpi/ic_launcher_foreground.png  the logo on white, inset into the
 *                                              adaptive icon's safe zone.
 *   values/ic_launcher_background.xml          the icon ground (white).
 *   mipmap-anydpi-v26/ic_launcher*.xml         adaptive icon: white background +
 *                                              the foreground above. No
 *                                              monochrome layer — a white-ground
 *                                              raster has no alpha to tint.
 *   mipmap-<density>/ic_launcher*.png          legacy icons (API 24–25): the
 *                                              logo on a white tile per density.
 *   drawable/splash.xml                        pre-Android-12 launch: white
 *                                              ground, logo centred.
 *   public/gradtools-favicon.png               the browser favicon.
 *
 * The art's true bounding box is measured so the adaptive mask never clips the
 * cap, whatever padding the asset carries. Re-run after changing the logo;
 * commit the output.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(WEB, 'android/app/src/main/res');
const BRAND = '#FFFFFF';

const png = await readFile(join(WEB, 'src/brand/gradtools-logo.png'));
const SRC = `data:image/png;base64,${png.toString('base64')}`;

const write = async (path, text) => {
  await mkdir(dirname(join(RES, path)), { recursive: true });
  await writeFile(join(RES, path), text);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();

  /*
   * The fraction of the asset's square that the art actually fills (its own
   * padding varies). Everything below is sized against this, so the art lands
   * where intended no matter how much whitespace the asset carries.
   */
  const artFraction = await page.evaluate(async (src) => {
    /* global document, Image -- this runs in the browser, not in Node. */
    const S = 256;
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    let minX = S;
    let minY = S;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        // Non-white (ink) pixel: the logo art, not its ground.
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return Math.max(maxX - minX, maxY - minY) / S;
  }, SRC);

  /** The asset on a white box of `size`, its art filling `artTarget` of it. */
  const render = async (path, size, { radius = '0', artTarget, transparent = false } = {}) => {
    const box = Math.min(1, artTarget / artFraction) * size;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div style="width:${size}px;height:${size}px;border-radius:${radius};overflow:hidden;background:${BRAND};display:flex;align-items:center;justify-content:center">
        <img src="${SRC}" style="width:${box}px;height:${box}px;object-fit:contain" />
      </div></body></html>`);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, omitBackground: transparent });
  };

  // Adaptive foreground: one nodpi raster, art within the 66dp safe zone (0.60).
  await render(join(RES, 'drawable-nodpi/ic_launcher_foreground.png'), 432, { artTarget: 0.6 });

  // Favicon: the logo nearly filling a 256² square.
  await render(join(WEB, 'public/gradtools-favicon.png'), 256, { artTarget: 0.84 });

  // Legacy launcher icons: the logo on a white tile, per density.
  const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, px] of Object.entries(DENSITIES)) {
    for (const [name, radius] of [
      ['ic_launcher', '22%'],
      ['ic_launcher_round', '50%'],
    ]) {
      await render(join(RES, `mipmap-${density}`, `${name}.png`), px, {
        radius,
        artTarget: 0.72,
        transparent: true,
      });
    }
  }
} finally {
  await browser.close();
}

await write(
  'values/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BRAND}</color>
</resources>
`,
);

// No monochrome layer: the asset is used as-is, white ground and all.
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;
await write('mipmap-anydpi-v26/ic_launcher.xml', adaptive);
await write('mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);

await write(
  'drawable/splash.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/android-icons.mjs. -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/ic_launcher_background" />
    <item
        android:width="108dp"
        android:height="108dp"
        android:drawable="@drawable/ic_launcher_foreground"
        android:gravity="center" />
</layer-list>
`,
);

/* The old vector foreground would now collide with the raster of the same name. */
const stale = [
  'drawable/ic_launcher_foreground.xml',
  'drawable-v24/ic_launcher_foreground.xml',
  'drawable/ic_launcher_background.xml',
  'drawable/splash.png',
  ...['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map(
    (density) => `mipmap-${density}/ic_launcher_foreground.png`,
  ),
  ...['land', 'port'].flatMap((o) =>
    ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map(
      (density) => `drawable-${o}-${density}/splash.png`,
    ),
  ),
];
for (const path of stale) await rm(join(RES, path), { force: true });

console.log('Launcher, splash and favicon generated from gradtools-logo.png');
