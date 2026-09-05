/**
 * Visual and accessibility QA against the REAL rendered application.
 *
 * Authority: M3 continuation §27-§28, docs/27 §27.13
 *
 * Serves the production build, drives Chromium at the required viewports,
 * captures screenshots and runs axe-core on every screen. Reports concrete
 * findings so they can be fixed rather than assumed away.
 *
 * Run:  node tests/visual-qa.mjs
 */

import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve('tests/screenshots');
const PORT = 4319;

const VIEWPORTS = [
  { name: '320', width: 320, height: 720 },
  { name: '375', width: 375, height: 780 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 900 },
];

const ROUTES = [
  { path: '/', name: 'dashboard' },
  { path: '/academics', name: 'academics' },
  { path: '/attendance', name: 'attendance' },
  { path: '/results', name: 'results' },
  { path: '/timetable', name: 'timetable' },
  { path: '/profile', name: 'profile' },
  { path: '/does-not-exist', name: 'notfound' },
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};

/** Static server with SPA fallback so client routes resolve. */
function serve() {
  return new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '/').split('?')[0];
      let filePath = join(DIST, url);
      if (!existsSync(filePath) || extname(filePath) === '') {
        filePath = join(DIST, 'index.html');
      }
      try {
        const body = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'text/plain' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(PORT, () => {
      resolveServer(server);
    });
  });
}

/** Seeds IndexedDB so screens render with data, not only empty states. */
const SEED = `
  (async () => {
    const open = indexedDB.open('keyval-store', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keyval');
    await new Promise((r) => { open.onsuccess = r; });
    const db = open.result;
    const put = (k, v) => new Promise((r) => {
      const tx = db.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put(v, k);
      tx.oncomplete = r;
    });
    await put('gradtools:v1:profile', {
      id: 'p1', authUserId: null, displayName: 'Ravi', usn: '1XX22CS001',
      collegeName: 'Sample Institute', schemeId: 'vtu-2022', branch: 'Computer Science',
      currentSemester: 3, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    });
    await put('gradtools:v1:attendance', [
      { id: 'a1', profileId: 'p1', semester: 3, subjectCode: 'BCS301', subjectTitle: 'BCS301', attended: 45, conducted: 50, updatedAt: '' },
      { id: 'a2', profileId: 'p1', semester: 3, subjectCode: 'BCS304', subjectTitle: 'BCS304', attended: 42, conducted: 50, updatedAt: '' },
      { id: 'a3', profileId: 'p1', semester: 3, subjectCode: 'BCSL305', subjectTitle: 'BCSL305', attended: 30, conducted: 50, updatedAt: '' },
    ]);
    await put('gradtools:v1:results', [
      { id: 'r1', profileId: 'p1', semester: 1, schemeId: 'vtu-2022', sgpaAsserted: 8.5, createdAt: '', updatedAt: '',
        subjects: [
          { id: 's1', subjectCode: 'BMATS101', subjectTitle: 'BMATS101', credits: 4, gradeLetter: 'A' },
          { id: 's2', subjectCode: 'BCHEE102', subjectTitle: 'BCHEE102', credits: 4, gradeLetter: 'A+' },
          { id: 's3', subjectCode: 'BPOPS103', subjectTitle: 'BPOPS103', credits: 3, gradeLetter: 'B+' },
        ] },
      { id: 'r2', profileId: 'p1', semester: 2, schemeId: 'vtu-2022', sgpaAsserted: null, createdAt: '', updatedAt: '',
        subjects: [
          { id: 's4', subjectCode: 'BMATS201', subjectTitle: 'BMATS201', credits: 4, gradeLetter: 'O' },
          { id: 's5', subjectCode: 'BPHYS202', subjectTitle: 'BPHYS202', credits: 4, gradeLetter: 'A' },
        ] },
    ]);
    await put('gradtools:v1:timetable', [
      { id: 't1', profileId: 'p1', day: 'Mon', startTime: '09:00', endTime: '10:00', subjectCode: 'BCS301', room: 'A-204', faculty: null },
      { id: 't2', profileId: 'p1', day: 'Mon', startTime: '11:00', endTime: '12:00', subjectCode: 'BCS304', room: null, faculty: 'Prof. Kulkarni' },
      { id: 't3', profileId: 'p1', day: 'Tue', startTime: '10:00', endTime: '11:00', subjectCode: 'BCSL305', room: 'Lab 2', faculty: null },
      { id: 't4', profileId: 'p1', day: 'Wed', startTime: '09:00', endTime: '10:00', subjectCode: 'BCS301', room: 'A-204', faculty: null },
      { id: 't5', profileId: 'p1', day: 'Fri', startTime: '14:00', endTime: '16:00', subjectCode: 'BCSL305', room: 'Lab 2', faculty: null },
    ]);
  })();
`;

