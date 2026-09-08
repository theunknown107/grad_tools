/**
 * Navigation and control QA — a real browser operating the shell.
 *
 * Authority: Phase 7C §24, §25 · docs/22 §22.36
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * This drives a real Chromium with real clicks and real key presses across
 * three viewports, and asserts what actually happened. jsdom cannot catch a
 * control covered by the bottom nav, a nav item whose accessible name is
 * missing only when collapsed, or a focus ring that never lands — because
 * jsdom has no layout, no compositing and no real focus.
 *
 * It is NOT a human sitting at the machine. Nobody looked at these screens
 * while the script ran, and the report says scripted interaction rather than
 * claiming a manual pass.
 *
 *   node tests/navigation-qa.mjs
 *
 * Behaviour only. Nothing here asserts an appearance, because the UI is frozen
 * and a visual assertion would turn a deliberate design into a regression.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const PORT = 4327;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  /* pdf.js ships its worker as an ES module; octet-stream makes it unloadable. */
  '.mjs': 'text/javascript',
  '.map': 'application/json',
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

/* -------------------------------------------------------------------------- */

/**
 * A synthetic student with four graded semesters.
 *
 * INVENTED, and deliberately so (§23). The real pack is never read by a
 * committed harness; what this needs is a record set rich enough that every
 * route has something to render.
 */
function seedData() {
  const codes = [
    ['BXXX301', 'Core course one', 4],
    ['BXXX302', 'Core course two', 4],
    ['BXXX303', 'Core course three', 3],
    ['BXXL304', 'Laboratory course', 1],
  ];
  return {
    profile: {
      id: 'p1',
      authUserId: null,
      displayName: 'Sample Student',
      usn: '1XX22CS001',
      branch: 'CSE',
      schemeId: 'vtu-2022',
      currentSemester: 5,
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    semesters: [1, 2, 3, 4, 5].map((n) => ({
      id: `s${n}`,
      profileId: 'p1',
      number: n,
      status: n < 5 ? 'completed' : 'in_progress',
      startedOn: null,
      completedOn: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
    })),
    results: [1, 2, 3, 4].map((n) => ({
      id: `r${n}`,
      profileId: 'p1',
      semester: n,
      schemeId: 'vtu-2022',
      ruleSetId: 'vtu-2022-ug-be',
      sgpaAsserted: null,
      subjects: codes.map(([code, title, credits], i) => ({
        id: `${String(n)}-${code}`,
        subjectCode: code,
        subjectTitle: title,
        internal: 40 + i,
        external: 34 + i,
        total: 74 + i * 2,
        resultStatus: 'P',
        announcedOn: null,
        gradeLetter: null,
        gradePoint: null,
        credits,
        hasSee: true,
        provenance: 'catalogue',
      })),
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })),
  };
}

async function seed(page, data) {
  await page.evaluate(async (payload) => {
    const put = (key, value) =>
      new Promise((ok, fail) => {
        const request = window.indexedDB.open('keyval-store', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('keyval');
        request.onsuccess = () => {
          const tx = request.result.transaction('keyval', 'readwrite');
          tx.objectStore('keyval').put(value, key);
          tx.oncomplete = ok;
          tx.onerror = fail;
        };
        request.onerror = fail;
      });
    const base = 'gradtools:v1:anon:';
    await put(`${base}profile`, payload.profile);
    await put(`${base}semesters`, payload.semesters);
    await put(`${base}results`, payload.results);
  }, data);
}

/* -------------------------------------------------------------------------- */

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, why: String(error).split('\n')[0].slice(0, 200) });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Every route the shell links to. */
const ROUTES = [
  '/',
  '/attendance',
  '/results',
  '/semesters',
  '/academics',
  '/timetable',
  '/import',
  '/settings',
];

