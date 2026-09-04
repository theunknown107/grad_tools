/**
 * All five accents, both appearances, and the system-appearance contract.
 *
 * Authority: docs/22 §22.37 · M9.6G §19, §20
 *
 * Earlier milestones swept the violet accent only and left the other four
 * covered by a token-level contrast test. That test proves the STOPS are
 * sound; it cannot prove they reach the pixels on a populated page, which is
 * where a hard-coded colour or an unmatched selector shows up.
 *
 * Ten palettes across the five showcase pages, populated. Plus the piece no
 * unit test can reach: `system` following the OS, verified by flipping
 * Chromium's own colour-scheme emulation and reading the painted background
 * back off the document.
 *
 *   node tests/accent-qa.mjs
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve('.qa/accent');
const PORT = 4322;

const ACCENTS = ['violet', 'cyan', 'amber', 'rose', 'green'];
const ROUTES = [
  ['/welcome', 'welcome'],
  ['/', 'dashboard'],
  ['/results', 'results'],
  ['/semesters', 'degree'],
  ['/attendance', 'attendance'],
];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
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

function seedData() {
  const subjects = [
    ['BXXX501', 'Core course one', 4],
    ['BXXX502', 'Core course two', 4],
    ['BXXX503', 'Core course three', 3],
    ['BXXL504', 'Laboratory course', 1],
  ];
  const grades = ['O', 'A+', 'A', 'B+'];
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
      number: n,
      status: n < 5 ? 'completed' : 'in_progress',
      subjects: subjects.map(([code, title, credits], i) => ({
        id: `${String(n)}-${code}`,
        semester: n,
        subjectCode: code,
        subjectTitle: title,
        credits,
        weeklyHours: 4,
        hasSee: i !== 3,
      })),
    })),
    results: [1, 2, 3, 4].map((n) => ({
      id: `r${n}`,
      profileId: 'p1',
      semester: n,
      schemeId: 'vtu-2022',
      ruleSetId: 'vtu-2022-v1',
      createdAt: '2026-09-01T00:00:00.000Z',
      sgpaAsserted: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
      subjects: subjects.map(([code, title, credits], i) => ({
        subjectCode: code,
        subjectTitle: title,
        credits,
        gradeLetter: grades[(i + n) % grades.length],
      })),
    })),
    attendance: subjects.map(([code], i) => ({
      id: `a${code}`,
      semester: 5,
      subjectCode: code,
      attended: [44, 38, 33, 46][i],
      conducted: 48,
      updatedAt: '2026-09-01T00:00:00.000Z',
    })),
    timetable: [],
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
    await put(`${base}attendance`, payload.attendance);
    await put(`${base}timetable`, payload.timetable);
  }, data);
}

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const data = seedData();
  const problems = [];
  let checks = 0;

  for (const appearance of ['dark', 'light']) {
    for (const accent of ACCENTS) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        colorScheme: appearance === 'light' ? 'dark' : 'light',
      });
      await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
      await context.addInitScript(
        ([a, c]) =>
          window.localStorage.setItem(
            'gradtools:v1:theme',
            JSON.stringify({ appearance: a, accent: c }),
          ),
        [appearance, accent],
      );

      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://localhost:${PORT}/`);
      await seed(page, data);

      for (const [path, name] of ROUTES) {
        const label = `${name}/${appearance}/${accent}`;
        await page.goto(`http://localhost:${PORT}${path}`);
        await page.waitForTimeout(350);

        const applied = await page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          return {
            accent: document.documentElement.getAttribute('data-accent'),
            theme: document.documentElement.getAttribute('data-theme'),
            accentColour: style.getPropertyValue('--accent').trim(),
            glow: style.getPropertyValue('--a-glow-rgb').trim(),
          };
        });
        if (applied.accent !== accent) problems.push(`ACCENT ${label}: ${String(applied.accent)}`);
        if (applied.theme !== appearance) problems.push(`THEME ${label}: ${String(applied.theme)}`);
        if (!applied.accentColour) problems.push(`TOKEN ${label}: --accent empty`);
        if (!applied.glow) problems.push(`TOKEN ${label}: --a-glow-rgb empty`);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0) problems.push(`OVERFLOW ${label}: ${String(overflow)}px`);

        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        for (const v of axe.violations) {
          problems.push(`AXE ${label}: ${v.id} (${String(v.nodes.length)})`);
          for (const n of v.nodes.slice(0, 1)) {
            problems.push(`     ${n.target.join(' ')}`);
          }
        }

        checks += 1;
        if (name === 'dashboard') {
          await page.screenshot({ path: join(OUT, `${appearance}-${accent}.png`) });
        }
      }

      for (const e of errors) problems.push(`ERROR ${appearance}/${accent}: ${e.slice(0, 120)}`);
      await context.close();
    }
  }

  /* -------------------------------------------------------- system appearance */
  const systemNotes = [];
  for (const os of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: os,
    });
    // `system` is the DEFAULT, so nothing is written to storage here: the
    // absence of data-theme is exactly what hands control to the media query.
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    }));

    if (state.attr !== null) {
      problems.push(`SYSTEM os=${os}: data-theme should be absent, was ${String(state.attr)}`);
    }
    systemNotes.push(`os=${os} -> body background ${state.bg}`);
    await context.close();
  }

  // The two OS settings must produce DIFFERENT painted backgrounds, or the
  // system option is not actually following anything.
  if (systemNotes[0] === systemNotes[1].replace('dark', 'light')) {
    problems.push('SYSTEM: light and dark produced the same background');
  }

  await browser.close();
  server.close();

  console.log(`\n${String(checks)} page checks across ${String(ACCENTS.length * 2)} palettes`);
  console.log('system appearance:');
  for (const note of systemNotes) console.log('  ' + note);
  if (problems.length === 0) {
    console.log('\nCLEAN — every accent applied, 0 axe violations, 0 overflow, 0 page errors');
  } else {
    console.log(`\n${String(problems.length)} problems:`);
    for (const p of problems) console.log('  ' + p);
  }
  process.exit(problems.length === 0 ? 0 : 1);
};

run();