const findings = [];

async function main() {
  const server = await serve();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---- Pass 1: accessibility + overflow, at two representative widths -------
  for (const viewport of [VIEWPORTS[1], VIEWPORTS[5]]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(SEED);

    for (const route of ROUTES) {
      await page.goto(`http://localhost:${PORT}${route.path}`);
      await page.waitForTimeout(350);

      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      for (const violation of axe.violations) {
        findings.push({
          kind: 'a11y',
          route: route.name,
          viewport: viewport.name,
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.slice(0, 3).map((n) => n.html.slice(0, 130)),
        });
      }

      // Horizontal overflow: the page body must never scroll sideways.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (overflow.scrollWidth > overflow.clientWidth + 1) {
        findings.push({
          kind: 'overflow',
          route: route.name,
          viewport: viewport.name,
          detail: `scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
        });
      }

      // Touch targets below 44px on mobile.
      if (viewport.width < 768) {
        const small = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('button, a, select, input')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.height < 44 - 0.5) {
              out.push(
                `${el.tagName}.${el.className.toString().slice(0, 40)} h=${Math.round(r.height)}`,
              );
            }
          }
          return out.slice(0, 6);
        });
        for (const item of small) {
          findings.push({
            kind: 'touch-target',
            route: route.name,
            viewport: viewport.name,
            detail: item,
          });
        }
      }
    }

    for (const message of consoleErrors) {
      findings.push({ kind: 'console', viewport: viewport.name, detail: message.slice(0, 200) });
    }
    await context.close();
  }

  // ---- Pass 2: screenshots at every required viewport ----------------------
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(SEED);

    for (const route of ROUTES) {
      await page.goto(`http://localhost:${PORT}${route.path}`);
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(OUT, `${route.name}-${viewport.name}.png`),
        fullPage: true,
      });
    }
    await context.close();
  }

  // ---- Pass 3: focus visibility and empty states ---------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    // No seed: this is the genuine first-visit empty dashboard.
    await page.reload();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'dashboard-EMPTY-1280.png'), fullPage: true });

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.screenshot({ path: join(OUT, 'focus-1280.png') });

    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return 'none';
      const style = getComputedStyle(el);
      return `${el.tagName}|outline=${style.outlineWidth} ${style.outlineStyle}`;
    });
    findings.push({ kind: 'info', detail: `focus after 2x Tab: ${focused}` });
    await context.close();
  }

  // ---- Pass 4: dark theme --------------------------------------------------
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(SEED);
    await page.goto(`http://localhost:${PORT}/attendance`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'attendance-DARK-1280.png'), fullPage: true });
    await context.close();
  }

  await browser.close();
  server.close();

  await writeFile(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));

  const a11y = findings.filter((f) => f.kind === 'a11y');
  const overflow = findings.filter((f) => f.kind === 'overflow');
  const touch = findings.filter((f) => f.kind === 'touch-target');
  const consoleErrs = findings.filter((f) => f.kind === 'console');

  console.log('=== VISUAL / A11Y QA ===');
  console.log(`accessibility violations : ${a11y.length}`);
  console.log(`horizontal overflow      : ${overflow.length}`);
  console.log(`touch targets < 44px     : ${touch.length}`);
  console.log(`console errors           : ${consoleErrs.length}`);
  console.log('');
  for (const f of [...a11y, ...overflow, ...touch, ...consoleErrs].slice(0, 25)) {
    console.log(JSON.stringify(f));
  }
  for (const f of findings.filter((x) => x.kind === 'info')) console.log(JSON.stringify(f));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
