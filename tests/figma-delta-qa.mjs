/**
 * Screenshot every route, so the Figma port can be compared rather than
 * asserted.
 *
 * Authority: Phase Figma-port §3, §30, §31
 *
 * §30 is explicit that "tests pass" is not visual QA. This exists to produce
 * the left-hand side of the comparison: the real application, populated with
 * the repository's own seeded data, at the widths and appearances the brief
 * names. It asserts almost nothing — it is an instrument, not a gate.
 *
 * The one thing it DOES assert is horizontal overflow, because that is a
 * measurement rather than a judgement and §13 forbids hiding it.
 *
 *   node tests/figma-delta-qa.mjs            # 1280, both appearances
 *   node tests/figma-delta-qa.mjs --all      # every width in §13
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve('.qa/figma-delta');
const PORT = 4337;
const ALL = process.argv.includes('--all');

const WIDTHS = ALL ? [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920] : [1280];

/** Every destination the shell can reach, plus the two auth-adjacent ones. */
const ROUTES = [
  ['/', 'dashboard'],
  ['/announcements', 'announcements'],
  ['/notifications', 'notifications'],
  ['/semesters', 'degree'],
  ['/results', 'results'],
  ['/academics', 'sgpa'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable'],
  ['/exams', 'exams'],
  ['/import', 'add-document'],
  ['/account', 'account'],
  ['/profile', 'profile'],
];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
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
 * The repository's own shape of data, not the Figma prototype's.
 *
 * §5 and §24: the screenshots must show what GradTools would show. Course
 * codes are deliberately synthetic placeholders rather than a real student's
 * record, and the figures are the harness's own.
 */
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
      collegeName: 'Example Institute of Technology',
      branch: 'Computer Science and Engineering',
      programme: 'B.E.',
      schemeId: 'vtu-2022',
      currentSemester: 5,
      createdAt: '2026-09-01T00:00:00.000Z',
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

async function seed(page, payload) {
  await page.evaluate(async (data) => {
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
    await put(`${base}profile`, data.profile);
    await put(`${base}semesters`, data.semesters);
    await put(`${base}results`, data.results);
    await put(`${base}attendance`, data.attendance);
    await put(`${base}timetable`, data.timetable);
  }, payload);
}

const problems = [];
let checks = 0;

async function main() {
  if (!existsSync(DIST)) {
    console.error('apps/web/dist is missing. Run: pnpm --filter @gradtools/web build');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const data = seedData();

  try {
    for (const appearance of ['light', 'dark']) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: appearance,
          deviceScaleFactor: 1,
        });
        await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
        await context.addInitScript(
          (mode) =>
            window.localStorage.setItem(
              'gradtools:v1:theme',
              JSON.stringify({ appearance: mode, accent: 'mono' }),
            ),
          appearance,
        );

        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (event) => errors.push(String(event)));
        await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
        await seed(page, data);

        for (const [path, name] of ROUTES) {
          await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' });
          await page.waitForTimeout(220);

          /* §13. A measurement, not an opinion. */
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          checks += 1;
          if (overflow > 0) {
            problems.push(`${appearance} ${width} ${name}: horizontal overflow ${overflow}px`);
          }

          await page.screenshot({
            path: join(OUT, `${appearance}-${String(width)}-${name}.png`),
            fullPage: width <= 430,
          });
        }

        if (errors.length > 0)
          problems.push(`${appearance} ${width}: ${errors.length} page error(s)`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n  ${String(checks)} route renders, ${String(problems.length)} problems`);
  for (const problem of problems) console.log(`    ${problem}`);
  console.log(`  Screenshots in ${OUT}`);
  if (problems.length > 0) process.exitCode = 1;
}

await main();
