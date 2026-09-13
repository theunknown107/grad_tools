/**
 * The timetable pipeline, against the REAL division timetable, privately.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE CONTAINS NO STUDENT DATA, AND MUST NOT ACQUIRE ANY
 * ---------------------------------------------------------------------------
 *
 * Every synthetic timetable harness proves the pipeline works on a grid
 * GradTools itself drew. A real division timetable carries what no generator
 * produces: a merged lab cell split between two batches, non-teaching hours
 * printed as words, blocks that are activities rather than courses, and a
 * legend the parser has to read before any of it means anything.
 *
 * So this drives the shipped importer against a document on disk and asserts
 * STRUCTURAL FACTS ONLY — how many classes, how many days, which non-teaching
 * blocks are present. It never prints a subject title, a member of staff or a
 * room, and it never writes any of them anywhere.
 *
 * The document and its expected shape live OUTSIDE the repository, in the
 * gitignored `.qa/real/truth.json`:
 *
 *   { "pilot": { "timetable": {
 *       "file": "…/Sem_5_Timetable.pdf",
 *       "expect": {
 *         "entries": 29,
 *         "days": 6,
 *         "requiresBatchChoice": true,
 *         "activities": ["Placement & Training"]
 *       } } } }
 *
 * Without that block the harness SKIPS and says so. A green run on a machine
 * that has no document is reported as "not verified" rather than as a pass —
 * the same contract real-document-qa.mjs keeps.
 *
 *   node tests/real-timetable-qa.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const TRUTH = resolve('.qa/real/truth.json');
const PORT = 4331;

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
  '.png': 'image/png',
};

function serve() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '/').split('?')[0];
      let file = join(DIST, url === '/' ? 'index.html' : url);
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

const problems = [];
let checks = 0;
const expect = (condition, message) => {
  checks += 1;
  if (!condition) problems.push(message);
};

async function readExpectation() {
  if (!existsSync(TRUTH)) return null;
  try {
    const truth = JSON.parse(await readFile(TRUTH, 'utf8'));
    const entry = truth?.pilot?.timetable;
    if (entry === undefined) return null;
    if (typeof entry.file !== 'string' || entry.expect === undefined) return null;
    if (!existsSync(entry.file)) return null;
    return entry;
  } catch {
    return null;
  }
}

const run = async () => {
  const entry = await readExpectation();
  if (entry === null) {
    console.log(
      '\n  SKIPPED - no real timetable to check against.\n' +
        '  Add pilot.timetable.file and pilot.timetable.expect to .qa/real/truth.json.\n' +
        '  NOT VERIFIED is not the same as passing.\n',
    );
    return;
  }

  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (event) => errors.push(String(event)));

  const origin = `http://localhost:${PORT}`;
  let classes = 0;
  let days = 0;
  let activities = [];

  try {
    /* A clean device: the week must come from the import, not from a fixture. */
    await page.goto(`${origin}/`);
    await page.evaluate(
      () =>
        new Promise((ok) => {
          const request = globalThis.indexedDB.deleteDatabase('keyval-store');
          request.onsuccess = () => ok();
          request.onerror = () => ok();
          request.onblocked = () => ok();
        }),
    );

    await page.goto(`${origin}/import`);
    await page.waitForTimeout(600);
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'timetable.pdf',
        mimeType: 'application/pdf',
        buffer: await readFile(entry.file),
      });

    /* Reading a real grid is slow; it is not hung. */
    await page
      .locator('text=/classes|rows read|could not|Failed|cannot read/i')
      .first()
      .waitFor({ timeout: 300_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1500);

    /*
     * A SPLIT LAB CANNOT BE SAVED UNTIL A BATCH IS CHOSEN.
     *
     * That is the whole reason the picker exists: the merged cell holds two
     * batches' classes and only one of them is this student's. Saving before
     * choosing would put somebody else's lab in their week.
     */
    const batchPicker = page.getByLabel(/your batch/i);
    const confirm = page.getByRole('button', { name: /confirm and save timetable/i }).first();

    if (entry.expect.requiresBatchChoice === true) {
      expect(
        (await batchPicker.count()) > 0,
        'TIMETABLE: a timetable with split batches did not ask which batch this is',
      );
      if ((await confirm.count()) > 0) {
        expect(
          await confirm.isDisabled(),
          'TIMETABLE: the timetable offered to save before a batch was chosen',
        );
      }
    }

    if ((await batchPicker.count()) > 0) {
      await batchPicker.first().selectOption({ index: 1 });
      await page.waitForTimeout(400);
    }

    expect((await confirm.count()) > 0, 'TIMETABLE: no way to confirm the timetable');
    if ((await confirm.count()) > 0) {
      await confirm.scrollIntoViewIfNeeded();
      await confirm.click();
      await page.waitForTimeout(1200);
    }

    /*
     * Read the STORE, not the screen. What was saved is the regression; which
     * tab happens to be showing afterwards is not.
     */
    const slots = await page.evaluate(
      () =>
        new Promise((ok) => {
          const open = globalThis.indexedDB.open('keyval-store', 1);
          open.onsuccess = () => {
            const request = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get('gradtools:v1:anon:timetable');
            request.onsuccess = () => ok(request.result ?? []);
            request.onerror = () => ok([]);
          };
          open.onerror = () => ok([]);
        }),
    );

    const wanted = entry.expect;
    classes = slots.filter((slot) => slot.subjectCode !== null).length;
    days = new Set(slots.map((slot) => slot.day)).size;
    activities = slots
      .filter((slot) => slot.subjectCode === null)
      .map((slot) => String(slot.activity ?? '').toLowerCase());

    /*
     * EVERY HOUR THE WEEK HOLDS, taught or not.
     *
     * The count that matters is the whole grid: a course hour and a named
     * non-teaching block are both entries a student sees on their week, and
     * splitting them into two numbers is how a harness ends up asserting that
     * an activity is a class.
     */
    expect(
      slots.length === wanted.entries,
      `TIMETABLE: ${String(slots.length)} entries stored (${String(classes)} taught, ` +
        `${String(activities.length)} not), expected ${String(wanted.entries)}`,
    );
    expect(
      days === wanted.days,
      `TIMETABLE: ${String(days)} days stored, expected ${String(wanted.days)}`,
    );

    /*
     * A BREAK IS TIME PASSING, NOT A CLASS, and none may reach the week as
     * one. The product states this rule; this is where a real document proves
     * it still holds.
     */
    expect(
      !slots.some((slot) => /break|lunch/i.test(String(slot.subjectCode ?? ''))),
      'TIMETABLE: a break or lunch was stored as a class',
    );

    /*
     * The named non-teaching blocks, by presence only. Every label compared
     * here comes from the expectation file, so no wording from a real document
     * is written into the repository.
     */
    for (const activity of wanted.activities ?? []) {
      expect(
        activities.some((name) => name.includes(String(activity).toLowerCase())),
        `TIMETABLE: no "${String(activity)}" block was stored`,
      );
    }

    expect(errors.length === 0, `TIMETABLE: ${String(errors.length)} page error(s)`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(
    `\n  stored: ${String(classes)} classes across ${String(days)} day(s), ` +
      `${String(activities.length)} non-teaching block(s)`,
  );
  console.log(`\n  ${String(checks)} checks, ${String(problems.length)} problems`);
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log('  Structural counts only. No title, room or member of staff is printed.\n');
  if (problems.length > 0) process.exitCode = 1;
};

await run();
