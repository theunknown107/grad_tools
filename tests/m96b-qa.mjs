/**
 * M9.6B sweep: every page, every required width, both themes.
 *
 * Authority: docs/22 §22.32 · M9.6B §38, §40
 *
 * Seeds a synthetic student so the pages render with DATA in them — an empty
 * dashboard exercises none of the metric, table or chart styling, which is
 * exactly where a theme regression hides.
 *
 *   node tests/m96b-qa.mjs
 *
 * Screenshots land in .qa/m96b/, gitignored.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { isApiDown } from './lib/console.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/m96b');
/* 4322 is the origin the API allows — see tests/README. */
const PORT = 4322;

const VIEWPORTS = [
  { name: '320', width: 320, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

const ROUTES = [
  ['/welcome', 'landing'],
  ['/', 'dashboard'],
  ['/semesters', 'degree'],
  ['/results', 'results'],
  ['/academics', 'gpa'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable'],
  ['/announcements', 'announcements'],
  ['/notifications', 'notifications'],
  ['/profile', 'profile'],
  ['/account', 'account'],
  ['/sign-in', 'sign-in'],
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

/**
 * A synthetic student, populated to the shape M9.6D §39 requires.
 *
 * Four completed semesters, one in progress, an 8-subject semester AND a
 * 9-subject one (the variable-count case the real artifacts exposed), a
 * carried subject, attendance including a below-threshold subject, and a full
 * week of timetable.
 *
 * Every value is invented. Subject codes use the synthetic BXXX form used
 * throughout the suite, so nothing here can be mistaken for a record.
 */
function seedData() {
  /* Eight subjects for semesters 1-3, nine for semester 4 — a real VTU
     semester count varies, and a fixed grid would hide that. */
  const eight = [
    ['BXXX301', 'Core course one', 4],
    ['BXXX302', 'Core course two', 4],
    ['BXXX303', 'Core course three', 3],
    ['BXXL304', 'Laboratory course', 1],
    ['BXXX305', 'Integrated course', 3],
    ['BXXX306', 'Humanities course', 2],
    ['BXXX307', 'Ability enhancement', 1],
    ['BXXX308', 'Mandatory course', 1],
  ];
  const nine = [...eight, ['BXXX309', 'Professional elective', 3]];
  const current = [
    ['BXXX501', 'Core course one', 4],
    ['BXXX502', 'Core course two', 4],
    ['BXXX503', 'Core course three', 3],
    ['BXXL504', 'Laboratory course', 1],
    ['BXXX505', 'Professional elective', 3],
    ['BXXX506', 'Open elective', 3],
    ['BXXX507', 'Ability enhancement', 1],
    ['BXXX508', 'Mandatory course', 1],
  ];
  const grades = ['O', 'A+', 'A', 'B+', 'A', 'A+', 'B', 'A', 'B+'];

  const subjectsFor = (n) => (n === 4 ? nine : n === 5 ? current : eight);

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
      subjects: subjectsFor(n).map(([code, title, credits], i) => ({
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
      /*
       * The rule set a semester was graded under is PINNED on the record, and
       * the engine refuses to grade a result whose rule set it cannot resolve
       * (M6 §6 — a regulation change must never silently re-grade the past).
       * Omitting these left every semester ungraded and the whole page blank,
       * which was a fixture gap, not a product defect.
       */
      schemeId: 'vtu-2022',
      ruleSetId: 'vtu-2022-v1',
      createdAt: '2026-09-01T00:00:00.000Z',
      subjects: subjectsFor(n).map(([code, title, credits], i) => ({
        subjectCode: code,
        subjectTitle: title,
        credits,
        /* Semester 2 carries one F, so the backlog surfaces render. */
        gradeLetter: n === 2 && i === 6 ? 'F' : grades[(i + n) % grades.length],
      })),
      sgpaAsserted: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
    })),
    attendance: current.map(([code], i) => ({
      id: `a${code}`,
      semester: 5,
      subjectCode: code,
      /* One subject deliberately under the 85% requirement and one under the
         75% DX floor, so the warning and danger states both render. */
      attended: [44, 41, 38, 46, 33, 40, 43, 29][i],
      conducted: 48,
      updatedAt: '2026-09-01T00:00:00.000Z',
    })),
    timetable: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].flatMap((day, d) =>
      current.slice(0, 4).map(([code], i) => ({
        id: `t${day}${code}`,
        semester: 5,
        day,
        startTime: `${String(9 + i).padStart(2, '0')}:00`,
        endTime: `${String(10 + i).padStart(2, '0')}:00`,
        subjectCode: current[(i + d) % current.length][0],
        room: `R${String(101 + i)}`,
      })),
    ),
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
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        colorScheme: appearance === 'light' ? 'dark' : 'light',
      });
      await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
      await context.addInitScript(
        (a) =>
          window.localStorage.setItem(
            'gradtools:v1:theme',
            JSON.stringify({ appearance: a, accent: 'violet' }),
          ),
        appearance,
      );

      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(`http://localhost:${PORT}/`);
      await seed(page, data);

      for (const [path, name] of ROUTES) {
        const label = `${name}@${vp.name}/${appearance}`;
        await page.goto(`http://localhost:${PORT}${path}`);
        await page.waitForTimeout(400);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0) problems.push(`OVERFLOW ${label}: ${overflow}px`);

        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        for (const v of axe.violations) {
          problems.push(`AXE ${label}: ${v.id} (${v.nodes.length}) ${v.help}`);
          for (const n of v.nodes.slice(0, 2)) {
            const why = (n.failureSummary ?? '').split('\n').join(' ').slice(0, 170);
            problems.push(`     ${n.target.join(' ')} :: ${why}`);
          }
        }

        checks += 1;
        if (vp.name === '1280' || vp.name === '390') {
          await page.screenshot({ path: join(OUT, `${name}-${vp.name}-${appearance}.png`) });
        }
      }

      for (const e of errors) {
        /*
         * The API is not required for this sweep, and a transient network
         * blip is not a frontend defect either. Both are counted separately
         * so they cannot mask a real console error.
         */
        const tag = isApiDown(e)
          ? 'API-DOWN'
          : 'CONSOLE';
        problems.push(`${tag} ${appearance}@${vp.name}: ${e.slice(0, 120)}`);
      }
      await context.close();
    }
  }

  await browser.close();
  server.close();

  const real = problems.filter((p) => !p.startsWith('API-DOWN'));
  const apiDown = problems.length - real.length;

  console.log(
    `\n${checks} page checks (${ROUTES.length} routes x ${VIEWPORTS.length} widths x 2 themes)`,
  );
  if (apiDown > 0)
    console.log(`${apiDown} API-unavailable console messages (not frontend defects)`);
  if (real.length === 0) {
    console.log('CLEAN — 0 axe violations, 0 horizontal overflow, 0 frontend console errors');
  } else {
    console.log(`${real.length} problems:`);
    const seen = new Set();
    for (const p of real) {
      const key = p.replace(/@\d+/, '@*');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log('  ' + p);
    }
  }
  process.exit(real.length === 0 ? 0 : 1);
};

run();
