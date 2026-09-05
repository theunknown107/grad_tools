/**
 * The whole import workflow, driven in a real browser.
 *
 * Authority: docs/22 §22.56 · M10A.6C §6–§11, §17, §23, §25
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION
 * ---------------------------------------------------------------------------
 *
 * Not "can the parser read a line" — the unit tests answer that. This asks
 * whether a student can drop several real-shaped files in ONE action, see what
 * was read, correct it, confirm it, and have the ordinary academic system
 * update: SGPA, CGPA, percentage, backlogs, analytics, dashboard, degree.
 *
 * Four things here cannot be tested any smaller, and each has failed in a way
 * a unit test could not have caught:
 *
 *   A MULTI-SELECT is one `setInputFiles` call with four files, not four
 *   clicks. Sequential feeds hide races between files sharing one OCR worker.
 *
 *   A MULTI-PAGE card prints its semester on page one only. Rows on page two
 *   must join that semester rather than becoming a semester of their own.
 *
 *   A DUPLICATE and a REVISION look identical to a parser. Only the saved
 *   record distinguishes them, and only the screen can put the choice to a
 *   person.
 *
 *   THE CALCULATION CHAIN has to run through the ordinary academic engine. An
 *   imported result that needed its own calculator would be a second result
 *   model wearing the first one's clothes.
 *
 *   node tests/import-workflow-qa.mjs
 *   SCHEME=light OUT=.qa/workflow-light node tests/import-workflow-qa.mjs
 *
 * Requires a built app with its OCR assets vendored:
 *   pnpm --filter @gradtools/web build
 *
 * EVERY VALUE IS SYNTHETIC. Codes use a `BQ` prefix no VTU scheme issues and
 * the seat number is a deliberately impossible pattern.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { isApiDown } from './lib/console.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import {
  DRAW_CALENDAR,
  DRAW_CARD,
  calendarPdf,
  examSchedulePdf,
  graded,
  invoicePdf,
  multiPageResultPdf,
  resultPdf,
  scannedPdf,
  semesterCalendarPdf,
  timetablePdf,
} from './lib/documents.mjs';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/workflow');
const PORT = 4322;
const ORIGIN = `http://localhost:${PORT}`;

const VIEWPORTS = [
  { name: '320', width: 320, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
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

/** Subject rows for one semester, distinguishable per semester by their codes. */
const rowsFor = (semester, count = 3, marks = { internal: 40, external: 30 }) =>
  graded(`BQAS${String(semester)}0`, count, marks);

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const scheme = process.env.SCHEME === 'light' ? 'light' : 'dark';

  const problems = [];
  let checks = 0;
  const fail = (message) => problems.push(message);
  const expect = (condition, message) => {
    checks += 1;
    if (!condition) fail(message);
  };

  const requests = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
  });
  context.on('request', (request) => requests.push(request.url()));

  const page = await context.newPage();
  /*
   * The API is not running during this sweep and is not meant to be: the
   * harness serves the built bundle and nothing else, so the reference and
   * announcement fetches to localhost:3001 are refused. That is an environment
   * fact, not a frontend defect, and whether it is logged before an assertion
   * is a race — which made this harness flake. Classified the same way
   * tests/empty-qa.mjs already classifies it, and counted so it cannot hide a
   * real console error.
   */
  let apiDownCount = 0;
  const noteConsole = (sink) => (line) => {
    if (isApiDown(line)) apiDownCount += 1;
    else sink.push(line);
  };

  const consoleLines = [];
  page.on('console', (message) => {
    if (message.type() === 'error') noteConsole(consoleLines)(message.text());
  });
  page.on('pageerror', (error) => noteConsole(consoleLines)(String(error)));

  const report = { generatedAt: new Date().toISOString(), scheme, timings: {} };

  /* -------------------------------------------------------------------- */
  /* Helpers                                                              */
  /* -------------------------------------------------------------------- */

  /*
   * `/import` is where the product points a student who simply has documents.
   * Reached directly rather than through Results, because that is the whole
   * point of it existing (M10A.9 §6, §11).
   */
  const openImport = async (target = page) => {
    await target.goto(`${ORIGIN}/import`);
    await target.waitForTimeout(600);
    if ((await target.locator('input[type="file"]').count()) > 0) return;
    await target.goto(`${ORIGIN}/results`);
    await target.waitForTimeout(500);
    const opener = target.getByRole('button', { name: /add academic document/i });
    if (await opener.count()) await opener.first().click();
    await target.waitForTimeout(300);
  };

  /** Draws a card in the page and returns it as bytes of the requested type. */
  const drawCard = async (target, semester, rows, mime = 'image/png') => {
    const url = await target.evaluate(DRAW_CARD, {
      rows: rows.map((row) => row.slice(0, 6)),
      semester: String(semester),
      blur: 0,
      skew: 0,
      scale: 1,
      mime,
    });
    return Buffer.from(url.split(',')[1], 'base64');
  };

  /** ONE browser action, however many files. */
  const feed = async (target, files, { timeout = 240_000 } = {}) => {
    const started = Date.now();
    await target.locator('input[type="file"]').first().setInputFiles(files);
    await target
      .locator('text=/rows read|could not|Failed|already has a saved result/i')
      .first()
      .waitFor({ timeout })
      .catch(() => undefined);
    /* Every file must settle, not just the first one to say anything. */
    await target
      .waitForFunction(
        (count) => {
          const items = [...document.querySelectorAll('li')].filter((li) =>
            /rows read|Could not|could not|Waiting|Reading/i.test(li.textContent ?? ''),
          );
          return (
            items.length >= count &&
            items.every((li) => !/Waiting|Reading/i.test(li.textContent ?? ''))
          );
        },
        files.length,
        { timeout },
      )
      .catch(() => undefined);
    return Date.now() - started;
  };

  const mainText = async (target = page) => target.locator('#main').innerText();

  /** How many semesters are on offer for review right now. */
  const groupCount = async (target = page) =>
    target.locator('h3:has-text("Semester")').count();

  const storedResults = async (target = page) =>
    target.evaluate(
      () =>
        new Promise((ok) => {
          const open = globalThis.indexedDB.open('keyval-store', 1);
          open.onsuccess = () => {
            const request = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get('gradtools:v1:anon:results');
            request.onsuccess = () => ok(request.result ?? []);
            request.onerror = () => ok([]);
          };
          open.onerror = () => ok([]);
        }),
    );

  /* -------------------------------------------------------------------- */
  /* 1. FOUR FILES, FOUR FORMATS, ONE ACTION                              */
  /* -------------------------------------------------------------------- */

  await openImport();

  const pngCard = await drawCard(page, 2, rowsFor(2));
  const webpCard = await drawCard(page, 3, rowsFor(3), 'image/webp');
  const jpegCard = await drawCard(page, 4, rowsFor(4), 'image/jpeg');

  const multiMs = await feed(page, [
    { name: 'sem1.pdf', mimeType: 'application/pdf', buffer: resultPdf(1, rowsFor(1)) },
    { name: 'sem2.png', mimeType: 'image/png', buffer: pngCard },
    { name: 'sem3.webp', mimeType: 'image/webp', buffer: webpCard },
    { name: 'sem4.pdf', mimeType: 'application/pdf', buffer: scannedPdf(jpegCard, 1000, 700) },
  ]);
  report.timings.multiSelectFourFilesMs = multiMs;

  let text = await mainText();
  for (const name of ['sem1.pdf', 'sem2.png', 'sem3.webp', 'sem4.pdf']) {
    expect(text.includes(name), `MULTI: ${name} did not appear in the file list`);
  }
  for (const semester of [1, 2, 3, 4]) {
    expect(
      new RegExp(`Semester ${String(semester)}\\b`).test(text),
      `MULTI: semester ${String(semester)} was not detected from its own file`,
    );
  }
  expect(
    (await groupCount()) === 4,
    `MULTI: expected 4 semesters to review, saw ${String(await groupCount())}`,
  );
  /*
   * WebP end to end. A MIME switch in the code is not support; this is the
   * decode and the recognition actually happening (M10A.6C §33).
   */
  expect(
    /Semester 3\b/.test(text),
    'MULTI: the WebP card produced no reviewable semester — WebP is not actually supported',
  );
  await page.screenshot({ path: join(OUT, 'multi-select-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 2. PARTIAL FAILURE: one bad file must not take the others down       */
  /* -------------------------------------------------------------------- */

  await openImport();
  await feed(page, [
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: resultPdf(1, rowsFor(1)) },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: resultPdf(2, rowsFor(2)) },
    { name: 'c.pdf', mimeType: 'application/pdf', buffer: resultPdf(3, rowsFor(3)) },
    { name: 'd.pdf', mimeType: 'application/pdf', buffer: resultPdf(4, rowsFor(4)) },
    /* Not a PDF at all, whatever its name claims. */
    { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf at all') },
  ]);

  text = await mainText();
  expect(
    (await groupCount()) === 4,
    `PARTIAL: one bad file left ${String(await groupCount())} semesters instead of 4`,
  );
  expect(
    /could not be|Failed/i.test(text),
    'PARTIAL: the file that failed did not say so',
  );
  expect(text.includes('broken.pdf'), 'PARTIAL: the failed file left the list');
  await page.screenshot({ path: join(OUT, 'partial-failure-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 3. MULTI-PAGE: one card, two pages, ONE semester                     */
  /* -------------------------------------------------------------------- */

  await openImport();
  await feed(page, [
    {
      name: 'long.pdf',
      mimeType: 'application/pdf',
      /* The semester is printed on page one only, as a real card prints it. */
      buffer: multiPageResultPdf(5, rowsFor(5, 3), graded('BQAS59', 2)),
    },
  ]);

  text = await mainText();
  expect(
    (await groupCount()) === 1,
    `MULTIPAGE: two pages became ${String(await groupCount())} semesters instead of one`,
  );
  expect(/Semester 5\b/.test(text), 'MULTIPAGE: the semester on page one was lost');
  expect(
    /5 subjects/.test(text),
    `MULTIPAGE: page two's rows did not join the semester — "${/\d+ subjects/.exec(text)?.[0] ?? 'none'}"`,
  );
  await page.screenshot({ path: join(OUT, 'multi-page-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 4. REVISION: two files, one semester, different marks                */
  /* -------------------------------------------------------------------- */

  await openImport();
  await feed(page, [
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: resultPdf(6, rowsFor(6, 3)) },
    {
      name: 'revalued.pdf',
      mimeType: 'application/pdf',
      buffer: resultPdf(6, rowsFor(6, 3, { internal: 40, external: 44 })),
    },
  ]);

  text = await mainText();
  expect(
    (await groupCount()) === 1,
    'REVISION: two files for one semester were not brought together',
  );
  expect(
    /describe the same semester differently/i.test(text),
    'REVISION: the two files disagreed and the screen did not say so',
  );
  expect(
    /external: 70 → 84|external/i.test(text),
    'REVISION: the differing field was not named',
  );
  /*
   * NEITHER IS CHOSEN. A revaluation and the wrong file both have plausible
   * rows and arithmetic that adds up; only a person can tell them apart.
   */
  const confirmDisabled = await page
    .getByRole('button', { name: /confirm and save result/i })
    .first()
    .isDisabled()
    .catch(() => false);
  expect(confirmDisabled, 'REVISION: a conflicted semester offered to save anyway');
  await page.screenshot({ path: join(OUT, 'revision-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 5. CANCEL CHANGES NOTHING                                            */
  /* -------------------------------------------------------------------- */

  const beforeCancel = await storedResults();
  await page.getByRole('button', { name: /^(cancel|done)$/i }).first().click();
  await page.waitForTimeout(400);
  const afterCancel = await storedResults();
  expect(
    JSON.stringify(beforeCancel) === JSON.stringify(afterCancel),
    'CANCEL: leaving the review changed the stored record',
  );

  /* -------------------------------------------------------------------- */
  /* 6. SAVE, THEN THE CALCULATION CHAIN                                  */
  /* -------------------------------------------------------------------- */

  /*
   * Credits and a grade are typed during review, because a provisional card
   * prints neither. That is the student supplying what the document does not
   * carry — not the parser inventing it (§15, §20).
   */
  const saveSemester = async (semester, rows) => {
    await openImport();
    await feed(page, [
      {
        name: `s${String(semester)}.pdf`,
        mimeType: 'application/pdf',
        buffer: resultPdf(semester, rows),
      },
    ]);
    for (let index = 1; index <= rows.length; index += 1) {
      const credits = page.getByLabel(new RegExp(`^Credits ${String(index)}$`, 'i')).first();
      await credits.scrollIntoViewIfNeeded();
      await credits.fill('4');
      const grade = page.getByLabel(new RegExp(`^Grade ${String(index)}$`, 'i')).first();
      await grade.selectOption('A');
    }
    const confirm = page.getByRole('button', { name: /confirm and save result/i }).first();
    await confirm.scrollIntoViewIfNeeded();
    const started = Date.now();
    await confirm.click();
    await page.waitForTimeout(600);
    return Date.now() - started;
  };

  const saveMs = [];
  for (const semester of [1, 2, 3]) saveMs.push(await saveSemester(semester, rowsFor(semester, 3)));
  report.timings.saveMs = saveMs;

  const saved = await storedResults();
  expect(saved.length === 3, `SAVE: expected 3 stored results, found ${String(saved.length)}`);

  /* ---- Results, Analytics, Dashboard, Degree ------------------------- */
  const surfaces = {
    Results: '/results',
    Analytics: '/analytics',
    Dashboard: '/',
    Degree: '/semesters',
  };
  const seen = {};
  for (const [label, path] of Object.entries(surfaces)) {
    await page.goto(`${ORIGIN}${path}`);
    await page.waitForTimeout(700);
    seen[label] = await mainText();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`OVERFLOW ${label} after import: ${String(overflow)}px`);
    await page.screenshot({ path: join(OUT, `after-import-${label.toLowerCase()}.png`), fullPage: true });
  }

  expect(/SGPA/i.test(seen.Results), 'CHAIN: no SGPA on Results after importing graded semesters');
  expect(/CGPA/i.test(seen.Dashboard), 'CHAIN: no CGPA on the dashboard');
  expect(/Semester 1\b/.test(seen.Degree), 'CHAIN: the imported semester is not on the degree page');
  expect(
    /%|percentage/i.test(seen.Results) || /%|percentage/i.test(seen.Dashboard),
    'CHAIN: no percentage anywhere after import',
  );
  expect(/backlog/i.test(seen.Results), 'CHAIN: Results says nothing about backlogs');
  expect(
    !/error|failed|NaN|undefined/i.test(seen.Analytics),
    'CHAIN: Analytics is broken for imported results',
  );

  /* -------------------------------------------------------------------- */
  /* 7. DUPLICATE: the same semester again is blocked                     */
  /* -------------------------------------------------------------------- */

  await openImport();
  await feed(page, [
    { name: 'again.pdf', mimeType: 'application/pdf', buffer: resultPdf(1, rowsFor(1, 3)) },
  ]);
  expect(
    /already has a saved result/i.test(await mainText()),
    'DUPLICATE: importing a saved semester again was not blocked',
  );

  /*
   * A duplicate is recognised by its SEMESTER, not by its filename: the same
   * card under a different name is the same result (§11 fingerprint).
   */
  await openImport();
  await feed(page, [
    {
      name: 'completely-different-name.pdf',
      mimeType: 'application/pdf',
      buffer: resultPdf(1, rowsFor(1, 3)),
    },
  ]);
  expect(
    /already has a saved result/i.test(await mainText()),
    'DUPLICATE: renaming the file got a saved semester past the block',
  );

  const afterDuplicate = await storedResults();
  expect(
    afterDuplicate.length === 3,
    `UNIQUENESS: a blocked duplicate still changed the store to ${String(afterDuplicate.length)} results`,
  );
  await page.screenshot({ path: join(OUT, 'duplicate-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 8. EDIT AFTER IMPORT                                                 */
  /* -------------------------------------------------------------------- */

  await page.goto(`${ORIGIN}/results`);
  await page.waitForTimeout(700);
  const semesterTab = page.getByRole('tab', { name: /semesters/i });
  if (await semesterTab.count()) {
    await semesterTab.first().click();
    await page.waitForTimeout(400);
  }

  /*
   * Editing lives behind the semester's own actions menu — the same route a
   * student takes, rather than a control the harness knows about and a person
   * would have to hunt for.
   */
  const actions = page.getByRole('button', { name: /Actions for semester 1/i }).first();
  expect((await actions.count()) > 0, 'EDIT: the saved semester had no actions menu');
  await actions.scrollIntoViewIfNeeded();
  await actions.click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /edit this semester/i }).first().click();
  await page.waitForTimeout(600);

  const field = page.getByLabel(/^Internal 1$/i).first();
  expect((await field.count()) > 0, 'EDIT: the editor opened without an internal-marks field');
  await field.scrollIntoViewIfNeeded();
  await field.fill('47');

  const save = page.getByRole('button', { name: /save changes/i }).first();
  await save.scrollIntoViewIfNeeded();
  await save.click();
  await page.waitForTimeout(700);

  /*
   * AN EDIT THAT STOPS ADDING UP IS REFUSED, AND SAYS WHY.
   *
   * Raising one mark without its total leaves 47 + 30 against a printed 70.
   * The editor will not save that and will not silently recompute the total
   * either — the same rule the parser follows, applied where a person is doing
   * the changing (M10A.6C §12, §21).
   */
  expect(
    (await storedResults()).every((result) =>
      (result.subjects ?? []).every((subject) => subject.internal !== 47),
    ),
    'EDIT: a row whose marks no longer add up was saved anyway',
  );
  expect(
    /does not match/i.test(await mainText()),
    'EDIT: an inconsistent edit was blocked without saying why',
  );

  /* Correct the total as well, as a student reading their card would. */
  const totalField = page.getByLabel(/^Total 1$/i).first();
  await totalField.scrollIntoViewIfNeeded();
  await totalField.fill('77');
  await save.scrollIntoViewIfNeeded();
  await save.click();
  await page.waitForTimeout(800);

  const afterEdit = await storedResults();
  /*
   * NO DUPLICATE SEMESTER. Editing must change the record that exists, not add
   * a second one alongside it — the uniqueness invariant is the same whether a
   * result was typed or imported.
   */
  expect(
    afterEdit.length === 3,
    `EDIT: editing a result left ${String(afterEdit.length)} results instead of 3`,
  );
  expect(
    afterEdit.some((result) =>
      (result.subjects ?? []).some((subject) => subject.internal === 47),
    ),
    'EDIT: the corrected mark was not stored',
  );

  await page.reload();
  await page.waitForTimeout(800);
  /*
   * Durability is a property of the RECORD, not of whichever tab happens to be
   * showing after a reload. Asserting the rendered text here would pass or fail
   * on which tab the page opens with, which is not what "survives a reload"
   * means for a local-first store.
   */
  expect(
    (await storedResults()).some((result) =>
      (result.subjects ?? []).some((subject) => subject.internal === 47),
    ),
    'EDIT: the corrected mark did not survive a reload',
  );
  /* Results opens on Overview; the per-semester detail lives behind its tab. */
  const reloadedTab = page.getByRole('tab', { name: /semesters/i });
  if (await reloadedTab.count()) {
    await reloadedTab.first().click();
    await page.waitForTimeout(400);
  }
  const reloaded = await mainText();
  expect(/Semester 1\b/.test(reloaded), 'EDIT: the edited semester vanished after a reload');
  expect(/47/.test(reloaded), 'EDIT: the corrected mark is not shown after a reload');

  /* The change must reach the calculated figures too, not just the record. */
  await page.goto(`${ORIGIN}/analytics`);
  await page.waitForTimeout(700);
  expect(
    !/NaN|undefined|error/i.test(await mainText()),
    'EDIT: Analytics broke after a saved result was edited',
  );
  await page.screenshot({ path: join(OUT, 'after-edit-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 9. SECURITY: names and payloads that should do nothing at all        */
  /* -------------------------------------------------------------------- */

  let alerted = false;
  page.on('dialog', async (dialog) => {
    alerted = true;
    await dialog.dismiss();
  });

  await openImport();
  await feed(page, [
    {
      name: '<img src=x onerror=alert(1)>.pdf',
      mimeType: 'application/pdf',
      buffer: resultPdf(7, rowsFor(7, 2)),
    },
    {
      name: '../../../../etc/passwd.pdf',
      mimeType: 'application/pdf',
      buffer: resultPdf(8, rowsFor(8, 2)),
    },
    { name: 'malformed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 broken') },
    {
      /* A card whose printed "title" is markup. It is text and stays text. */
      name: 'markup.pdf',
      mimeType: 'application/pdf',
      buffer: resultPdf(7, [
        ['BQAS701', '<script>alert(1)</script>', '40', '30', '70', 'P', '2026-03-13'],
      ]),
    },
  ]);

  text = await mainText();
  expect(!alerted, 'SECURITY: a dialog was raised by a filename or a document');
  expect(
    (await page.locator('#main img[src="x"]').count()) === 0,
    'SECURITY: a filename was rendered as markup',
  );
  expect(
    (await page.locator('#main script').count()) === 0,
    'SECURITY: document text reached the page as a script element',
  );
  expect(
    text.includes('<img src=x onerror=alert(1)>.pdf'),
    'SECURITY: the hostile filename was not shown as plain text',
  );
  expect(
    text.includes('../../../../etc/passwd.pdf'),
    'SECURITY: a traversal-shaped name was not shown as plain text',
  );
  await page.screenshot({ path: join(OUT, 'security-1280.png'), fullPage: true });

  /* A very large image is refused by size, before any engine is started. */
  await openImport();
  const huge = Buffer.alloc(21 * 1024 * 1024, 0);
  await feed(page, [{ name: 'huge.png', mimeType: 'image/png', buffer: huge }], {
    timeout: 60_000,
  });
  expect(
    /larger than|could not/i.test(await mainText()),
    'SECURITY: a 21MB image was not refused',
  );

  /* -------------------------------------------------------------------- */
  /* 10. THE DOCUMENT DECIDES WHERE IT GOES                               */
  /* -------------------------------------------------------------------- */

  /*
   * Four documents in one action, none of them announced. The student picks no
   * parser; each file is classified from its own contents and routed or
   * refused (M10A.7 §7, §12, §39).
   */
  await openImport();
  await feed(page, [
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: calendarPdf() },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: examSchedulePdf() },
    { name: 'c.pdf', mimeType: 'application/pdf', buffer: timetablePdf() },
    { name: 'd.pdf', mimeType: 'application/pdf', buffer: invoicePdf() },
  ]);

  text = await mainText();
  expect(/Academic calendar 2026-27/i.test(text), 'ROUTER: the calendar was not detected');
  expect(
    /Commencement of classes/i.test(text),
    'ROUTER: the calendar was detected but its dates were not read',
  );
  expect(
    /examination time table/i.test(text),
    'ROUTER: a university exam schedule was not identified as one',
  );
  expect(
    /I \(E\) CSBS SEMESTER I/i.test(text),
    'ROUTER: a class timetable was not detected and read',
  );
  expect(
    /could not identify this as a result card, an academic calendar or a class timetable/i.test(
      text,
    ),
    'ROUTER: an invoice was not refused with a usable message',
  );
  /*
   * THE PAPERWORK IS NOT EVENTS. The fixture carries a notification number, a
   * reference and a distribution list, each with a date on it.
   */
  expect(
    !/Notification No|Copy to|Ref No/i.test(text),
    'ROUTER: a circular reference or distribution line became a calendar event',
  );
  expect(
    !/2026-27\/4718/.test(text),
    'ROUTER: a notification number was read as a date row',
  );
  await page.screenshot({ path: join(OUT, 'router-1280.png'), fullPage: true });

  /* ---- saving a calendar, and refusing the same one twice ------------- */
  const confirmCalendar = page.getByRole('button', { name: /confirm and save calendar/i }).first();
  expect((await confirmCalendar.count()) > 0, 'CALENDAR: no way to confirm the calendar was shown');
  await confirmCalendar.scrollIntoViewIfNeeded();
  await confirmCalendar.click();
  await page.waitForTimeout(700);

  const storedCalendars = await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const request = open.result
            .transaction('keyval', 'readonly')
            .objectStore('keyval')
            .get('gradtools:v1:anon:calendars');
          request.onsuccess = () => ok(request.result ?? []);
          request.onerror = () => ok([]);
        };
        open.onerror = () => ok([]);
      }),
  );
  expect(storedCalendars.length === 1, `CALENDAR: expected 1 saved calendar, found ${String(storedCalendars.length)}`);
  expect(
    (storedCalendars[0]?.events ?? []).length === 4,
    `CALENDAR: expected 4 dates, stored ${String((storedCalendars[0]?.events ?? []).length)}`,
  );
  /* The range stayed a range rather than becoming twenty daily rows. */
  expect(
    (storedCalendars[0]?.events ?? []).some((event) => event.endDate !== null),
    'CALENDAR: the examination span was not stored as a range',
  );
  report.calendar = {
    saved: storedCalendars.length,
    events: (storedCalendars[0]?.events ?? []).length,
    categories: (storedCalendars[0]?.events ?? []).map((event) => event.category),
  };

  await openImport();
  await feed(page, [{ name: 'again.pdf', mimeType: 'application/pdf', buffer: calendarPdf() }]);
  expect(
    /already imported this calendar/i.test(await mainText()),
    'CALENDAR: the same calendar was not recognised on a second upload',
  );

  /* -------------------------------------------------------------------- */
  /* 11. A TIMETABLE BECOMES THE STUDENT'S WEEK                           */
  /* -------------------------------------------------------------------- */

  /*
   * Imported on its own rather than relying on the router batch still being on
   * screen: the calendar checks above navigate away, which clears the panel.
   */
  await openImport();
  await feed(page, [{ name: 'week.pdf', mimeType: 'application/pdf', buffer: timetablePdf() }]);

  /*
   * The batch is the one question the document leaves open: a cell reading
   * `PHYE1/POPE2` is two classes and only the student knows which half they
   * are in (§23). Until it is answered, saving is refused.
   */
  const saveTimetable = page.getByRole('button', { name: /confirm and save timetable/i }).first();
  expect((await saveTimetable.count()) > 0, 'TIMETABLE: no way to confirm the timetable');
  expect(
    await saveTimetable.isDisabled(),
    'TIMETABLE: a timetable with split batches offered to save before a batch was chosen',
  );

  await page.getByLabel(/your batch/i).first().selectOption('E1');
  await page.waitForTimeout(300);
  await saveTimetable.scrollIntoViewIfNeeded();
  await saveTimetable.click();
  await page.waitForTimeout(800);

  const readStore = (key) =>
    page.evaluate(
      (name) =>
        new Promise((ok) => {
          const open = globalThis.indexedDB.open('keyval-store', 1);
          open.onsuccess = () => {
            const request = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get(name);
            request.onsuccess = () => ok(request.result ?? []);
            request.onerror = () => ok([]);
          };
          open.onerror = () => ok([]);
        }),
      key,
    );

  const slots = await readStore('gradtools:v1:anon:timetable');
  expect(slots.length > 0, 'TIMETABLE: nothing was saved');
  /* Breaks are time passing, not classes. None may reach the week (§19). */
  expect(
    !slots.some((slot) => /break|lunch/i.test(slot.subjectCode ?? '')),
    'TIMETABLE: a break was stored as a class',
  );
  /* The batch-split cell gave this student PHY on Tuesday, not POP. */
  const tuesday = slots.filter((slot) => slot.day === 'Tue');
  expect(
    tuesday.some((slot) => slot.subjectCode === 'BQHYS102'),
    'TIMETABLE: batch E1 did not get its own class from the split cell',
  );
  expect(
    !tuesday.some((slot) => slot.startTime === '10:00' && slot.subjectCode === 'BQOPS103'),
    "TIMETABLE: batch E1 was given the other batch's class",
  );
  /*
   * A LAB IS ONE CLASS, not one per column it covers (§25).
   *
   * The span ARITHMETIC is proved deterministically in the unit tests, where
   * the geometry is written down rather than measured off a rendered PDF. What
   * this asserts is the part that survives a real document: the lab appears
   * once, for the batches it names, and not as a run of fragments.
   */
  const labs = slots.filter((slot) => slot.day === 'Thu' && slot.subjectCode === 'BQATS101');
  expect(
    labs.length === 1,
    `TIMETABLE: the lab produced ${String(labs.length)} classes instead of one`,
  );
  const lab = labs[0];
  expect(
    lab !== undefined && lab.endTime > lab.startTime,
    'TIMETABLE: the lab has no usable interval',
  );

  report.timetable = {
    slots: slots.length,
    days: [...new Set(slots.map((slot) => slot.day))],
    labInterval: lab === undefined ? null : `${lab.startTime}-${lab.endTime}`,
  };
  await page.screenshot({ path: join(OUT, 'timetable-review-1280.png'), fullPage: true });

  /* ---- the same timetable again is a duplicate ----------------------- */
  await openImport();
  await feed(page, [{ name: 'again.pdf', mimeType: 'application/pdf', buffer: timetablePdf() }]);
  expect(
    /already imported this timetable/i.test(await mainText()),
    'TIMETABLE: the same timetable was not recognised on a second upload',
  );

  /* ---- an OLDER revision does not quietly take over ------------------ */
  await openImport();
  await feed(page, [
    {
      name: 'old.pdf',
      mimeType: 'application/pdf',
      buffer: timetablePdf({ revision: 'R1', effective: '01/07/2026' }),
    },
  ]);
  expect(
    /takes effect before the one you are already using/i.test(await mainText()),
    'TIMETABLE: an older revision was not flagged as older',
  );

  /* ---- and today's classes appear without any manual entry ----------- */
  await page.goto(`${ORIGIN}/timetable`);
  await page.waitForTimeout(800);
  const week = await mainText();
  expect(/BQATS101|BQHYS102|BQSCK104B/.test(week), 'TIMETABLE: the week view shows no imported classes');
  await page.screenshot({ path: join(OUT, 'timetable-week-1280.png'), fullPage: true });

  /* ---- the same calendar as a PICTURE goes down the same route ------- */
  /*
   * A photographed or scanned calendar is decoded and recognised by the very
   * pipeline the result cards use, then classified and parsed like any other
   * document. This proves the shared route, not a second OCR engine (§41).
   */
  await openImport();
  const calendarImage = await page.evaluate(DRAW_CALENDAR, {
    academicYear: '2027-28',
    rows: [
      ['Commencement of classes for the semester', '06 Sep 2027'],
      ['Last working day of the semester', '03 Dec 2027'],
    ],
    mime: 'image/jpeg',
  });
  const calendarJpeg = Buffer.from(calendarImage.split(',')[1], 'base64');
  await feed(page, [
    { name: 'scan.pdf', mimeType: 'application/pdf', buffer: scannedPdf(calendarJpeg, 1000, 560) },
  ]);
  const scannedText = await mainText();
  expect(
    /Academic calendar 2027-28/i.test(scannedText),
    'CALENDAR: a scanned calendar was not detected through the shared OCR path',
  );
  expect(
    /Commencement of classes/i.test(scannedText),
    'CALENDAR: a scanned calendar produced no dates',
  );
  report.scannedCalendar = { detected: /Academic calendar 2027-28/i.test(scannedText) };
  await page.screenshot({ path: join(OUT, 'calendar-scanned-1280.png'), fullPage: true });

  /* ---- a reissued calendar is a revision, and is not resolved --------- */
  await openImport();
  await feed(page, [
    {
      name: 'revised.pdf',
      mimeType: 'application/pdf',
      buffer: calendarPdf({
        rows: [
          ['Commencement of classes for the semester', '14 Sep 2026'],
          ['Last date for registration without late fee', '18 Sep 2026'],
        ],
      }),
    },
  ]);
  const revisedText = await mainText();
  expect(
    /already have a calendar for this term/i.test(revisedText),
    'CALENDAR: a second calendar for the same term was not flagged as a revision',
  );
  expect(
    /2026-09-07 → 2026-09-14/.test(revisedText),
    'CALENDAR: the revision did not name the date that moved',
  );
  await page.screenshot({ path: join(OUT, 'calendar-revision-1280.png'), fullPage: true });

  /* ---- and the dashboard shows ONE upcoming date --------------------- */
  await page.goto(`${ORIGIN}/`);
  await page.waitForTimeout(800);
  const dashboard = await mainText();
  expect(
    /Next on the calendar/i.test(dashboard),
    'DASHBOARD: an imported calendar produced no upcoming date',
  );
  expect(
    (dashboard.match(/Commencement of classes/gi) ?? []).length <= 1,
    'DASHBOARD: more than one calendar date was shown',
  );
  await page.screenshot({ path: join(OUT, 'dashboard-calendar-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 11b. THE HUB IS REACHABLE, AND MANUAL ENTRY IS STILL OFFERED         */
  /* -------------------------------------------------------------------- */

  await page.goto(`${ORIGIN}/`);
  await page.waitForTimeout(700);
  const home = await mainText();
  expect(/Add academic document/i.test(home), 'HUB: the dashboard offers no way to add a document');
  /* The scrapped feature is no longer advertised anywhere on the dashboard. */
  expect(
    !/Question papers/i.test(home),
    'HUB: the dashboard still points students at question papers',
  );

  await page.goto(`${ORIGIN}/import`);
  await page.waitForTimeout(700);
  const hub = await mainText();
  expect(
    (await page.locator('input[type="file"]').count()) > 0,
    'HUB: /import has no file input',
  );
  expect(
    /result card|academic calendar|class timetable/i.test(hub),
    'HUB: /import does not say which documents it takes',
  );
  /* Manual entry remains available, and visibly second (§15). */
  expect(/by hand|manually/i.test(hub), 'HUB: no manual fallback is offered');
  await page.screenshot({ path: join(OUT, 'import-hub-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 11c. ONE SEMESTER, FROM THREE DOCUMENTS                              */
  /* -------------------------------------------------------------------- */

  /*
   * THE WHOLE POINT OF THE PRODUCT, in one pass. A student uploads a calendar,
   * a timetable and two result cards, and then opens GradTools to find their
   * term already organised — dates, classes, marks and the figures that follow
   * from them — without typing any of it twice (M10A.10 §4, §42, §43).
   */
  await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readwrite').objectStore('keyval');
          for (const key of ['results', 'calendars', 'timetable', 'timetableImports', 'attendance']) {
            store.delete(`gradtools:v1:anon:${key}`);
          }
          ok(true);
        };
        open.onerror = () => ok(false);
      }),
  );

  await openImport();
  const semesterStart = Date.now();
  await feed(page, [
    { name: 'calendar.pdf', mimeType: 'application/pdf', buffer: semesterCalendarPdf() },
    { name: 'week.pdf', mimeType: 'application/pdf', buffer: timetablePdf() },
    { name: 's1.pdf', mimeType: 'application/pdf', buffer: resultPdf(1, rowsFor(1, 3)) },
    { name: 's2.pdf', mimeType: 'application/pdf', buffer: resultPdf(2, rowsFor(2, 3)) },
  ]);
  report.timings.semesterFourDocumentsMs = Date.now() - semesterStart;

  text = await mainText();
  expect(/Academic calendar/i.test(text), 'SEMESTER: the calendar was not detected in the batch');
  expect(/CSBS SEMESTER I/i.test(text), 'SEMESTER: the timetable was not detected in the batch');
  expect(
    (await page.locator('h3:has-text("Semester")').count()) >= 2,
    'SEMESTER: both result cards were not offered for review',
  );

  /* Confirm all four, in the order a student would meet them. */
  await page.getByRole('button', { name: /confirm and save calendar/i }).first().click();
  await page.waitForTimeout(400);
  await page.getByLabel(/your batch/i).first().selectOption('E1');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /confirm and save timetable/i }).first().click();
  await page.waitForTimeout(400);

  /*
   * Drained rather than indexed: confirming a semester replaces its button with
   * a "Saved" pill, so the list shrinks under `nth()` and the second card never
   * gets pressed. Always take the first one still offering to save.
   */
  for (let guard = 0; guard < 6; guard += 1) {
    const confirm = page.getByRole('button', { name: /confirm and save result/i }).first();
    if ((await confirm.count()) === 0) break;
    await confirm.scrollIntoViewIfNeeded();
    await confirm.click();
    await page.waitForTimeout(600);
  }

  /* ---- and now the product, with nothing typed by hand ---------------- */
  const surface = async (path) => {
    await page.goto(`${ORIGIN}${path}`);
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`OVERFLOW ${path} after the semester import: ${String(overflow)}px`);
    return mainText();
  };

  const organised = await surface('/');
  expect(/Next on the calendar/i.test(organised), 'SEMESTER: the dashboard shows no calendar date');
  expect(/Today/i.test(organised), 'SEMESTER: the dashboard shows no day view');
  expect(/CGPA/i.test(organised), 'SEMESTER: the dashboard shows no academic standing');

  const classes = await surface('/timetable');
  expect(/BQATS101|BQHYS102|BQSCK104B/.test(classes), 'SEMESTER: the week view has no classes');
  /* Attendance is markable from the classes themselves, not a second screen. */
  expect(
    (await page.getByRole('button', { name: /attended|missed/i }).count()) > 0,
    'SEMESTER: today’s classes offer no way to record attendance',
  );

  const marks = await surface('/results');
  expect(/SGPA|CGPA/i.test(marks), 'SEMESTER: Results shows no calculated figures');

  const analytics = await surface('/analytics');
  expect(
    !/NaN|undefined|error/i.test(analytics),
    'SEMESTER: Analytics is broken after a full semester import',
  );

  const degree = await surface('/semesters');
  expect(/Semester 1\b/.test(degree), 'SEMESTER: the degree page has no imported semester');

  const stored = await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readonly').objectStore('keyval');
          const out = {};
          let pending = 4;
          for (const key of ['results', 'calendars', 'timetable', 'timetableImports']) {
            const request = store.get(`gradtools:v1:anon:${key}`);
            request.onsuccess = () => {
              out[key] = (request.result ?? []).length;
              if (--pending === 0) ok(out);
            };
            request.onerror = () => {
              out[key] = -1;
              if (--pending === 0) ok(out);
            };
          }
        };
        open.onerror = () => ok({});
      }),
  );

  /* No duplicates: one calendar, one active week, two results (§43). */
  expect(stored.calendars === 1, `SEMESTER: ${String(stored.calendars)} calendars stored, expected 1`);
  expect(stored.results === 2, `SEMESTER: ${String(stored.results)} results stored, expected 2`);
  expect(stored.timetable > 0, 'SEMESTER: no timetable slots stored');
  report.semester = stored;
  await page.screenshot({ path: join(OUT, 'semester-dashboard.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 11d. THE DAILY LOOP: TODAY, ONE TAP, AND NEVER TWICE                 */
  /* -------------------------------------------------------------------- */

  /*
   * THE MORNING AFTER THE IMPORT (M10A.11 §7, §9, §13, §19, §23).
   *
   * The semester is already in storage. This is the student opening the app on
   * an ordinary Monday: the week is there, today's classes are there, and the
   * question is whether one class can be answered for — once, correctly, and
   * reversibly.
   *
   * The clock is PINNED to a Monday at 10:30 rather than read from the machine.
   * Every assertion below is about "today", and a harness that reads the real
   * date is correct six days a week and broken on the seventh — Sunday is not a
   * teaching day, so today's agenda would be empty for reasons that have
   * nothing to do with the code under test.
   */
  const daily = await context.newPage();
  daily.on('console', (message) => {
    if (message.type() === 'error') noteConsole(consoleLines)(message.text());
  });
  daily.on('pageerror', (error) => noteConsole(consoleLines)(String(error)));
  await daily.clock.setFixedTime(new Date('2026-09-07T10:30:00'));

  /** One collection, as the browser actually stored it. */
  const storedList = (key) =>
    daily.evaluate(
      (name) =>
        new Promise((ok) => {
          const open = globalThis.indexedDB.open('keyval-store', 1);
          open.onsuccess = () => {
            const request = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get(`gradtools:v1:anon:${name}`);
            request.onsuccess = () => ok(request.result ?? []);
            request.onerror = () => ok([]);
          };
          open.onerror = () => ok([]);
        }),
      key,
    );

  const openToday = async () => {
    await daily.goto(`${ORIGIN}/timetable`);
    await daily.waitForTimeout(800);
  };

  await openToday();

  /* Which timetable is this? Read at import since M10A.8, shown since now. */
  const todayScreen = await daily.locator('main').innerText();
  expect(/R2/.test(todayScreen), 'DAILY: the timetable does not say which revision it is');
  expect(/Nov 2026/.test(todayScreen), 'DAILY: the timetable does not show its effective date');
  /*
   * The fixture's W.E.F. is in November and the pinned day is September, so
   * this timetable is active but not yet in effect — a fact the student is
   * entitled to rather than one the screen settles quietly (§24).
   */
  expect(
    /take effect on/i.test(todayScreen),
    'DAILY: a not-yet-effective timetable says nothing',
  );

  const attendedButton = daily.getByRole('button', { name: /attended$/i }).first();
  expect(
    (await daily.getByRole('button', { name: /attended$/i }).count()) > 0,
    'DAILY: today offers no way to record a class',
  );

  /*
   * TWO TAPS ARE ONE CLASS (§13). This is the defect the stored mark exists to
   * prevent, and it is invisible without counting: nothing on screen looks
   * wrong when a lecture is recorded twice.
   */
  const markStart = Date.now();
  await attendedButton.click();
  await daily
    .getByRole('button', { name: /attended$/i })
    .first()
    .and(daily.locator('[aria-pressed="true"]'))
    .waitFor({ timeout: 5000 });
  report.timings.markClassMs = Date.now() - markStart;
  await attendedButton.click();
  await daily.waitForTimeout(400);

  let dayCounts = await storedList('attendance');
  let dayMarks = await storedList('classMarks');
  expect(dayMarks.length === 1, `DAILY: ${String(dayMarks.length)} marks after two taps, expected 1`);
  expect(
    dayCounts.length === 1 && dayCounts[0].conducted === 1 && dayCounts[0].attended === 1,
    `DAILY: two taps produced ${JSON.stringify(dayCounts.map((r) => [r.attended, r.conducted]))}`,
  );
  expect(
    (await attendedButton.getAttribute('aria-pressed')) === 'true',
    'DAILY: a marked class does not say it is marked',
  );

  /* A correction moves one counter. The class happened either way (§29). */
  await daily.getByRole('button', { name: /missed$/i }).first().click();
  await daily.waitForTimeout(400);
  dayCounts = await storedList('attendance');
  expect(
    dayCounts[0].attended === 0 && dayCounts[0].conducted === 1,
    `DAILY: correcting to missed gave ${String(dayCounts[0].attended)}/${String(dayCounts[0].conducted)}`,
  );

  /* And the whole thing can be taken back, counts and all (§14, §30). */
  const undoStart = Date.now();
  await daily.getByRole('button', { name: /^undo$/i }).click();
  await daily.getByRole('button', { name: /^undo$/i }).waitFor({ state: 'detached', timeout: 5000 });
  report.timings.undoMs = Date.now() - undoStart;
  await daily.waitForTimeout(400);
  dayCounts = await storedList('attendance');
  dayMarks = await storedList('classMarks');
  expect(dayMarks.length === 0, 'DAILY: undo left the mark behind');
  expect(
    dayCounts[0].attended === 0 && dayCounts[0].conducted === 0,
    'DAILY: undo did not return the counts to where they started',
  );

  /* The same action from the keyboard alone (§49). */
  await attendedButton.focus();
  await daily.keyboard.press('Enter');
  await daily.waitForTimeout(400);
  dayMarks = await storedList('classMarks');
  expect(dayMarks.length === 1, 'DAILY: a class cannot be marked from the keyboard');
  await daily.getByRole('button', { name: /^undo$/i }).click();
  await daily.waitForTimeout(300);

  const dailyAxe = await new AxeBuilder({ page: daily })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  for (const violation of dailyAxe.violations) {
    fail(`AXE today: ${violation.id} (${violation.nodes.length}) ${violation.help}`);
  }
  await daily.screenshot({ path: join(OUT, 'daily-today.png'), fullPage: true });

  /*
   * THE ACTIONS MUST BE REACHABLE ON A PHONE (§48).
   *
   * Today's row carries a time, a subject, two attendance buttons and a delete
   * — five things across 320px, above a fixed bottom navigation. jsdom has no
   * layout and cannot see either failure: a row that overflows the viewport, or
   * a button that renders underneath the nav bar and cannot be tapped at all.
   */
  for (const vp of VIEWPORTS) {
    await daily.setViewportSize({ width: vp.width, height: vp.height });
    await daily.waitForTimeout(300);

    const overflow = await daily.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`OVERFLOW today@${vp.name}: ${String(overflow)}px`);

    const reachable = await daily
      .getByRole('button', { name: /attended$/i })
      .first()
      .isVisible();
    expect(reachable, `DAILY: the attendance action is not visible at ${vp.name}px`);
  }
  await daily.setViewportSize({ width: 1280, height: 900 });
  await daily.waitForTimeout(300);

  /*
   * A DAY THE COLLEGE IS SHUT (§19, §20). The calendar is seeded directly here
   * rather than imported: the import path for a revised calendar is already
   * covered above, and what needs proving is that a printed holiday removes
   * today's classes AND the actions on them.
   */
  await daily.evaluate(
    (day) =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readwrite').objectStore('keyval');
          const read = store.get('gradtools:v1:anon:calendars');
          read.onsuccess = () => {
            const calendars = read.result ?? [];
            const first = calendars[0] ?? {};
            store.put(
              [
                {
                  ...first,
                  id: 'holiday-check',
                  fingerprint: 'holiday-check',
                  importedAt: new Date().toISOString(),
                  events: [
                    {
                      id: 'h1',
                      startDate: day,
                      endDate: null,
                      title: 'Institution holiday',
                      category: 'HOLIDAY',
                      sourceLine: `${day} Institution holiday`,
                      page: 1,
                    },
                  ],
                },
              ],
              'gradtools:v1:anon:calendars',
            );
            ok(true);
          };
          read.onerror = () => ok(false);
        };
        open.onerror = () => ok(false);
      }),
    '2026-09-07',
  );

  await openToday();
  const shut = await daily.locator('main').innerText();
  expect(/Institution holiday/.test(shut), 'DAILY: a printed holiday is not shown');
  expect(/academic calendar/i.test(shut), 'DAILY: the holiday does not say where it came from');
  expect(
    (await daily.getByRole('button', { name: /attended$/i }).count()) === 0,
    'DAILY: a holiday still offers dayCounts for classes that could not have happened',
  );
  await daily.screenshot({ path: join(OUT, 'daily-holiday.png'), fullPage: true });

  report.daily = { marksAfterUndo: dayMarks.length, attendance: dayCounts.length };
  await daily.close();

  /* -------------------------------------------------------------------- */
  /* 12. THE RAW FILE IS NOT KEPT                                         */
  /* -------------------------------------------------------------------- */

  /*
   * Read out of storage rather than off the code. "We do not persist the file"
   * is a claim about what is on the device afterwards, and the only honest way
   * to check it is to look at what is on the device afterwards: every key in
   * the local store, inspected for the bytes of a document.
   */
  const stores = await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readonly').objectStore('keyval');
          const keys = store.getAllKeys();
          const values = store.getAll();
          keys.onsuccess = () => {
            values.onsuccess = () => {
              ok(
                keys.result.map((key, index) => {
                  const value = values.result[index];
                  const json = (() => {
                    try {
                      return JSON.stringify(value) ?? '';
                    } catch {
                      return '';
                    }
                  })();
                  return {
                    key: String(key),
                    bytes: json.length,
                    binary:
                      value instanceof ArrayBuffer ||
                      ArrayBuffer.isView(value) ||
                      value instanceof Blob,
                    pdfHeader: json.includes('%PDF') || json.includes('JVBERi'),
                    dataUrl: json.includes('data:image') || json.includes('base64,'),
                  };
                }),
              );
            };
          };
        };
        open.onerror = () => ok([]);
      }),
  );

  /*
   * TWO KINDS OF THING LIVE IN THIS STORE, AND ONLY ONE OF THEM IS OURS.
   *
   * tesseract.js caches its language model in IndexedDB, under the same
   * `keyval-store` database idb-keyval uses — it appears as `./eng.traineddata`
   * and is large. That is the ENGINE keeping its own model so a student does
   * not re-download six megabytes on every import, and it is desirable: it is
   * what makes the feature work offline.
   *
   * What must not be there is a DOCUMENT. So the assertions are made against
   * GradTools' own keys, and the engine's cache is identified explicitly rather
   * than waved through by a size threshold that would also wave through a
   * stored PDF.
   */
  const ours = stores.filter((entry) => entry.key.startsWith('gradtools:'));
  const engine = stores.filter((entry) => /traineddata|tesseract/i.test(entry.key));
  const unaccounted = stores.filter(
    (entry) => !ours.includes(entry) && !engine.includes(entry),
  );

  expect(ours.length > 0, 'RETENTION: no GradTools data was stored at all — did the save work?');
  expect(
    ours.every((entry) => !entry.binary),
    `RETENTION: a binary value was stored under ${ours.find((e) => e.binary)?.key ?? '?'}`,
  );
  expect(
    ours.every((entry) => !entry.pdfHeader && !entry.dataUrl),
    `RETENTION: document bytes were persisted under ${
      ours.find((e) => e.pdfHeader || e.dataUrl)?.key ?? '?'
    }`,
  );
  /*
   * A size ceiling on OUR keys. A stored semester is a few kilobytes of
   * numbers; anything approaching the size of a card would mean a document had
   * been kept, whatever form it took.
   */
  const largest = ours.reduce((max, entry) => Math.max(max, entry.bytes), 0);
  expect(
    largest < 200_000,
    `RETENTION: the largest GradTools value is ${String(largest)} bytes, too big to be results alone`,
  );
  expect(
    unaccounted.length === 0,
    `RETENTION: something unrecognised is in local storage: ${unaccounted.map((e) => e.key).join(', ')}`,
  );
  report.storage = {
    gradtools: ours.map(({ key, bytes }) => ({ key, bytes })),
    engineCache: engine.map(({ key, bytes }) => ({ key, bytes })),
  };

  /* Nothing in sessionStorage or localStorage either. */
  const webStorage = await page.evaluate(() =>
    ['localStorage', 'sessionStorage'].flatMap((name) => {
      const store = globalThis[name];
      return Object.keys(store).map((key) => ({
        store: name,
        key,
        bytes: (store.getItem(key) ?? '').length,
        suspicious: /%PDF|JVBERi|data:image|base64,/.test(store.getItem(key) ?? ''),
      }));
    }),
  );
  expect(
    webStorage.every((entry) => !entry.suspicious),
    'RETENTION: document bytes were left in local or session storage',
  );

  /* -------------------------------------------------------------------- */
  /* 13. NOTHING LEFT THE ORIGIN                                          */
  /* -------------------------------------------------------------------- */

  const OWN = [ORIGIN, 'http://localhost:3001', 'data:', 'blob:'];
  const offOrigin = requests.filter((url) => !OWN.some((prefix) => url.startsWith(prefix)));
  expect(
    offOrigin.length === 0,
    `PRIVACY: ${String(offOrigin.length)} request(s) left the origin: ${offOrigin.slice(0, 4).join(', ')}`,
  );
  const posted = requests.filter((url) => url.includes('/upload') || url.includes('/ocr-api'));
  expect(posted.length === 0, 'PRIVACY: something that looks like an upload endpoint was called');
  report.requests = {
    total: requests.length,
    offOrigin: offOrigin.length,
    ocrAssets: [...new Set(requests.filter((u) => u.includes('/ocr/')).map((u) => u.slice(ORIGIN.length)))],
  };

  if (consoleLines.length > 0) fail(`CONSOLE: ${consoleLines.slice(0, 3).join(' | ')}`);
  await context.close();

  /* -------------------------------------------------------------------- */
  /* 14. THE SWEEP: every width, the chosen theme                         */
  /* -------------------------------------------------------------------- */

  for (const vp of VIEWPORTS) {
    const sized = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
    const sizedPage = await sized.newPage();
    const sizedErrors = [];
    sizedPage.on('console', (m) => {
      if (m.type() === 'error') noteConsole(sizedErrors)(m.text());
    });
    sizedPage.on('pageerror', (e) => noteConsole(sizedErrors)(String(e)));

    await openImport(sizedPage);
    const card = await drawCard(sizedPage, 2, rowsFor(2));
    await feed(sizedPage, [
      { name: 'sem1.pdf', mimeType: 'application/pdf', buffer: resultPdf(1, rowsFor(1)) },
      { name: 'sem2.png', mimeType: 'image/png', buffer: card },
      { name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('nope') },
    ]);

    const overflow = await sizedPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`OVERFLOW workflow@${vp.name}: ${String(overflow)}px`);

    const axe = await new AxeBuilder({ page: sizedPage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    for (const violation of axe.violations) {
      fail(`AXE workflow@${vp.name}: ${violation.id} (${violation.nodes.length}) ${violation.help}`);
    }

    await sizedPage.screenshot({
      path: join(OUT, `workflow-${vp.name}.png`),
      fullPage: vp.name === '1280' || vp.name === '390',
    });
    if (sizedErrors.length) fail(`CONSOLE workflow@${vp.name}: ${sizedErrors.slice(0, 3).join(' | ')}`);
    await sized.close();
  }

  await browser.close();
  server.close();

  report.checks = checks;
  report.problems = problems;
  await writeFile(join(OUT, 'workflow-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n  Multi-select of four files: ${String(multiMs)}ms`);
  console.log(`  Save (three semesters): ${saveMs.map((ms) => `${String(ms)}ms`).join(', ')}`);
  console.log(`  Requests off-origin: ${String(report.requests.offOrigin)}`);
  console.log(`  API-unavailable console messages: ${String(apiDownCount)} (not frontend defects)`);
  console.log(
    `  Mark a class: ${String(report.timings.markClassMs)}ms · undo: ${String(report.timings.undoMs)}ms`,
  );
  console.log(`  Report: ${join(OUT, 'workflow-report.json')}`);
  console.log(`\n  ${String(checks)} checks, ${String(problems.length)} problems`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(problems.length === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
