/**
 * Visual and accessibility QA against the real application, WITH DATA IN IT.
 *
 * Authority: docs/22 §22.21 · M9.4 §18, §19
 *
 * `visual-qa.mjs` drives an empty app, which is the right test for empty states
 * and the wrong one for everything else: a dashboard with no results has no
 * metrics, no timeline and no attention section, so most of the product is
 * never rendered. This seeds a synthetic semester-5 student into IndexedDB
 * first, pins the clock to a Monday morning so the day has classes in it, and
 * then sweeps every route.
 *
 * It runs the sweep in ONE colour scheme; run it twice. A palette can pass
 * contrast in one theme and fail in the other, and M9.4's only real defect was
 * a dark-theme-only failure that a single-theme sweep would have shipped.
 *
 *   node tests/visual-qa-seeded.mjs
 *   SCHEME=light OUT=.qa-light node tests/visual-qa-seeded.mjs
 *
 * The data is invented — made-up subject codes and grades against invented
 * attendance counts. No real academic record is ever used for QA.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa-screenshots');
const PORT = 4322;

/*
 * Every width the redesign is required to hold at (M9.5 §Responsive). 320 is
 * the narrowest phone worth supporting, 1024 is the breakpoint where the
 * dashboard becomes two columns, and 1920 is where a wide monitor stops the
 * content growing.
 */
const VIEWPORTS = [
  { name: '320', width: 320, height: 800 },
  { name: '360', width: 360, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 800 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

const ROUTES = [
  ['/', 'dashboard'],
  ['/semesters', 'degree'],
  ['/results', 'results'],
  ['/academics', 'gpa'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable'],
  ['/announcements', 'announcements'],
  ['/notifications', 'notifications'],
  ['/papers', 'papers'],
  ['/profile', 'profile'],
  ['/account', 'account'],
  ['/sign-in', 'signin'],
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
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

/* ---------------------------------------------------------------------- */
/* Synthetic student. Invented codes and marks; no real academic record.   */
/* ---------------------------------------------------------------------- */

const PID = 'p-demo';
const SUBJECTS = [
  ['BCS501', 'Software Engineering & Project Management', 3],
  ['BCS502', 'Computer Networks', 4],
  ['BCS503', 'Theory of Computation', 4],
  ['BCS504', 'Web Technology', 3],
  ['BCSL504', 'Web Technology Laboratory', 1],
  ['BRMK557', 'Research Methodology & IPR', 3],
];

const GRADES = ['O', 'A+', 'A', 'B+', 'B', 'C', 'P'];

function seedData() {
  const semesters = [];
  for (let n = 1; n <= 8; n += 1) {
    semesters.push({
      id: `sem-${n}`,
      profileId: PID,
      number: n,
      status: n < 5 ? 'completed' : n === 5 ? 'in_progress' : 'not_started',
      startedOn: null,
      completedOn: null,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
  }

  const results = [];
  const asserted = [8.32, 8.61, 8.4, 8.74];
  for (let n = 1; n <= 4; n += 1) {
    results.push({
      id: `res-${n}`,
      profileId: PID,
      semester: n,
      schemeId: 'vtu-2022',
      ruleSetId: 'vtu-2022-v1',
      sgpaAsserted: asserted[n - 1],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      subjects: SUBJECTS.map((s, i) => ({
        id: `res-${n}-s${i}`,
        subjectCode: `B${['CS', 'MA', 'PH', 'CH'][n - 1]}${String(30 + n)}${i}`,
        subjectTitle: s[1],
        credits: s[2],
        gradeLetter: GRADES[(n + i) % 5],
      })),
    });
  }

  const attendance = [
    ['BCS501', 41, 44],
    ['BCS502', 38, 47],
    ['BCS503', 33, 45],
    ['BCS504', 40, 43],
    ['BCSL504', 21, 22],
    ['BRMK557', 28, 40],
  ].map(([code, a, c], i) => ({
    id: `att-${i}`,
    profileId: PID,
    semester: 5,
    subjectCode: code,
    subjectTitle: SUBJECTS.find((s) => s[0] === code)[1],
    attended: a,
    conducted: c,
    updatedAt: '2026-08-29T00:00:00.000Z',
  }));

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const timetable = [];
  days.forEach((day, d) => {
    [
      ['09:00', '10:00', 'BCS502', '204'],
      ['11:00', '12:00', 'BCS503', '301'],
      ['14:00', '16:00', 'BCSL504', 'Lab 2'],
    ].forEach((slot, i) => {
      timetable.push({
        id: `tt-${d}-${i}`,
        profileId: PID,
        day,
        startTime: slot[0],
        endTime: slot[1],
        subjectCode: slot[2],
        room: slot[3],
        faculty: null,
      });
    });
  });

  return {
    profile: {
      id: PID,
      authUserId: null,
      displayName: 'Demo Student',
      usn: null,
      collegeName: 'Demo Institute of Technology',
      schemeId: 'vtu-2022',
      branch: 'Computer Science & Engineering',
      currentSemester: 5,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    semesters,
    results,
    attendance,
    timetable,
    semesterSubjects: SUBJECTS.map(([code, title, credits], i) => ({
      id: `ss-${i}`,
      profileId: PID,
      semester: 5,
      code,
      title,
      credits,
      notes: null,
      updatedAt: '2026-08-01T00:00:00.000Z',
    })),
    backlogs: [],
  };
}

async function seed(page, data) {
  await page.evaluate(async (payload) => {
    await new Promise((ok, fail) => {
      const open = globalThis.indexedDB.open('keyval-store', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('keyval');
      open.onerror = () => fail(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('keyval', 'readwrite');
        const store = tx.objectStore('keyval');
        for (const [key, value] of Object.entries(payload)) {
          store.put(value, `gradtools:v1:anon:${key}`);
        }
        tx.oncomplete = () => ok();
        tx.onerror = () => fail(tx.error);
      };
    });
  }, data);
}

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const data = seedData();
  const problems = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      colorScheme: process.env.SCHEME === 'light' ? 'light' : 'dark',
    });
    // A Monday, so the Today timeline actually has classes in it.
    await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/`);
    await seed(page, data);

    for (const [path, name] of ROUTES) {
      await page.goto(`http://localhost:${PORT}${path}`);
      await page.waitForTimeout(450);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      if (overflow > 0) problems.push(`OVERFLOW ${name}@${vp.name}: ${overflow}px`);

      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      for (const v of axe.violations) {
        problems.push(`AXE ${name}@${vp.name}: ${v.id} (${v.nodes.length}) ${v.help}`);
      }

      await page.screenshot({
        path: join(OUT, `${name}-${vp.name}.png`),
        fullPage: vp.name === '1280' || vp.name === '390',
      });
      if (process.env.HEIGHTS) console.log(`  ${name}@${vp.name} height=${height}`);
    }

    if (errors.length) problems.push(`CONSOLE @${vp.name}: ${errors.slice(0, 3).join(' | ')}`);
    await context.close();
  }

  await browser.close();
  server.close();

  console.log(
    problems.length === 0 ? 'CLEAN: 0 axe, 0 overflow, 0 console errors' : problems.join('\n'),
  );
};

run();
