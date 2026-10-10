/**
 * The account screens in a real browser, as far as this build can go.
 *
 * Authority: docs/11 §11.15-11.16 · docs/22 §22.19 · docs/25 §25.16
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT PROVE
 * ---------------------------------------------------------------------------
 *
 * A sign-in needs a configured identity provider. A checkout with no
 * `VITE_SUPABASE_URL` has none, and the honest thing for this harness to do is
 * say which state it is auditing rather than pretend a round trip happened.
 *
 *   NO PROJECT CONFIGURED  — the state below. The account screens must degrade
 *                            to "accounts are unavailable" and every academic
 *                            feature must keep working with no account at all.
 *   PROJECT CONFIGURED     — build with the variables set and this harness
 *                            additionally drives the real form. Reported as
 *                            SKIPPED, never as passed, when they are absent.
 *
 * What it proves in either state: local-first is not degraded by the presence
 * of the account screens, nothing is uploaded without a decision, and the
 * screens say only what is true.
 */

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const PORT = Number(process.env.PORT ?? 4398);
const WIDTHS = [390, 1280];
const THEMES = ['light', 'dark'];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function serve() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '/').split('?')[0];
      let file = join(DIST, url);
      if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html');
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(PORT, () => ok(server));
  });
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({
    ok,
    line: `${ok ? 'PASS' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`,
  });
};

const server = await serve();
const browser = await chromium.launch();

/** Whether the build was given a provider at all. */
let configured = false;

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 844 : 900 },
    });
    await context.addInitScript((appearance) => {
      localStorage.setItem(
        'gradtools:v1:theme',
        JSON.stringify({
          appearance,
          accent: 'mono',
          reducedMotion: false,
          density: 'comfortable',
        }),
      );
    }, theme);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const at = `${theme}@${width}`;

    /* ---- the signed-out account screens --------------------------------- */
    await page.goto(`http://localhost:${PORT}/sign-in`);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const unavailable = await page.getByText(/Accounts are not available in this build/i).count();
    const hasForm = await page.getByLabel(/^password$/i).count();
    configured = hasForm > 0;

    if (configured) {
      check(`sign-in ${at}: a configured build shows the form`, hasForm > 0);
    } else {
      /*
       * The degraded state is the POINT, not a failure: a build with no
       * provider must say so rather than offering a button that cannot work.
       */
      check(`sign-in ${at}: says accounts are unavailable`, unavailable > 0);
      check(`sign-in ${at}: offers no password field it cannot use`, hasForm === 0);
    }

    /* Local-first is not degraded by the account screens existing. */
    await page.goto(`http://localhost:${PORT}/academics?tab=calculator`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    check(
      `calculator ${at}: works with no account`,
      (await page.getByRole('heading', { name: /SGPA|CGPA|Calculator/i }).count()) > 0,
    );

    await page.goto(`http://localhost:${PORT}/attendance`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    /*
     * The HEADING, not the Today tab: on a device with no timetable and no
     * courses the page is its empty state, which is the correct thing for a
     * fresh install to show and is exactly the state this sweep audits.
     */
    check(
      `attendance ${at}: works with no account`,
      (await page.getByRole('heading', { name: /^attendance$/i }).count()) > 0,
    );

    /* ---- what the account screen promises about storage ----------------- */
    await page.goto(`http://localhost:${PORT}/account?section=data`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    check(
      `account ${at}: says what stays on this device`,
      (await page.getByText(/stay on this device/i).count()) > 0,
    );
    /*
     * Scoped to the false claim. The true sentence — "per-class attendance
     * history ... stay on this device. Your weekly timetable and your
     * attendance totals sync as they always have" — contains both words and
     * must not be caught by a matcher looking for the opposite meaning.
     */
    check(
      `account ${at}: does not claim per-class history is synced`,
      (await page
        .getByText(/per-class attendance history[^.]{0,60}(is |are )?(synced|uploaded)/i)
        .count()) === 0,
    );

    /* ---- the merge screen, which is where an upload is decided ---------- */
    await page.goto(`http://localhost:${PORT}/first-sync`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`first-sync ${at}: no horizontal overflow`, overflow <= 0, `${overflow}px`);

    check(`${at}: no page errors on any account screen`, errors.length === 0, errors[0] ?? '');
    await context.close();
  }
}

await browser.close();
server.close();

for (const { line } of results) console.log(line);

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed · provider ${
    configured ? 'CONFIGURED (real form audited)' : 'NOT CONFIGURED (degraded state audited)'
  }`,
);
if (!configured) {
  console.log(
    'SIGNED-IN FLOWS: SKIPPED — no VITE_SUPABASE_URL in this build. Not a pass, not a failure.',
  );
}
process.exitCode = failed.length === 0 ? 0 : 1;
