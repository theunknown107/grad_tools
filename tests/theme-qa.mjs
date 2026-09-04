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
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/theme');
const PORT = 4322; // the origin the API allows (tests/README) — an ad-hoc port fails CORS

const APPEARANCES = ['light', 'dark'];
const ACCENTS = ['violet', 'cyan', 'amber', 'rose', 'green'];

/* 390 is a phone, 1280 the desktop composition. */
const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
];

const ROUTES = [
  ['/', 'dashboard'],
  ['/results', 'results'],
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

        for (const e of errors) problems.push(`CONSOLE ${appearance}/${accent}: ${e}`);
        await context.close();
      }
    }
  }

  await browser.close();
  server.close();

  console.log(`\n${checks} page checks across ${APPEARANCES.length * ACCENTS.length} palettes`);
  if (problems.length === 0) {
    console.log('CLEAN — no axe violations, no overflow, no console errors, all palettes applied');
  } else {
    console.log(`${problems.length} problems:`);
    for (const p of problems) console.log('  ' + p);
  }
  process.exit(problems.length === 0 ? 0 : 1);
};

run();
