/**
 * Browser QA for the real result workflow.
 *
 * Authority: docs/22 §22.40 · docs/32 OQ-049 §40, §41
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A SECOND COPY OF visual-qa-seeded.mjs
 * ---------------------------------------------------------------------------
 *
 * That harness seeds a student whose results carry credits and grades and no
 * marks — which, since OQ-049, is a LEGACY record, and it is worth keeping
 * exactly as it is so the sweep goes on proving those still render. This one
 * seeds what a student copying a real card actually produces:
 *
 *   S1  8 subjects, fully graded          an SGPA exists
 *   S2  8 subjects, fully graded          a CGPA exists across semesters
 *   S3  8 subjects, one carried           a backlog is displayed
 *   S4  9 subjects, PROVISIONAL           marks and statuses, no grades,
 *                                         a CIE-only course, a missing credit,
 *                                         and a row whose SEE is unknown
 *
 * Nine subjects in one semester and eight in another, because a real card has
 * both and nothing in the product may assume either.
 *
 * The second half does what a unit test cannot: it drives the editor with a
 * keyboard and a mouse, types a contradictory total and checks the save is
 * refused, saves a good one, edits it back, and opens the mobile sheet at
 * 390px to read the SEE row.
 *
 *   node tests/results-qa.mjs                 # dark
 *   SCHEME=light OUT=.qa/results-light node tests/results-qa.mjs
 *
 * EVERY MARK BELOW IS INVENTED. The shapes come from real result cards; the
 * values do not, and no real academic record is used for QA.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/results');
/*
 * 4322, the same port the other seeded harness uses — because it is the origin
 * the API's CORS allowlist carries. Two harnesses on one port is fine: they are
 * never run at the same time, and a QA sweep whose console fills with CORS
 * failures cannot tell a real console error from its own setup.
 */
const PORT = 4322;

