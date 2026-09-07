/**
 * The academic chain, end to end, on the real result cards.
 *
 * Authority: Phase 7B.1 §7, §9 · docs/12 §12.18
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ASKS THAT NOTHING ELSE DOES
 * ---------------------------------------------------------------------------
 *
 * `real-document-qa` proves the four cards PARSE. `import-workflow-qa` proves
 * the chain computes, on synthetic cards. Neither runs the chain on the real
 * ones, and the chain is where Phase 7B found its bugs: the grade that never
 * reached the SGPA, the credits that came only from a network the app cannot
 * reach, the five-letter codes the rules package rejected.
 *
 * So this drives all four real cards through upload, review, confirm and save,
 * and then reads what the product says about the result: subject counts, SGPA
 * per semester, CGPA across them, and the backlog state.
 *
 * ---------------------------------------------------------------------------
 * THE CREDITS ARE THE HARNESS'S, AND THE SGPA IS THEREFORE NOT THE STUDENT'S
 * ---------------------------------------------------------------------------
 *
 * A VTU result card prints no credits, and the reference catalogue needs an API
 * that is not running here. So the harness types a credit into every row, the
 * way a student would, and the SGPA that comes out is a PIPELINE CHECK — proof
 * that credits plus grades produce a figure through the real engine. It is not
 * this student's SGPA and is never reported as one.
 *
 * NO VALUE FROM THE DOCUMENTS IS PRINTED OR STORED. Counts, booleans and the
 * shape of what happened, and nothing else.
 *
 *   node tests/real-academic-chain-qa.mjs
 *
 * Skips, loudly, when `.qa/real/truth.json` names no document on this machine.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve('.qa/real');
const TRUTH = resolve(process.env.TRUTH ?? '.qa/real/truth.json');
const PORT = 4325;
const ORIGIN = `http://localhost:${PORT}`;

/** What the harness types where the card prints nothing. Not the student's. */
const HARNESS_CREDITS = '4';

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
    const server = createServer(async (request, response) => {
      const url = (request.url ?? '/').split('?')[0];
      let file = join(DIST, url);
      if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html');
      try {
        const body = await readFile(file);
        response.writeHead(200, {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(PORT, () => ok(server));
  });
}

const problems = [];
let checks = 0;

async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    problems.push({ name, error: String(error).slice(0, 300) });
    console.log(`  FAIL  ${name}`);
    console.log(`          ${String(error).split('\n')[0].slice(0, 200)}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!existsSync(DIST)) {
    console.log('\n  No build at apps/web/dist. Run: pnpm --filter @gradtools/web build\n');
    process.exit(1);
  }
  if (!existsSync(TRUTH)) {
    console.log('\n  REAL ACADEMIC CHAIN = NOT RUN');
    console.log(`  No ${TRUTH} on this machine, and no document will be invented.\n`);
    process.exit(0);
  }

  const truth = JSON.parse(await readFile(TRUTH, 'utf8'));
  const documents = (truth.documents ?? []).filter((document) => existsSync(document.file));
  if (documents.length === 0) {
    console.log('\n  REAL ACADEMIC CHAIN = NOT RUN — truth.json names no document that exists.\n');
    process.exit(0);
  }

  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });

  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${String(error)}`));

  console.log('\nThe academic chain, on the real result cards\n');
  console.log(
    `  Credits are typed by the harness (${HARNESS_CREDITS} per subject). The SGPA below is a\n` +
      '  pipeline check, NOT this student’s SGPA.\n',
  );

  /* A clean device: the chain must be built by the import, not inherited. */
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readwrite').objectStore('keyval');
          store.clear();
          store.transaction.oncomplete = () => ok(true);
        };
        open.onerror = () => ok(false);
      }),
  );

  const perSemester = [];

  for (const document of documents) {
    await page.goto(`${ORIGIN}/import`);
    await page.waitForTimeout(700);

    const buffer = await readFile(document.file);
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: basename(document.file),
        mimeType: 'application/pdf',
        buffer,
      });

    /* The review appears once the reader is done. */
    await page
      .locator('text=/rows read|could not|Failed/i')
      .first()
      .waitFor({ timeout: 120_000 })
      .catch(() => undefined);
    await page.waitForTimeout(500);

    const semester = document.semester;

    /* Every credits field, filled the way a student would fill them. */
    const credits = page.getByLabel(/^Credits \d+$/);
    const creditCount = await credits.count();
    for (let index = 0; index < creditCount; index += 1) {
      await credits.nth(index).fill(HARNESS_CREDITS);
    }

    /*
     * Any row the card cannot answer for. The harness answers "no", which is
     * the truthful answer for the rows that still ask on these documents: they
     * print an internal far above the CIE maximum, which is only possible for a
     * course assessed entirely by CIE.
     *
     * Answering "yes" instead is what exposed the point — it left every one of
     * those rows unevaluable, because an internal of 96 is not a mark out of
     * 50, so the engine refused the row rather than producing a figure from a
     * scale that cannot be right. An honest refusal on a wrong answer is the
     * behaviour worth having.
     */
    const exam = page.getByLabel(/^Final exam \d+$/);
    const examCount = await exam.count();
    for (let index = 0; index < examCount; index += 1) {
      await exam.nth(index).selectOption('no');
    }

    await check(`semester ${semester}: the review shows a credits field per subject`, () => {
      expect(creditCount > 0, 'no credits fields in the review');
    });

    const confirm = page.getByRole('button', { name: /confirm and save result/i });
    await check(`semester ${semester}: it can be confirmed and saved`, async () => {
      expect((await confirm.count()) > 0, 'no confirm control');
      await confirm.first().click();
      await page.waitForTimeout(900);
    });

    perSemester.push({ semester, subjects: creditCount, askedAboutExam: examCount });
  }

  /* ---------------------------------------------------------------------- */
  /* What the product now says                                               */
  /* ---------------------------------------------------------------------- */

  await page.goto(`${ORIGIN}/results`);
  await page.waitForTimeout(1200);

  const stored = await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readonly').objectStore('keyval');
          const all = store.getAllKeys();
          all.onsuccess = () => {
            const key = all.result.find((candidate) => String(candidate).includes('results'));
            if (key === undefined) return ok({ semesters: 0, subjects: 0, withCredits: 0 });
            const read = store.get(key);
            read.onsuccess = () => {
              const rows = Array.isArray(read.result) ? read.result : [];
              ok({
                semesters: rows.length,
                subjects: rows.reduce((total, row) => total + (row.subjects?.length ?? 0), 0),
                withCredits: rows.reduce(
                  (total, row) =>
                    total +
                    (row.subjects ?? []).filter((subject) => subject.credits !== null).length,
                  0,
                ),
                distinctSemesters: [...new Set(rows.map((row) => row.semester))].length,
              });
            };
          };
        };
        open.onerror = () => ok({ semesters: 0, subjects: 0, withCredits: 0 });
      }),
  );

  await check('every semester saved once — no duplicate semester records', () => {
    expect(
      stored.semesters === documents.length,
      `expected ${String(documents.length)} results, found ${String(stored.semesters)}`,
    );
    expect(
      stored.distinctSemesters === stored.semesters,
      `duplicate semesters: ${String(stored.semesters)} records over ${String(stored.distinctSemesters)} semesters`,
    );
  });

  await check('every subject carries credits after review', () => {
    expect(
      stored.withCredits === stored.subjects && stored.subjects > 0,
      `${String(stored.withCredits)} of ${String(stored.subjects)} subjects carry credits`,
    );
  });

  const body = await page.locator('#main').innerText();

  await check('the results page reports an SGPA rather than an em dash', () => {
    /*
     * A figure of the shape N.NN, which is what `formatGpa` produces. The VALUE
     * is not asserted and is not printed: the credits are the harness's, so the
     * number is a pipeline check and nothing more.
     */
    expect(/\b\d\.\d{2}\b/.test(body), 'no SGPA-shaped figure anywhere on the results page');
  });

  await check('no semester says its SGPA is unavailable', () => {
    expect(
      !/No SGPA yet/i.test(body),
      'a semester still reports "No SGPA yet" with credits and grades present',
    );
  });

  await page.goto(`${ORIGIN}/academics`);
  await page.waitForTimeout(900);
  const academics = await page.locator('#main').innerText();

  await check('the cumulative standing reports a CGPA', () => {
    expect(/CGPA/i.test(academics), 'the academics page never mentions CGPA');
    expect(/\b\d\.\d{2}\b/.test(academics), 'no CGPA-shaped figure');
  });

  const backlogSentence = /(\d+) subjects? could not be checked for a\s+backlog/.exec(body);
  console.log(
    `  backlog sentence: ${backlogSentence === null ? 'absent' : backlogSentence[0].replace(/\s+/g, ' ')}`,
  );

  await check('backlogs are reported as a number, not as unknown', () => {
    /*
     * "0" is a real answer and "1+" is an honest one. What must not appear is a
     * semester whose backlog state could not be worked out at all, which is
     * what an unresolved `hasSee` used to produce for every row.
     */
    expect(
      !/could not be checked for a backlog/i.test(body),
      'a semester could not determine its backlog state',
    );
  });

  await page.goto(`${ORIGIN}/`);
  await page.waitForTimeout(900);
  const dashboard = await page.locator('#main').innerText();

  await check('the dashboard reflects the imported record', () => {
    expect(dashboard.length > 200, 'the dashboard rendered nothing');
    expect(!/Something went wrong/i.test(dashboard), 'the dashboard reported an error');
  });

  /* Which rows, if any, still cannot be checked — shapes only, never marks. */
  const undetermined = await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readonly').objectStore('keyval');
          const all = store.getAllKeys();
          all.onsuccess = () => {
            const key = all.result.find((candidate) => String(candidate).includes('results'));
            if (key === undefined) return ok([]);
            const read = store.get(key);
            read.onsuccess = () => {
              const rows = Array.isArray(read.result) ? read.result : [];
              ok(
                rows.flatMap((row) =>
                  (row.subjects ?? [])
                    .filter((subject) => subject.hasSee === null || subject.hasSee === undefined)
                    .map((subject) => `s${String(row.semester)}:${String(subject.provenance)}`),
                ),
              );
            };
          };
        };
        open.onerror = () => ok([]);
      }),
  );
  console.log(
    `  rows with an unknown final-exam state: ${String(undetermined.length)} of ${String(stored.subjects)}`,
  );

  const shapes = await page.evaluate(
    () =>
      new Promise((ok) => {
        const open = globalThis.indexedDB.open('keyval-store', 1);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readonly').objectStore('keyval');
          const all = store.getAllKeys();
          all.onsuccess = () => {
            const key = all.result.find((candidate) => String(candidate).includes('results'));
            if (key === undefined) return ok({});
            const read = store.get(key);
            read.onsuccess = () => {
              const rows = Array.isArray(read.result) ? read.result : [];
              const tally = {};
              for (const row of rows) {
                for (const subject of row.subjects ?? []) {
                  const shape =
                    `int=${subject.internal === null ? 'null' : 'n'}` +
                    `|ext=${subject.external === null ? 'null' : subject.external > 0 ? 'pos' : 'zero'}` +
                    `|tot=${subject.total === null ? 'null' : 'n'}` +
                    `|see=${String(subject.hasSee)}`;
                  tally[shape] = (tally[shape] ?? 0) + 1;
                }
              }
              ok(tally);
            };
          };
        };
        open.onerror = () => ok({});
      }),
  );
  console.log(`  row shapes: ${JSON.stringify(shapes)}`);

  const offOrigin = requests.filter((url) => !url.startsWith(ORIGIN));
  console.log(`  off-origin: ${JSON.stringify([...new Set(offOrigin)].slice(0, 4))}`);
  await check('no student data left the device', () => {
    /*
     * NOT "no request left the device". The reference catalogue and the
     * announcements feed are server resources by design, and the app asks for
     * them by scheme — `/api/v1/subjects?scheme=vtu-2022` names a regulation,
     * not a person. What must never happen is a request that carries something
     * from the card.
     */
    const reference = offOrigin.filter((url) =>
      /\/api\/v1\/(subjects|announcements|schemes|colleges|branches|rule-sets|syllabus)/.test(url),
    );
    const unexpected = offOrigin.filter((url) => !reference.includes(url));
    expect(
      unexpected.length === 0,
      `unexpected off-origin request(s): ${unexpected.slice(0, 3).join(', ')}`,
    );

    /* And nothing in any of them looks like a mark, a seat number or a name. */
    const carrying = offOrigin.filter((url) =>
      /usn|seat|marks|internal|external|sgpa|result|student/i.test(url),
    );
    expect(carrying.length === 0, `a request carried student data: ${carrying[0] ?? ''}`);

    /* Reads only. A POST of a student's record is the thing that must not be. */
    expect(
      requests.every((url) => url.startsWith(ORIGIN) || reference.includes(url)),
      'an off-origin request outside the reference API',
    );
  });

  console.log('');
  for (const entry of perSemester) {
    console.log(
      `  semester ${String(entry.semester)}: ${String(entry.subjects)} subjects, ` +
        `asked about a final exam on ${String(entry.askedAboutExam)} row(s)`,
    );
  }
  console.log(
    `  stored: ${String(stored.semesters)} semesters, ${String(stored.subjects)} subjects, ` +
      `${String(stored.withCredits)} with credits`,
  );

  await writeFile(
    join(OUT, 'academic-chain-report.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), checks, problems, perSemester, stored },
      null,
      2,
    ),
    'utf8',
  );

  await browser.close();
  server.close();

  console.log(`\n  ${String(checks)} checks, ${String(problems.length)} problems`);
  console.log('  Values are the harness’s, not the student’s. No document value is stored here.\n');
  process.exit(problems.length === 0 ? 0 : 1);
}

await main();
