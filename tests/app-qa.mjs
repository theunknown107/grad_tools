/**
 * Figma-rebuild QA: every route × every required width × light and dark,
 * against the production build with the REAL API on :3001 and a seeded
 * synthetic student in IndexedDB. Reports axe (WCAG 2.1 AA), horizontal
 * overflow and console errors; screenshots a subset.
 *
 *   pnpm qa:app            (all)
 *   THEMES=light WIDTHS=390,1280 pnpm qa:app
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { splitConsole } from './lib/console.mjs';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/shots');
const PORT = 4322;
const ALL_WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const WIDTHS = (process.env.WIDTHS ?? ALL_WIDTHS.join(',')).split(',').map(Number);
const THEMES = (process.env.THEMES ?? 'light,dark').split(',');
const SHOT_WIDTHS = new Set((process.env.SHOTS ?? '390,1280').split(',').map(Number));
const EMPTY = process.env.EMPTY === '1';

const ROUTES = [
  ['/', 'dashboard'],
  ['/announcements', 'announcements'],
  ['/notifications', 'notifications'],
  ['/semesters', 'degree'],
  ['/results', 'results'],
  ['/results/2', 'result-detail'],
  ['/academics', 'gpa'],
  ['/academics?tab=calculator', 'calculator'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable'],
  ['/exams', 'exams'],
  ['/import', 'import'],
  ['/profile', 'profile'],
  ['/profile?section=appearance', 'appearance'],
  ['/profile?section=academic', 'profile-academic'],
  ['/account', 'account'],
  ['/sign-in', 'signin'],
  ['/first-sync', 'first-sync'],
  ['/welcome', 'welcome'],
  ['/nope', 'notfound'],
];

/*
 * Overlays are audited OPEN: a page sweep only ever sees them closed. Each
 * opener leaves an overlay on screen; the harness checks focus moved into it,
 * runs axe, presses Escape, and checks it went away.
 */
