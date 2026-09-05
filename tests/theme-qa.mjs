/**
 * Every palette the theme control can produce, in a real browser.
 *
 * Authority: docs/22 §22.30 · M9.6 §32, §44
 *
 * `theme.test.ts` computes contrast from the stylesheet, which proves the
 * TOKENS are sound. It cannot prove the tokens reach the pixels: a component
 * with a hard-coded colour, or a rule that only ever matched the default
 * accent, passes that test and still ships a broken palette. This drives the
 * built application through all ten appearance x accent combinations and runs
 * axe against each one.
 *
 * Ten palettes x every route x nine widths would be 1,170 axe runs and roughly
 * an hour. The matrix here is deliberately narrower: the widths where layout
 * actually changes, and the routes that between them use every token group --
 * metrics, tables, chips, empty states, forms.
 *
 *   node tests/theme-qa.mjs
 *
 * Screenshots land in .qa/theme/, which is gitignored. Regenerate it; do not
 * expect it in a clone.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { isApiDown } from './lib/console.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/theme');
const PORT = 4322; // the origin the API allows (tests/README) — an ad-hoc port fails CORS

const APPEARANCES = ['light', 'dark'];
const ACCENTS = ['violet', 'cyan', 'amber', 'rose', 'green'];

/*
 * The widths a student actually uses: the narrowest phone the product supports,
 * a common phone, a tablet, and three desktop sizes. Every palette is checked
 * at each, because a contrast or overflow fault usually shows at one width and
 * one appearance rather than everywhere (M10A.9 §34).
 */
