/**
 * One subject, across every screen that names it.
 *
 * Authority: docs/22 §22.43 · docs/32 OQ-051 · M10A.1 §40
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SWEEP IS LOOKING FOR
 * ---------------------------------------------------------------------------
 *
 * The seeded student below has ONE subject — `BQAS101` — recorded four times
 * under four different wordings and three spellings of the code, exactly as the
 * real artifacts show: a result card shouting it in capitals, a timetable
 * storing a bare code, an attendance row abbreviating it, and a backlog using
 * an ampersand.
 *
 * The failure this catches is not a crash. It is the interface quietly
 * presenting that as four subjects — which is what it did before OQ-051, and
 * which looks entirely normal on any single screen.
 *
 *   node tests/subject-identity-qa.mjs
 *   SCHEME=light OUT=.qa/identity-light node tests/subject-identity-qa.mjs
 *
 * Codes and marks are invented. The SHAPE is a real card's and a real
 * timetable's; no real academic record is used for QA.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/identity');
/* The origin the API's CORS allowlist carries; see tests/results-qa.mjs. */
const PORT = 4322;

const VIEWPORTS = [
  { name: '320', width: 320, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
];

const ROUTES = [
  ['/results', 'results'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable'],
  ['/semesters', 'degree'],
  ['/papers', 'papers'],
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

const PID = 'p-demo';

/* ONE subject. Four wordings, three spellings of the code. */
const CODE_RESULT = 'BQAS101';
const CODE_ATTENDANCE = 'bqas101';
const CODE_TIMETABLE = 'BQAS 101';
const CODE_BACKLOG = 'BQAS101';

const TITLE_RESULT = 'MATHEMATICS FOR QA STREAM-I';
const TITLE_ATTENDANCE = 'Maths-I';
const TITLE_BACKLOG = 'Mathematics-I & Applications';

function seedData() {
  const semesters = Array.from({ length: 8 }, (_, i) => ({
    id: `sem-${i + 1}`,
    profileId: PID,
    number: i + 1,
    status: i + 1 < 3 ? 'completed' : i + 1 === 3 ? 'in_progress' : 'planned',
    startedOn: null,
    completedOn: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  }));

  const subject = (id, code, title, extra = {}) => ({
    id,
    subjectCode: code,
    subjectTitle: title,
    internal: 44,
    external: 36,
    total: 80,
    resultStatus: 'P',
    announcedOn: '2026-03-13',
    gradeLetter: null,
    gradePoint: null,
    credits: null,
    hasSee: true,
    provenance: 'manual',
    ...extra,
  });

  return {
    profile: {
      id: PID,
      authUserId: null,
      displayName: 'Demo Student',
      usn: null,
      collegeName: 'Demo Institute of Technology',
      schemeId: 'vtu-2022',
      branch: 'cse',
      currentSemester: 3,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    semesters,
    results: [
      {
        id: 'res-1',
        profileId: PID,
        semester: 1,
        schemeId: 'vtu-2022',
        ruleSetId: 'vtu-2022-v1',
        sgpaAsserted: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        subjects: [
          subject('res-1-s0', CODE_RESULT, TITLE_RESULT),
          subject('res-1-s1', 'BQAS102', 'APPLIED PHYSICS FOR QA STREAM'),
        ],
      },
    ],
    attendance: [
      {
        id: 'att-0',
        profileId: PID,
        semester: 1,
        subjectCode: CODE_ATTENDANCE,
        subjectTitle: TITLE_ATTENDANCE,
        attended: 38,
        conducted: 44,
        updatedAt: '2026-08-29T00:00:00.000Z',
      },
    ],
    timetable: [
      {
        id: 'tt-0',
        profileId: PID,
        day: 'Mon',
        startTime: '10:00',
        endTime: '10:55',
        subjectCode: CODE_TIMETABLE,
        room: 'B205',
        faculty: null,
      },
    ],
    backlogs: [
      {
        id: 'bl-0',
        profileId: PID,
        subjectCode: CODE_BACKLOG,
        subjectTitle: TITLE_BACKLOG,
        originSemester: 1,
        status: 'active',
        attempts: 0,
        clearedInSemester: null,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    semesterSubjects: [],
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

/* ---------------------------------------------------------------------- */

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const data = seedData();
  const problems = [];
  const scheme = process.env.SCHEME === 'light' ? 'light' : 'dark';
  let checks = 0;

  const fail = (message) => problems.push(message);
  const expect = (condition, message) => {
    checks += 1;
    if (!condition) fail(message);
  };

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
    /*
     * A Monday, so the timetable's Today view has the seeded slot in it. This
     * is a HARNESS clock, not product logic: nothing in GradTools derives
     * academic state from the calendar (M10A.1 §25).
     */
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
      if (overflow > 0) fail(`OVERFLOW ${name}@${vp.name}: ${overflow}px`);

      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      for (const v of axe.violations) {
        fail(`AXE ${name}@${vp.name}: ${v.id} (${v.nodes.length}) ${v.help}`);
      }

      await page.screenshot({
        path: join(OUT, `${name}-${vp.name}.png`),
        fullPage: vp.name === '1280' || vp.name === '390',
      });
    }

    if (errors.length) fail(`CONSOLE @${vp.name}: ${errors.slice(0, 3).join(' | ')}`);
    await context.close();
  }

  /* -------------------------------------------------------------------- */
  /* The identity checks                                                  */
  /* -------------------------------------------------------------------- */

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
  });
  await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${PORT}/`);
  await seed(page, data);

  /* ---- the timetable used to render a bare code ----------------------- */
  await page.goto(`http://localhost:${PORT}/timetable`);
  await page.waitForTimeout(600);
  const timetableText = await page.locator('#main').innerText();
  expect(
    new RegExp(TITLE_RESULT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(timetableText) ||
      /Maths-I/i.test(timetableText) ||
      /Mathematics-I/i.test(timetableText),
    'IDENTITY: the timetable still shows no name for a subject the student has named elsewhere',
  );
  expect(
    /BQAS ?101/i.test(timetableText),
    'IDENTITY: the timetable dropped the code, which is the identity',
  );
  await page.screenshot({ path: join(OUT, 'timetable-named-1280.png'), fullPage: true });

  if (errors.length) fail(`CONSOLE identity: ${errors.slice(0, 3).join(' | ')}`);
  await context.close();

  /*
   * THE SHEET IS A NARROW-WIDTH AFFORDANCE. Above 900px the result table
   * replaces the row buttons entirely, so the detail sheet has to be opened at
   * a phone width — which is also the only width a student ever opens it at.
   */
  const narrow = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: scheme,
  });
  const page2 = await narrow.newPage();
  page2.on('pageerror', (e) => errors.push(String(e)));
  await page2.goto(`http://localhost:${PORT}/`);
  await seed(page2, data);
  await page2.goto(`http://localhost:${PORT}/results`);
  await page2.waitForTimeout(600);
  await page2.getByRole('tab', { name: /semesters/i }).click();
  await page2.waitForTimeout(400);

  const row = page2.locator('section[aria-labelledby="sem-1"] button', { hasText: TITLE_RESULT });
  await row.first().scrollIntoViewIfNeeded();
  await page2.waitForTimeout(300);
  await row.first().click();
  await page2.waitForTimeout(450);

  const sheet = page2.getByRole('dialog');
  const sheetText = await sheet.innerText();
  expect(/Also recorded as/i.test(sheetText), 'IDENTITY: the sheet did not surface other wordings');
  expect(
    sheetText.includes(TITLE_ATTENDANCE) && sheetText.includes(TITLE_BACKLOG),
    `IDENTITY: a wording is missing from the sheet — "${sheetText.replace(/\n/g, ' | ')}"`,
  );
  /* The card's own words stay above; the line is an addition, not a correction. */
  expect(
    sheetText.includes(TITLE_RESULT) || (await sheet.getByRole('heading').count()) > 0,
    'IDENTITY: the result card wording was replaced rather than kept',
  );
  await page2.screenshot({ path: join(OUT, 'sheet-variants-390.png') });
  await page2.keyboard.press('Escape');
  await page2.waitForTimeout(300);

  /* ---- a subject with one wording gets no "also recorded as" ---------- */
  const plain = page2.locator('section[aria-labelledby="sem-1"] button', {
    hasText: 'APPLIED PHYSICS FOR QA STREAM',
  });
  await plain.first().scrollIntoViewIfNeeded();
  await page2.waitForTimeout(250);
  await plain.first().click();
  await page2.waitForTimeout(450);
  const plainText = await page2.getByRole('dialog').innerText();
  expect(
    !/Also recorded as/i.test(plainText),
    'IDENTITY: a subject every source agrees on was given a variants line',
  );

  if (errors.length) fail(`CONSOLE identity: ${errors.slice(0, 3).join(' | ')}`);
  await narrow.close();

  await browser.close();
  server.close();

  console.log(
    problems.length === 0
      ? `CLEAN (${scheme}): ${checks} identity checks, 0 axe, 0 overflow, 0 console errors`
      : problems.join('\n'),
  );
  if (problems.length > 0) process.exitCode = 1;
};

run();