const OVERLAYS = [
  [
    'command-menu',
    '/',
    async (page) => {
      // From a focused control, so there is somewhere for focus to return to.
      await page
        .getByRole('button', { name: /^search/i })
        .first()
        .focus();
      await page.keyboard.press('Control+k');
    },
  ],
  [
    'add-course',
    '/attendance',
    (page) =>
      page
        .getByRole('button', { name: /add a course/i })
        .first()
        .click(),
  ],
  [
    'planner',
    '/attendance',
    (page) =>
      page
        .getByRole('button', { name: /^plan against/i })
        .first()
        .click(),
  ],
  [
    'course-menu',
    '/attendance',
    (page) =>
      page
        .getByRole('button', { name: /^record a class for/i })
        .first()
        .click(),
  ],
  [
    'add-class',
    '/timetable',
    (page) =>
      page
        .getByRole('button', { name: /^add class$/i })
        .first()
        .click(),
  ],
  [
    'grade-select',
    '/academics?tab=calculator',
    (page) => page.getByRole('combobox', { name: /grade, course 1/i }).click(),
  ],
  [
    'result-menu',
    '/results/2',
    (page) => page.getByRole('button', { name: /actions for semester 2/i }).click(),
  ],
  [
    'delete-confirm',
    '/results/2',
    async (page) => {
      await page.getByRole('button', { name: /actions for semester 2/i }).click();
      await page.getByRole('menuitem', { name: /delete this semester/i }).click();
    },
  ],
  ['mobile-nav', '/', (page) => page.getByRole('button', { name: /^more/i }).first().click(), 1024],
];
const OVERLAY_WIDTHS = new Set((process.env.OVERLAY_WIDTHS ?? '390,1280').split(',').map(Number));
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

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
      status: n < 5 ? 'completed' : n === 5 ? 'in_progress' : 'planned',
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
        internal: 30 + i,
        external: 20 + n,
        total: 50 + i + n,
        resultStatus: 'P',
        provenance: i === 0 ? 'manual' : 'result_import',
        catalogueCode: null,
        hasSee: true,
        gradePoint: null,
        announcedOn: null,
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
      ['09:00', '10:00', 'BCS502', '204', null],
      ['10:00', '10:15', null, null, 'Short break'],
      ['11:00', '12:00', 'BCS503', '301', null],
      ['12:00', '13:00', null, 'Auditorium', 'Placement & Training'],
      ['14:00', '16:00', 'BCSL504', 'Lab 2', null],
    ].forEach((slot, i) => {
      timetable.push({
        id: `tt-${d}-${i}`,
        profileId: PID,
        day,
        startTime: slot[0],
        endTime: slot[1],
        subjectCode: slot[2],
        activity: slot[4],
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
      usn: '1DS22CS001',
      collegeName: 'Demo Institute of Technology',
      schemeId: 'vtu-2022',
      programme: 'B.E.',
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
    backlogs: [
      {
        id: 'bl-1',
        profileId: PID,
        subjectCode: 'BMATS301',
        subjectTitle: 'Transform Calculus',
        originSemester: 3,
        status: 'active',
        attempts: 1,
        clearedInSemester: null,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
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
        for (const [key, value] of Object.entries(payload))
          store.put(value, `gradtools:v1:anon:${key}`);
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
  const problems = [];
  let apiDown = 0;
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: width < 768 ? 844 : 900 },
        deviceScaleFactor: 1,
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
      await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e)}`));
      await page.goto(`http://localhost:${PORT}/welcome`);
      if (!EMPTY) await seed(page, seedData());
      for (const [path, name] of ROUTES) {
        await page.goto(`http://localhost:${PORT}${path}`);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0) problems.push(`OVERFLOW ${theme} ${name}@${width}: ${overflow}px`);
        const inner = await page.evaluate(() => {
          const main = document.getElementById('gt-main');
          return main ? main.scrollWidth - main.clientWidth : 0;
        });
        if (inner > 0) {
          problems.push(`MAIN-OVERFLOW ${theme} ${name}@${width}: ${inner}px`);
          const culprits = await page.evaluate(() => {
            const main = document.getElementById('gt-main');
            const limit = main.getBoundingClientRect().right;
            const out = [];
            for (const el of main.querySelectorAll('*')) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.right <= limit + 1) continue;
              const p = el.parentElement;
              if (p && p.getBoundingClientRect().right > limit + 1) continue;
              let clipped = false;
              for (let a = el.parentElement; a && a !== main; a = a.parentElement) {
                const o = getComputedStyle(a).overflowX;
                if (o === 'auto' || o === 'hidden' || o === 'scroll' || o === 'clip') {
                  clipped = true;
                  break;
                }
              }
              if (!clipped)
                out.push(
                  `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 100)} w=${Math.round(r.width)}`,
                );
            }
            return out.slice(0, 5);
          });
          for (const c of culprits) problems.push(`     ${c}`);
        }
        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        for (const v of axe.violations) {
          problems.push(`AXE ${theme} ${name}@${width}: ${v.id} (${v.nodes.length}) ${v.help}`);
          for (const node of v.nodes.slice(0, 2)) {
            const why = (node.any ?? []).map((c) => JSON.stringify(c.data)).join(' ');
            problems.push(`     ${node.html.slice(0, 200)} ${why.slice(0, 200)}`);
          }
        }
        if (SHOT_WIDTHS.has(width)) {
          await page.screenshot({
            path: join(OUT, `${theme}-${name}-${width}.png`),
            fullPage: true,
          });
        }
      }
      if (!EMPTY && OVERLAY_WIDTHS.has(width)) {
        for (const [name, path, open, maxWidth] of OVERLAYS) {
          if (maxWidth !== undefined && width >= maxWidth) continue;
          const label = `${theme} ${name}@${width}`;
          await page.goto(`http://localhost:${PORT}${path}`);
          await page.waitForLoadState('networkidle').catch(() => undefined);
          await page.waitForTimeout(400);
          try {
            await open(page);
            await page.locator(OVERLAY_SELECTOR).first().waitFor({ timeout: 3000 });
            await page.waitForTimeout(400);
          } catch (error) {
            const reason = String(error).split('\n')[0];
            problems.push(`OVERLAY ${label}: did not open (${reason})`);
            continue;
          }
          const focusInside = await page.evaluate(
            (selector) =>
              [...document.querySelectorAll(selector)].some((el) =>
                el.contains(document.activeElement),
              ),
            OVERLAY_SELECTOR,
          );
          if (!focusInside) problems.push(`OVERLAY ${label}: focus did not move into the overlay`);
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          for (const v of axe.violations) {
            problems.push(`AXE ${label}: ${v.id} (${v.nodes.length}) ${v.help}`);
            for (const node of v.nodes.slice(0, 2))
              problems.push(`     ${node.html.slice(0, 200)}`);
          }
          if (SHOT_WIDTHS.has(width)) {
            await page.screenshot({ path: join(OUT, `${theme}-overlay-${name}-${width}.png`) });
          }
          await page.keyboard.press('Escape');
          // Long enough for the slowest exit animation (the bottom sheet).
          await page.waitForTimeout(900);
          if ((await page.locator(OVERLAY_SELECTOR).count()) > 0)
            problems.push(`OVERLAY ${label}: still open after Escape`);
          else if (await page.evaluate(() => document.activeElement === document.body))
            problems.push(`OVERLAY ${label}: focus was lost on close`);
        }
      }
      const sweep = splitConsole(errors);
      apiDown += sweep.apiDown;
      if (sweep.real.length)
        problems.push(`CONSOLE ${theme}@${width}: ${sweep.real.slice(0, 4).join(' | ')}`);
      await context.close();
    }
  }
  await browser.close();
  server.close();
  if (apiDown > 0) console.log(`${apiDown} API-unavailable console messages`);
  console.log(
    problems.length === 0 ? 'CLEAN: 0 axe, 0 overflow, 0 console errors' : problems.join('\n'),
  );
};

run();