const VIEWPORTS = [
  { name: '320', width: 320, height: 720 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

const ROUTES = [
  ['/', 'dashboard'],
  ['/results', 'results'],
  ['/import', 'import'],
  ['/timetable', 'timetable'],
  ['/account', 'account'],
];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    let file = join(DIST, url === '/' ? 'index.html' : url);
    if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const problems = [];
  let apiDown = 0;
  let checks = 0;

  for (const vp of VIEWPORTS) {
    for (const appearance of APPEARANCES) {
      for (const accent of ACCENTS) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          /*
           * Deliberately the OPPOSITE of the appearance under test. If the
           * explicit choice is honoured, the OS preference must not show
           * through -- and a bug where data-theme is ignored would otherwise
           * hide behind a matching system preference.
           */
          colorScheme: appearance === 'light' ? 'dark' : 'light',
        });
        await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
        await context.addInitScript(
          ([a, c]) => {
            // Runs inside the page, so `window` is the right root here; the
            // bare global reads as undefined to the Node-targeted linter.
            window.localStorage.setItem(
              'gradtools:v1:theme',
              JSON.stringify({ appearance: a, accent: c }),
            );
          },
          [appearance, accent],
        );

        const page = await context.newPage();
        const errors = [];
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(String(e)));

        for (const [path, name] of ROUTES) {
          const label = `${name}@${vp.name}/${appearance}/${accent}`;
          await page.goto(`http://localhost:${PORT}${path}`);
          await page.waitForTimeout(300);

          // The attributes actually reached the document.
          const applied = await page.evaluate(() => ({
            theme: document.documentElement.getAttribute('data-theme'),
            accent: document.documentElement.getAttribute('data-accent'),
            bg: getComputedStyle(document.body).backgroundColor,
            accentColor: getComputedStyle(document.documentElement)
              .getPropertyValue('--accent')
              .trim(),
          }));
          if (applied.theme !== appearance) {
            problems.push(`THEME ${label}: data-theme=${applied.theme}`);
          }
          if (applied.accent !== accent) {
            problems.push(`ACCENT ${label}: data-accent=${applied.accent}`);
          }
          // A blank --accent means the accent block never matched.
          if (!applied.accentColor) problems.push(`TOKEN ${label}: --accent resolved empty`);

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          if (overflow > 0) problems.push(`OVERFLOW ${label}: ${overflow}px`);

          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          for (const v of axe.violations) {
            problems.push(`AXE ${label}: ${v.id} (${v.nodes.length}) ${v.help}`);
          }

          checks += 1;
          if (name === 'dashboard') {
            await page.screenshot({
              path: join(OUT, `${vp.name}-${appearance}-${accent}.png`),
              fullPage: false,
            });
          }
        }

        /*
         * The API is not running during this sweep and is not meant to be: the
         * harness serves the built bundle and nothing else, so the reference
         * and announcement fetches to localhost:3001 are refused. Whether that
         * is logged before this line is a race, which made the sweep pass and
         * then fail with no code change between. Counted, not tolerated —
         * anything else in the console still fails the run (docs/22 §22.68).
         */
        for (const e of errors) {
          if (isApiDown(e)) apiDown += 1;
          else problems.push(`CONSOLE ${appearance}/${accent}: ${e}`);
        }
        await context.close();
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* The accent picker offers five DIFFERENT colours                     */
  /* ---------------------------------------------------------------- */

  /*
   * The picker used to offer five identical circles. Each swatch sets
   * `data-accent` on itself to paint its own hue, but the accent blocks were
   * scoped to `:root`, so the attribute matched nothing and every swatch
   * inherited the root's fill. The palette looked broken because it was, and
   * no test could see it: the tokens were correct, the markup was correct, and
   * the cascade between them was not.
   *
   * This reads the colours the browser actually paints.
   */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(() => localStorage.removeItem('gradtools:v1:theme'));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);

    /* Light is the default for a device with no stored preference (§26). */
    const applied = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }));
    checks += 1;
    if (applied.theme !== 'light') {
      problems.push(`DEFAULT: a device with no preference rendered "${String(applied.theme)}", not light`);
    }

    const toggle = page.getByRole('button', { name: /appearance|theme/i }).first();
    if ((await toggle.count()) === 0) {
      problems.push('THEME: no appearance control was reachable from the app bar');
    } else {
      await toggle.click();
      await page.waitForTimeout(400);

      const swatches = page.locator('[data-accent]');
      const colours = await swatches.evaluateAll((nodes) =>
        nodes
          .filter((node) => node.tagName === 'BUTTON')
          .map((node) => ({
            accent: node.getAttribute('data-accent'),
            fill: getComputedStyle(node).backgroundColor,
            label: node.getAttribute('aria-label'),
          })),
      );

      checks += 1;
      if (colours.length !== ACCENTS.length) {
        problems.push(`ACCENTS: found ${String(colours.length)} swatches, expected ${String(ACCENTS.length)}`);
      }
      const distinct = new Set(colours.map((entry) => entry.fill));
      if (distinct.size !== colours.length) {
        problems.push(
          `ACCENTS: ${String(colours.length)} swatches painted only ${String(distinct.size)} distinct colours`,
        );
      }
      if (colours.some((entry) => (entry.label ?? '') === '')) {
        problems.push('ACCENTS: a swatch has no accessible name');
      }

      /* And the appearance options are reachable by keyboard. */
      const options = await page.getByRole('radio').count();
      const buttons = await page.getByRole('button', { name: /light|dark|system/i }).count();
      checks += 1;
      if (options + buttons < 3) {
        problems.push('THEME: fewer than three appearance options were exposed');
      }

      await page.screenshot({ path: join(OUT, 'appearance-popover.png') });
    }
    await context.close();
  }

  /* ---------------------------------------------------------------- */
  /* System follows the device, in BOTH directions                       */
  /* ---------------------------------------------------------------- */

  /*
   * "System" is the absence of `data-theme`, which is what lets
   * prefers-color-scheme decide. Checking only one direction would pass on a
   * build that hard-coded either answer (§53).
   */
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(() =>
      localStorage.setItem(
        'gradtools:v1:theme',
        JSON.stringify({ appearance: 'system', accent: 'violet' }),
      ),
    );
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);

    const seen = await page.evaluate(() => ({
      stamped: document.documentElement.hasAttribute('data-theme'),
      ground: getComputedStyle(document.body).backgroundColor,
    }));

    checks += 1;
    if (seen.stamped) {
      problems.push(`SYSTEM/${scheme}: data-theme was stamped, so the device cannot decide`);
    }
    /* A dark ground is dark; a light one is not. Read, not assumed. */
    const channels = /(\d+)\D+(\d+)\D+(\d+)/.exec(seen.ground);
    const luminance =
      channels === null
        ? -1
        : (Number(channels[1]) + Number(channels[2]) + Number(channels[3])) / 3;
    if (scheme === 'dark' && luminance > 90) {
      problems.push(`SYSTEM/dark: the ground rendered light (${seen.ground})`);
    }
    if (scheme === 'light' && luminance < 160) {
      problems.push(`SYSTEM/light: the ground rendered dark (${seen.ground})`);
    }
    await context.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${checks} page checks across ${APPEARANCES.length * ACCENTS.length} palettes`);
  if (apiDown > 0)
    console.log(`${String(apiDown)} API-unavailable console messages (not frontend defects)`);
  if (problems.length === 0) {
    console.log('CLEAN — no axe violations, no overflow, no console errors, all palettes applied');
  } else {
    console.log(`${problems.length} problems:`);
    for (const p of problems) console.log('  ' + p);
  }
  process.exit(problems.length === 0 ? 0 : 1);
};

run();