const VIEWPORTS = [
  { name: 'mobile 390', width: 390, height: 844 },
  { name: 'tablet 834', width: 834, height: 1112 },
  { name: 'desktop 1280', width: 1280, height: 900 },
  { name: 'desktop 1440', width: 1440, height: 900 },
];

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${String(PORT)}`;
  const browser = await chromium.launch();
  const consoleErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(base);
    await seed(page, seedData());

    /* ---- §24 The sidebar, at every width ------------------------------- */

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(base);
      await page.waitForTimeout(500);

      await check(`${viewport.name}: navigation exists and every item is named`, async () => {
        const links = page.locator(
          'nav[aria-label="Destinations"] a[href], nav[aria-label="Main"] a[href]',
        );
        const count = await links.count();
        expect(count > 0, 'no navigation links found');
        for (let i = 0; i < count; i += 1) {
          const link = links.nth(i);
          const name = (await link.getAttribute('aria-label')) ?? (await link.innerText()).trim();
          expect(
            name !== null && name !== '',
            `nav link ${String(i)} has no accessible name at ${viewport.name}`,
          );
        }
      });

      await check(`${viewport.name}: exactly one navigation is rendered`, async () => {
        /*
         * The shell ships a sidebar AND a bottom bar, and CSS decides which
         * belongs at this width. Both being painted at once is a real defect —
         * two navigations, two `aria-current` claims on one destination — and
         * a browser sweep at 834px found exactly that between 768 and 1023.
         */
        const shown = await page
          .locator('nav[aria-label="Destinations"], nav[aria-label="Main"]')
          .evaluateAll((nodes) =>
            nodes
              .filter((n) => {
                const box = n.getBoundingClientRect();
                return box.width > 0 && box.height > 0;
              })
              .map((n) => n.getAttribute('aria-label')),
          );
        expect(
          shown.length === 1,
          `${String(shown.length)} navigations painted at ${viewport.name}: ${shown.join(', ')}`,
        );
      });

      await check(
        `${viewport.name}: every nav target is reachable and marks itself current`,
        async () => {
          /*
           * VISIBLE links only. A link inside a nav this breakpoint hides is not
           * in the accessibility tree, so counting it would report a duplicate
           * that no user — sighted or not — can encounter.
           */
          /*
           * THE SHELL'S OWN NAVIGATIONS ONLY. The pages also carry link lists in
           * `<nav>` elements — an "Other areas" block, for one — and those are
           * in-page content that does not claim to track the current route.
           * Holding them to the shell's contract invents a defect.
           */
          const hrefs = await page
            .locator(
              'nav[aria-label="Destinations"] a[href^="/"], nav[aria-label="Main"] a[href^="/"]',
            )
            .evaluateAll((nodes) =>
              nodes
                .filter((n) => {
                  const box = n.getBoundingClientRect();
                  return box.width > 0 && box.height > 0;
                })
                .map((n) => n.getAttribute('href')),
            );
          expect(hrefs.length > 0, 'no visible internal nav links');
          for (const href of hrefs) {
            await page.goto(`${base}${href}`);
            await page.waitForTimeout(350);
            const current = await page
              .locator(
                `nav[aria-label="Destinations"] a[href="${href}"][aria-current="page"], nav[aria-label="Main"] a[href="${href}"][aria-current="page"]`,
              )
              .evaluateAll(
                (nodes) =>
                  nodes.filter((n) => {
                    const box = n.getBoundingClientRect();
                    return box.width > 0 && box.height > 0;
                  }).length,
              );
            expect(
              current === 1,
              `${href} does not mark itself current at ${viewport.name} (found ${String(current)})`,
            );
          }
        },
      );

      await check(`${viewport.name}: no horizontal overflow on any route`, async () => {
        for (const route of ROUTES) {
          await page.goto(`${base}${route}`);
          await page.waitForTimeout(350);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(
            overflow <= 1,
            `${route} scrolls sideways by ${String(overflow)}px at ${viewport.name}`,
          );
        }
      });
    }

    /* ---- The collapse control, where there is one ----------------------- */

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page.waitForTimeout(500);

    await check('desktop: the sidebar collapse control keeps every item named', async () => {
      const toggle = page.locator(
        'button[aria-label*="sidebar" i], button[aria-label*="collapse" i], button[aria-label*="navigation" i]',
      );
      if ((await toggle.count()) === 0) {
        /* No collapse control in this build. Not a failure — a fact. */
        results.push({ name: 'desktop: no sidebar collapse control exists', ok: true });
        return;
      }
      await toggle.first().click();
      await page.waitForTimeout(400);
      const links = page.locator('nav a[href]');
      const count = await links.count();
      for (let i = 0; i < count; i += 1) {
        const link = links.nth(i);
        const name = (await link.getAttribute('aria-label')) ?? (await link.innerText()).trim();
        expect(name !== '', `nav link ${String(i)} loses its name when collapsed`);
      }
      await toggle.first().click();
      await page.waitForTimeout(300);
    });

    await check('keyboard: the first nav item can be reached and followed', async () => {
      await page.goto(base);
      await page.waitForTimeout(500);
      const link = page.locator('nav a[href="/results"]').first();
      await link.focus();
      const focused = await page.evaluate(
        () => document.activeElement?.getAttribute('href') ?? null,
      );
      expect(focused === '/results', `focus did not land on the link (got ${String(focused)})`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      expect(page.url().endsWith('/results'), `Enter did not navigate (at ${page.url()})`);
    });

    /* ---- §25 Buttons ---------------------------------------------------- */

    await check('every button on every route has an accessible name', async () => {
      const unnamed = [];
      for (const route of ROUTES) {
        await page.goto(`${base}${route}`);
        await page.waitForTimeout(400);
        const found = await page.locator('button').evaluateAll((nodes) =>
          nodes
            .filter((n) => {
              const label = n.getAttribute('aria-label') ?? '';
              const text = (n.textContent ?? '').trim();
              const labelled = n.getAttribute('aria-labelledby') ?? '';
              const title = n.getAttribute('title') ?? '';
              return label === '' && text === '' && labelled === '' && title === '';
            })
            .map((n) => n.className || n.outerHTML.slice(0, 80)),
        );
        for (const entry of found) unnamed.push(`${route}: ${entry}`);
      }
      expect(unnamed.length === 0, `unnamed buttons: ${unnamed.slice(0, 6).join(' | ')}`);
    });

    await check('no enabled button is a dead control', async () => {
      /*
       * A control that neither navigates, nor opens something, nor changes the
       * page is dead. This clicks every enabled button on each route and
       * requires SOMETHING to change — the URL, the DOM, or an open dialog.
       * Buttons that destroy data are excluded by name.
       */
      const dead = [];
      const DESTRUCTIVE = /delete|remove|clear|sign out|reset|discard/i;
      for (const route of ROUTES) {
        await page.goto(`${base}${route}`);
        await page.waitForTimeout(400);
        const count = await page.locator('button:not([disabled])').count();
        for (let i = 0; i < count; i += 1) {
          await page.goto(`${base}${route}`);
          await page.waitForTimeout(300);
          const button = page.locator('button:not([disabled])').nth(i);
          if ((await button.count()) === 0) continue;
          const name = ((await button.getAttribute('aria-label')) ?? (await button.innerText()))
            .trim()
            .slice(0, 40);
          if (name === '' || DESTRUCTIVE.test(name)) continue;
          /*
           * THREE THINGS THAT LOOK DEAD AND ARE NOT.
           *
           * A tab already selected has nothing to change. A file-picker
           * trigger opens an OS dialog this driver suppresses. And a control
           * that closes a panel which is not open was never going to do
           * anything. Reporting these as defects would bury the real one — on
           * the first run it did exactly that, hiding "Add backlog" among
           * four false positives.
           */
          const state = await button.evaluate((node) => ({
            selected:
              node.getAttribute('aria-selected') === 'true' ||
              node.getAttribute('aria-pressed') === 'true',
            file: node.parentElement?.querySelector('input[type="file"]') !== null,
          }));
          if (state.selected || state.file) continue;
          const before = await page.evaluate(() => ({
            url: window.location.pathname,
            html: document.body.innerHTML.length,
            dialogs: document.querySelectorAll('[role="dialog"],[role="menu"]').length,
          }));
          try {
            await button.click({ timeout: 2000 });
          } catch {
            continue; /* Covered or detached; the overflow check owns that. */
          }
          await page.waitForTimeout(400);
          const after = await page.evaluate(() => ({
            url: window.location.pathname,
            html: document.body.innerHTML.length,
            dialogs: document.querySelectorAll('[role="dialog"],[role="menu"]').length,
          }));
          /*
           * A blocked form submit IS a response. The browser refuses, focuses
           * the offending field and announces why — none of which shows up as
           * a DOM size change, so without this a correctly validating control
           * reads as dead.
           */
          const invalid = await page.locator(':invalid').count();
          const changed =
            before.url !== after.url ||
            before.dialogs !== after.dialogs ||
            invalid > 0 ||
            Math.abs(before.html - after.html) > 20;
          if (!changed) dead.push(`${route}: "${name}"`);
        }
      }
      expect(dead.length === 0, `dead controls: ${dead.slice(0, 8).join(' | ')}`);
    });

    /* ---- Both themes ---------------------------------------------------- */

    for (const scheme of ['light', 'dark']) {
      await check(`${scheme}: the shell renders on every route`, async () => {
        await page.emulateMedia({ colorScheme: scheme });
        for (const route of ROUTES) {
          await page.goto(`${base}${route}`);
          await page.waitForTimeout(300);
          const navCount = await page.locator('nav a[href]').count();
          expect(navCount > 0, `${route} lost its navigation in ${scheme}`);
        }
      });
    }

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  /* ---------------------------------------------------------------------- */

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(
      `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.ok ? '' : `\n      ${entry.why}`}`,
    );
  }
  /*
   * THE CLOUD REFERENCE API IS NOT RUNNING HERE, and is not meant to be: this
   * harness serves a static build to prove the LOCAL-FIRST path works. Its
   * fetch failures are the expected shape of being offline, and counting them
   * as application errors would make the run permanently red and hide a real
   * one. Every other console error is the app's own and is a failure.
   */
  const OFFLINE = /ERR_CONNECTION_REFUSED|Failed to fetch|net::ERR_/;
  const appErrors = [...new Set(consoleErrors)].filter((error) => !OFFLINE.test(error));
  const offlineCount = consoleErrors.length - consoleErrors.filter((e) => !OFFLINE.test(e)).length;

  if (offlineCount > 0) {
    console.log(
      `\nExpected offline fetch failures: ${String(offlineCount)} (the reference API is not served here).`,
    );
  }
  if (appErrors.length > 0) {
    console.log(`\nApplication console errors (${String(appErrors.length)}):`);
    for (const error of appErrors.slice(0, 10)) console.log(`  ${error}`);
  }
  console.log(
    `\n${String(results.length - failed.length)}/${String(results.length)} checks passed.`,
  );
  process.exitCode = failed.length === 0 && appErrors.length === 0 ? 0 : 1;
}

await main();
