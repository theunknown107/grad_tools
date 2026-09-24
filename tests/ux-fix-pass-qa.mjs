/**
 * Targeted QA for this fix pass: timetable, profile, account, sign-in and a
 * result detail carrying a PE-like row, at 390/1280 x light/dark.
 *
 * Seeds IndexedDB directly (the same keys the local repositories write) so the
 * screens have the exact shape this pass is about: a course the catalogue does
 * not carry, whose credits the student recorded in their semester plan.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const PORT = Number(process.env.PORT ?? 4411);
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

const server = await new Promise((ok) => {
  const instance = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    let file = join(DIST, url);
    if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('no');
    }
  });
  instance.listen(PORT, () => ok(instance));
});

const results = [];
const check = (label, ok, detail = '') =>
  results.push({
    ok,
    line: `${ok ? 'PASS' : 'FAIL'} ${label}${detail === '' ? '' : ' - ' + detail}`,
  });

const SEED = {
  profile: {
    id: 'p1',
    displayName: 'Demo Student',
    usn: '1AB22CS001',
    collegeName: null,
    branch: 'Computer Science and Engineering',
    programme: null,
    schemeId: 'vtu-2022',
    currentSemester: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  timetable: [
    {
      id: 'a',
      classId: 'a',
      profileId: 'p1',
      day: 'Mon',
      startTime: '09:00',
      endTime: '09:50',
      subjectCode: 'BCS401',
      room: 'A101',
      faculty: null,
      activity: null,
    },
    {
      id: 'b',
      classId: 'b',
      profileId: 'p1',
      day: 'Mon',
      startTime: '10:00',
      endTime: '10:50',
      subjectCode: 'BCS402',
      room: 'A101',
      faculty: null,
      activity: null,
    },
    {
      id: 'c',
      classId: 'c',
      profileId: 'p1',
      day: 'Mon',
      startTime: '14:00',
      endTime: '17:00',
      subjectCode: 'BCSL404',
      room: 'Lab 2',
      faculty: null,
      activity: null,
    },
    {
      id: 'd',
      classId: 'd',
      profileId: 'p1',
      day: 'Tue',
      startTime: '09:00',
      endTime: '09:50',
      subjectCode: 'BCS403',
      room: 'A102',
      faculty: null,
      activity: null,
    },
    {
      id: 'e',
      classId: 'e',
      profileId: 'p1',
      day: 'Tue',
      startTime: '12:30',
      endTime: '13:20',
      subjectCode: null,
      room: null,
      faculty: null,
      activity: 'Lunch break',
    },
    {
      id: 'f',
      classId: 'f',
      profileId: 'p1',
      day: 'Wed',
      startTime: '11:00',
      endTime: '12:50',
      subjectCode: 'BPEK459',
      room: 'Ground',
      faculty: null,
      activity: null,
    },
  ],
  /* The PE row carries NO credits of its own - the defect this pass is about. */
  results: [
    {
      id: 'r4',
      profileId: 'p1',
      semester: 4,
      schemeId: 'vtu-2022',
      ruleSetId: 'vtu-2022-v1',
      sgpaAsserted: null,
      createdAt: '',
      updatedAt: '',
      subjects: [
        {
          id: 's1',
          subjectCode: 'BCS401',
          subjectTitle: 'Analysis and Design of Algorithms',
          internal: 44,
          external: 36,
          total: 80,
          resultStatus: 'P',
          announcedOn: null,
          gradeLetter: null,
          gradePoint: null,
          credits: 4,
          hasSee: true,
          provenance: 'manual',
          catalogueCode: null,
        },
        {
          id: 's2',
          subjectCode: 'BPEK459',
          subjectTitle: 'Physical Education (Sports and Athletics)',
          internal: 45,
          external: 40,
          total: 85,
          resultStatus: 'P',
          announcedOn: null,
          gradeLetter: null,
          gradePoint: null,
          credits: null,
          hasSee: true,
          provenance: 'manual',
          catalogueCode: null,
        },
      ],
    },
  ],
  /* ...but the student recorded them in their semester plan, which is the source. */
  semesterSubjects: [
    {
      id: 'plan-pe',
      profileId: 'p1',
      semester: 4,
      code: 'BPEK459',
      title: 'Physical Education (Sports and Athletics)',
      credits: 1,
      notes: null,
      updatedAt: '',
    },
  ],
};

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 844 : 900 },
    });
    await context.addInitScript(
      ([appearance, seed]) => {
        localStorage.setItem(
          'gradtools:v1:theme',
          JSON.stringify({
            appearance,
            accent: 'mono',
            reducedMotion: false,
            density: 'comfortable',
          }),
        );
        /* idb-keyval's defaults: database `keyval-store`, object store `keyval`. */
        const open = indexedDB.open('keyval-store', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('keyval');
        open.onsuccess = () => {
          const tx = open.result.transaction('keyval', 'readwrite');
          for (const [key, value] of Object.entries(seed))
            tx.objectStore('keyval').put(value, 'gradtools:v1:anon:' + key);
        };
      },
      [theme, SEED],
    );

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const at = theme + '@' + width;
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    const go = async (path) => {
      await page.goto('http://localhost:' + PORT + path);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(400);
    };

    /* ---- Dashboard standing ------------------------------------------- */
    await go('/');
    check(
      'dashboard ' + at + ': no horizontal overflow',
      (await overflow()) <= 0,
      (await overflow()) + 'px',
    );
    const standing = await page.evaluate(() => {
      const strip = document.querySelector('[data-testid="standing-strip"]');
      if (strip === null) return null;
      const cells = [...strip.querySelectorAll(':scope > [role="group"]')];
      return {
        cells: cells.length,
        /* Clipping, measured: content wider or taller than its cell was cut. */
        clipped: cells
          .filter(
            (one) =>
              one.scrollWidth > one.clientWidth + 1 || one.scrollHeight > one.clientHeight + 1,
          )
          .map((one) => one.getAttribute('aria-label')),
        /* Every cell in a row is as tall as the row, or the rules go ragged. */
        heights: [...new Set(cells.map((one) => Math.round(one.getBoundingClientRect().top)))].map(
          (top) =>
            new Set(
              cells
                .filter((one) => Math.round(one.getBoundingClientRect().top) === top)
                .map((one) => Math.round(one.getBoundingClientRect().height)),
            ).size,
        ),
        cgpaInStrip: cells.some((one) => one.getAttribute('aria-label') === 'CGPA'),
        /* Semester progress is said once, by the hero's bar, not again in the strip. */
        semesterCells: cells.filter((one) => /semester/i.test(one.getAttribute('aria-label') ?? ''))
          .length,
        progressBars: document.querySelectorAll(
          '[role="progressbar"][aria-label="Semesters graded"]',
        ).length,
        nestedPanel:
          document
            .querySelector('section[aria-labelledby="dashboard-title"]')
            ?.querySelector('.bg-panel, .rounded-xl') !== null,
      };
    });
    check(
      'dashboard ' + at + ': the standing is one strip of five figures',
      standing !== null && standing.cells === 5 && !standing.cgpaInStrip,
      JSON.stringify(standing),
    );
    check(
      'dashboard ' + at + ': semester progress is stated once',
      standing !== null && standing.semesterCells === 0 && standing.progressBars === 1,
      JSON.stringify(standing),
    );
    check(
      'dashboard ' + at + ': no standing figure is cut off, and every row is flush',
      standing !== null && standing.clipped.length === 0 && standing.heights.every((n) => n === 1),
      JSON.stringify(standing),
    );
    check(
      'dashboard ' + at + ': the hero holds no card inside it',
      standing !== null && !standing.nestedPanel,
      JSON.stringify(standing),
    );

    /* ---- Timetable ------------------------------------------------------ */
    await go('/timetable');
    check(
      'timetable ' + at + ': no horizontal overflow',
      (await overflow()) <= 0,
      (await overflow()) + 'px',
    );
    const grid = await page.evaluate(() => {
      /* Found by its test hook: a utility class is not an identity. */
      const root = document.querySelector('[data-testid="timetable-time-grid"]');
      if (root === null) return null;
      const visible = getComputedStyle(root).display !== 'none';
      const sessions = [...root.querySelectorAll('article[aria-label]')];
      const placed = sessions.map((one) => ({
        name: one.getAttribute('aria-label'),
        height: (one.parentElement ?? one).getBoundingClientRect().height,
      }));
      /*
       * CLIPPING, MEASURED. A session whose content is taller than its box has
       * had something cut off. Only a real browser lays text out, so this is
       * the one place the check can be made.
       */
      const clipped = sessions
        .filter((one) => one.scrollHeight > one.clientHeight + 1)
        .map((one) => one.getAttribute('aria-label'));
      return { visible, placed, clipped };
    });
    if (width >= 1024) {
      check(
        'timetable ' + at + ': the week is a time grid',
        grid !== null && grid.visible === true,
      );
      check(
        'timetable ' + at + ': no session has content cut off',
        grid !== null && grid.clipped.length === 0,
        grid === null ? 'no grid' : grid.clipped.slice(0, 3).join(' | '),
      );
      const lecture = grid?.placed.find((one) => one.name?.includes('Algorithms'));
      const lab = grid?.placed.find(
        (one) => one.name?.includes('Microcontroller') || one.name?.includes('BCSL404'),
      );
      check(
        'timetable ' + at + ': a 3-hour lab is drawn taller than a 50-minute class',
        lecture !== undefined && lab !== undefined && lab.height > lecture.height * 3,
        lecture === undefined || lab === undefined
          ? JSON.stringify(grid?.placed.map((one) => one.name))
          : Math.round(lecture.height) + 'px vs ' + Math.round(lab.height) + 'px',
      );
    } else {
      check(
        'timetable ' + at + ': the time grid is not shown at phone width',
        grid === null || grid.visible === false,
      );
      check(
        'timetable ' + at + ': the day list is shown instead',
        (await page.locator('ol[class~="lg:hidden"]').count()) > 0,
      );
    }

    /* ---- Profile -------------------------------------------------------- */
    await go('/profile');
    check(
      'profile ' + at + ': no horizontal overflow',
      (await overflow()) <= 0,
      (await overflow()) + 'px',
    );
    check(
      'profile ' + at + ': the cover banner is gone',
      (await page.locator('[class*="bg-linear-to-r"]').count()) === 0,
    );
    check(
      'profile ' + at + ': the name the student typed is shown',
      (await page.getByText('Demo Student').count()) > 0,
    );

    /* ---- Account and sign-in -------------------------------------------- */
    await go('/account');
    check(
      'account ' + at + ': no horizontal overflow',
      (await overflow()) <= 0,
      (await overflow()) + 'px',
    );

    await go('/sign-in');
    check(
      'sign-in ' + at + ': no horizontal overflow',
      (await overflow()) <= 0,
      (await overflow()) + 'px',
    );
    check(
      'sign-in ' + at + ': the email field is labelled',
      (await page.getByLabel(/^email$/i).count()) > 0,
    );

    /* ---- Result detail with a PE row ------------------------------------ */
    await go('/results/4');
    check(
      'result detail ' + at + ': no horizontal overflow',
      (await overflow()) <= 0,
      (await overflow()) + 'px',
    );
    const body = await page.evaluate(() => document.body.innerText);
    check('result detail ' + at + ': the PE course is listed', body.includes('BPEK459'));
    check(
      'result detail ' + at + ': its recorded credit is counted in the total',
      body.includes('5 credits'),
      body.includes('5 credits') ? '' : 'total not 5',
    );
    check(
      'result detail ' + at + ': the semester is graded rather than refused for want of credits',
      !/still (has|have) none/.test(body),
      /still (has|have) none/.test(body) ? 'SGPA still refused' : '',
    );

    check(at + ': no page errors on any screen', errors.length === 0, errors[0] ?? '');
    await context.close();
  }
}

await browser.close();
server.close();
for (const { line } of results) console.log(line);
const failed = results.filter((one) => !one.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
process.exitCode = failed.length === 0 ? 0 : 1;