/* The four widths OQ-049 §40 requires. */
const VIEWPORTS = [
  { name: '320', width: 320, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
];

/* The routes the richer result data feeds. */
const ROUTES = [
  ['/results', 'results'],
  ['/', 'dashboard'],
  ['/semesters', 'degree'],
  ['/academics', 'gpa'],
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
/* Synthetic student. Invented codes and marks.                            */
/* ---------------------------------------------------------------------- */

const PID = 'p-demo';
const RULE_SET = 'vtu-2022-v1';
const GRADES = ['O', 'A+', 'A', 'B+', 'B', 'C', 'P'];

/** A fully graded semester: marks, grades and credits all present. */
function gradedSemester(number, count) {
  return {
    id: `res-${number}`,
    profileId: PID,
    semester: number,
    schemeId: 'vtu-2022',
    ruleSetId: RULE_SET,
    sgpaAsserted: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    subjects: Array.from({ length: count }, (_, i) => {
      const internal = 36 + ((i * 3) % 12);
      const external = 28 + ((i * 5) % 18);
      return {
        id: `res-${number}-s${i}`,
        subjectCode: `BQA${number}0${i}`,
        subjectTitle: `Synthetic Subject ${number}.${i + 1}`,
        internal,
        external,
        total: internal + external,
        resultStatus: 'P',
        announcedOn: '2026-03-13',
        gradeLetter: GRADES[(number + i) % 5],
        gradePoint: null,
        credits: [3, 4, 4, 3, 1, 3, 2, 4][i % 8],
        hasSee: true,
        provenance: 'manual',
      };
    }),
  };
}

function seedData() {
  const semesters = Array.from({ length: 8 }, (_, i) => ({
    id: `sem-${i + 1}`,
    profileId: PID,
    number: i + 1,
    status: i + 1 < 5 ? 'completed' : i + 1 === 5 ? 'in_progress' : 'planned',
    startedOn: null,
    completedOn: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  }));

  const s1 = gradedSemester(1, 8);
  const s2 = gradedSemester(2, 8);

  /* S3 carries one course: a SEE contribution of 17 is below the 17.5 minimum. */
  const s3 = gradedSemester(3, 8);
  s3.subjects[2] = {
    ...s3.subjects[2],
    internal: 40,
    external: 17,
    total: 57,
    resultStatus: 'F',
    gradeLetter: 'F',
  };

  /*
   * S4: NINE subjects, as a provisional card. Marks and statuses, and no grade
   * anywhere — so this semester has no SGPA and says why.
   */
  const s4 = {
    id: 'res-4',
    profileId: PID,
    semester: 4,
    schemeId: 'vtu-2022',
    ruleSetId: RULE_SET,
    sgpaAsserted: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    subjects: [
      ['BQA401', 'Analysis & Design of Algorithms', 44, 36, 80, 'P', 4, true],
      ['BQA402', 'Financial Management', 40, 19, 59, 'P', 3, true],
      ['BQA403', 'Database Management Systems', 39, 28, 67, 'P', 4, true],
      ['BQAL404', 'Algorithms Laboratory', 45, 49, 94, 'P', 1, true],
      ['BQA407', 'Biology for Engineers', 49, 30, 79, 'P', 3, true],
      ['BQA408', 'Universal Human Values', 33, 32, 65, 'P', 3, true],
      /* The CIE-only course: external 0, printed a pass, NOT a backlog. */
      ['BQAK459', 'Physical Education', 96, 0, 96, 'P', 0, false],
      /* A missing credit: the subject is not in the catalogue. */
      ['BQA405B', 'Graph Theory', 44, 22, 66, 'P', null, true],
      /* SEE applicability unknown: the backlog state must read "not known". */
      ['BQA456D', 'Business Communication', 46, 39, 85, null, 3, null],
    ].map(([code, title, internal, external, total, status, credits, hasSee], i) => ({
      id: `res-4-s${i}`,
      subjectCode: code,
      subjectTitle: title,
      internal,
      external,
      total,
      resultStatus: status,
      announcedOn: '2026-07-23',
      gradeLetter: null,
      gradePoint: null,
      credits,
      hasSee,
      provenance: 'manual',
    })),
  };

  return {
    profile: {
      id: PID,
      authUserId: null,
      displayName: 'Demo Student',
      usn: null,
      collegeName: 'Demo Institute of Technology',
      schemeId: 'vtu-2022',
      branch: 'cse',
      currentSemester: 5,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    semesters,
    results: [s1, s2, s3, s4],
    attendance: [],
    timetable: [],
    semesterSubjects: [],
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

  /* -------------------------------------------------------------------- */
  /* Part one: the sweep                                                  */
  /* -------------------------------------------------------------------- */

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
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

      /* The Semesters tab is where the result tables live. */
      if (name === 'results') {
        const tab = page.getByRole('tab', { name: /semesters/i });
        if (await tab.count()) {
          await tab.first().click();
          await page.waitForTimeout(350);
        }
      }

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

    /* ---- the editor, open, at every width ---------------------------- */
    await page.goto(`http://localhost:${PORT}/results`);
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: /add a semester/i }).click();
    await page.waitForTimeout(350);

    const editorOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (editorOverflow > 0) fail(`OVERFLOW editor@${vp.name}: ${editorOverflow}px`);

    const editorAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    for (const v of editorAxe.violations) {
      fail(`AXE editor@${vp.name}: ${v.id} (${v.nodes.length}) ${v.help}`);
    }
    await page.screenshot({ path: join(OUT, `editor-${vp.name}.png`), fullPage: true });

    if (errors.length) fail(`CONSOLE @${vp.name}: ${errors.slice(0, 3).join(' | ')}`);
    await context.close();
  }

  /* -------------------------------------------------------------------- */
  /* Part two: actually using it                                          */
  /* -------------------------------------------------------------------- */

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${PORT}/`);
  await seed(page, data);
  await page.goto(`http://localhost:${PORT}/results`);
  await page.waitForTimeout(450);

  /* ---- what the seeded data must already show ------------------------ */
  const overviewText = await page.locator('#main').innerText();
  expect(/CGPA/.test(overviewText), 'INTERACTION: no CGPA on the overview');
  expect(
    /could not be checked for a backlog/i.test(overviewText),
    'INTERACTION: an unknown-SEE row did not qualify the backlog count',
  );

  await page.getByRole('tab', { name: /semesters/i }).click();
  await page.waitForTimeout(350);
  const semesterText = await page.locator('#main').innerText();

  expect(/No SGPA yet/i.test(semesterText), 'INTERACTION: provisional S4 did not explain its SGPA');
  expect(
    /BQA405B/.test(semesterText),
    'INTERACTION: the subject missing credits was not named as the reason',
  );
  /* Nine rows in S4 and eight in S1, neither padded nor truncated. */
  const s4Rows = await page.locator('section[aria-labelledby="sem-4"] table tbody tr').count();
  const s1Rows = await page.locator('section[aria-labelledby="sem-1"] table tbody tr').count();
  expect(s4Rows === 9, `INTERACTION: semester 4 rendered ${s4Rows} rows, expected 9`);
  expect(s1Rows === 8, `INTERACTION: semester 1 rendered ${s1Rows} rows, expected 8`);

  /* ---- the CIE-only course reads as not applicable, not as a backlog -- */
  const peRow = page.locator('section[aria-labelledby="sem-4"] table tbody tr', {
    hasText: 'Physical Education',
  });
  const peText = await peRow.innerText();
  expect(!/Backlog/i.test(peText), `INTERACTION: CIE-only course marked a backlog — "${peText}"`);

  /* ---- a second result for a semester that has one is refused --------- */
  await page.getByRole('button', { name: /add a semester/i }).click();
  await page.waitForTimeout(300);
  await page.getByLabel(/^Semester$/).selectOption('3');
  await page.waitForTimeout(200);
  expect(
    (await page.getByText(/already has a result saved/i).count()) > 0,
    'INTERACTION: a duplicate semester was not refused',
  );

  /* ---- entering a row: a contradictory total must be refused ---------- */
  await page.getByLabel(/^Semester$/).selectOption('5');
  await page.waitForTimeout(200);
  await page.getByLabel(/subject code 1/i).fill('BQA999');
  await page.getByLabel(/internal 1/i).fill('44');
  await page.getByLabel(/external 1/i).fill('36');
  await page.getByLabel(/total 1/i).fill('90');
  await page.getByRole('button', { name: /save semester/i }).click();
  await page.waitForTimeout(300);

  expect(
    await page.getByText(/does not match/i).count(),
    'INTERACTION: a total that does not add up was accepted',
  );
  expect(
    (await page.getByLabel(/total 1/i).inputValue()) === '90',
    'INTERACTION: the contradictory total was silently corrected',
  );

  /* ---- correcting it saves ------------------------------------------- */
  await page.getByLabel(/total 1/i).fill('80');
  await page.getByLabel(/^Result 1$/).selectOption('P');
  await page.getByRole('button', { name: /save semester/i }).click();
  await page.waitForTimeout(500);

  await page.getByRole('tab', { name: /semesters/i }).click();
  await page.waitForTimeout(350);
  expect(
    (await page.getByText('BQA999').count()) > 0,
    'INTERACTION: the saved row did not appear in the semester list',
  );

  /* ---- editing it in place ------------------------------------------- */
  /*
   * SCROLL FIRST, THEN CLICK — which is what a person does anyway. The row menu
   * closes on scroll (it is anchored to its trigger, so a scrolled page would
   * leave it floating), and Chromium delivers the scroll event on the frame
   * AFTER the click that opened it. Letting the click do the scrolling opens
   * the menu and closes it again in the same gesture.
   */
  const menuTrigger = page.getByRole('button', { name: /actions for semester 3/i });
  await menuTrigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await menuTrigger.click();
  await page.waitForTimeout(300);
  expect(
    (await menuTrigger.getAttribute('aria-expanded')) === 'true',
    'INTERACTION: the row actions menu did not open',
  );
  await page.getByRole('menuitem', { name: /edit this semester/i }).click();
  await page.waitForTimeout(350);
  expect(
    (await page.getByLabel(/internal 1/i).inputValue()) !== '',
    'INTERACTION: the editor opened blank instead of on the stored values',
  );
  await page.screenshot({ path: join(OUT, 'edit-1280.png'), fullPage: true });
  await page
    .getByRole('button', { name: /^Cancel$/ })
    .first()
    .click();
  await page.waitForTimeout(250);

  await context.close();

  /* ---- the mobile sheet, at 390 -------------------------------------- */
  const narrow = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: scheme,
  });
  const phone = await narrow.newPage();
  phone.on('pageerror', (e) => errors.push(String(e)));
  await phone.goto(`http://localhost:${PORT}/`);
  await seed(phone, data);
  await phone.goto(`http://localhost:${PORT}/results`);
  await phone.waitForTimeout(450);
  await phone.getByRole('tab', { name: /semesters/i }).click();
  await phone.waitForTimeout(350);

  await phone
    .locator('section[aria-labelledby="sem-4"] button', { hasText: 'Physical Education' })
    .first()
    .click();
  await phone.waitForTimeout(400);

  const sheet = phone.getByRole('dialog');
  const sheetText = await sheet.innerText();
  expect(
    /Not applicable/i.test(sheetText),
    'INTERACTION: the CIE-only sheet did not say the SEE is not applicable',
  );
  expect(
    !/0 \/ 50/.test(sheetText),
    'INTERACTION: the CIE-only sheet printed a score out of the SEE maximum',
  );
  expect(/Backlog\s*\n?\s*No/i.test(sheetText), 'INTERACTION: the CIE-only sheet did not say No');
  await phone.screenshot({ path: join(OUT, 'sheet-cie-only-390.png') });

  const sheetOverflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (sheetOverflow > 0) fail(`OVERFLOW sheet@390: ${sheetOverflow}px`);

  const sheetAxe = await new AxeBuilder({ page: phone })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  for (const v of sheetAxe.violations) {
    fail(`AXE sheet@390: ${v.id} (${v.nodes.length}) ${v.help}`);
  }

  if (errors.length) fail(`CONSOLE interaction: ${errors.slice(0, 3).join(' | ')}`);
  await narrow.close();

  await browser.close();
  server.close();

  console.log(
    problems.length === 0
      ? `CLEAN (${scheme}): ${checks} interaction checks, 0 axe, 0 overflow, 0 console errors`
      : problems.join('\n'),
  );
  if (problems.length > 0) process.exitCode = 1;
};

run();
