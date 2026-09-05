/**
 * The import pipeline, against a REAL result card, privately.
 *
 * Authority: docs/22 §22.55 · docs/12 §12.18 · M10A.6C §3, §4, §5, §35
 *
 * ---------------------------------------------------------------------------
 * THIS FILE CONTAINS NO STUDENT DATA, AND MUST NOT ACQUIRE ANY
 * ---------------------------------------------------------------------------
 *
 * Every synthetic harness proves the pipeline works on text GradTools itself
 * drew. That is the easy end. A real VTU result card carries things no
 * generator produces: a Kannada header the English model cannot read, a
 * diagonal watermark across the marks columns, subject titles that wrap onto a
 * second line, a date column that wraps mid-value, and — on a phone — the
 * browser's own chrome above the document.
 *
 * So this harness runs the shipped pipeline against a document on disk and
 * scores it field by field. The document and the expected values live OUTSIDE
 * the repository, in a gitignored `.qa/real/truth.json` that the person running
 * this writes for their own card. Without that file the harness SKIPS and says
 * so — it never invents a document, and a green run on a machine that has none
 * is reported as "not verified" rather than as a pass.
 *
 *   node tests/real-result-qa.mjs            # counts only
 *   REVEAL=1 node tests/real-result-qa.mjs   # shows mismatched values, locally
 *
 * `REVEAL` exists so the person doing the validation can see WHICH digit was
 * misread on their own screen. Its output is for a terminal, never for a
 * commit, a report, or a log.
 *
 * Requires a built app with its OCR assets vendored:
 *   pnpm --filter @gradtools/web build
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, basename } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/real');
const TRUTH = resolve(process.env.TRUTH ?? '.qa/real/truth.json');
const PORT = 4322;
const ORIGIN = `http://localhost:${PORT}`;
const REVEAL = process.env.REVEAL === '1';

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

const UPLOAD_MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
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

/** Comparable form: case and inner spacing carry no meaning between these two. */
const normalise = (value) => (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

const run = async () => {
  if (!existsSync(TRUTH)) {
    console.log(`\n  REAL-DOCUMENT VERIFIED = NOT VERIFIED`);
    console.log(`  No ${TRUTH} on this machine, and none will be invented.`);
    console.log(`  Write one for your own card to run this. See the header of this file.\n`);
    process.exit(0);
  }

  const truth = JSON.parse(await readFile(TRUTH, 'utf8'));
  const documents = (truth.documents ?? []).filter((document) => existsSync(document.file));
  const hasPilot = ['calendar', 'timetable'].some((kind) => {
    const file = truth.pilot?.[kind]?.file;
    return typeof file === 'string' && existsSync(file);
  });

  if (documents.length === 0 && !hasPilot) {
    console.log(`\n  REAL-DOCUMENT VERIFIED = NOT VERIFIED`);
    console.log(`  ${TRUTH} names no document that exists on this machine.\n`);
    process.exit(0);
  }

  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  /* Every request, so an off-origin one can be proved absent on a REAL card. */
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));

  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${String(error)}`));

  const FIELDS = ['code', 'title', 'internal', 'external', 'total', 'status'];
  const report = { generatedAt: new Date().toISOString(), documents: [] };
  let problems = 0;

  for (const document of documents) {
    await page.goto(`${ORIGIN}/`);
    await page.evaluate((v) => {
      if (v === '') localStorage.removeItem('ttPsm');
      else localStorage.setItem('ttPsm', v);
    }, process.env.TTPSM ?? '');
    await page.goto(`${ORIGIN}/results`);
    await page.waitForTimeout(600);
    const opener = page.getByRole('button', { name: /add academic document/i });
    if (await opener.count()) await opener.first().click();
    await page.waitForTimeout(300);

    const buffer = await readFile(document.file);
    const started = Date.now();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        // The name is the document's own; it is shown as text and used for
        // nothing else, exactly as it would be for a student's own file.
        name: basename(document.file),
        mimeType: UPLOAD_MIME[extname(document.file).toLowerCase()] ?? 'application/octet-stream',
        buffer,
      });

    await page
      .locator('text=/rows read from a picture|rows read|could not|Failed/i')
      .first()
      .waitFor({ timeout: 240_000 })
      .catch(() => undefined);
    const ms = Date.now() - started;

    /* Read the review back through the labels a student sees. */
    const value = async (label) => {
      const field = page.getByLabel(label).first();
      return (await field.count()) === 0 ? null : field.inputValue();
    };
    const main = await page.locator('#main').innerText();
    const rows = [];
    for (let i = 1; i <= 30; i += 1) {
      const code = await value(new RegExp(`^Subject code ${String(i)}$`, 'i'));
      if (code === null) break;
      rows.push({
        code,
        title: await value(new RegExp(`^Subject name ${String(i)}$`, 'i')),
        internal: await value(new RegExp(`^Internal ${String(i)}$`, 'i')),
        external: await value(new RegExp(`^External ${String(i)}$`, 'i')),
        total: await value(new RegExp(`^Total ${String(i)}$`, 'i')),
        status: await value(new RegExp(`^Result ${String(i)}$`, 'i')),
      });
    }

    /*
     * Rows are matched BY SUBJECT CODE, not by position. A row the reader
     * dropped would otherwise shift every row beneath it and turn one missing
     * subject into eight wrong ones — a tally that says nothing about what
     * actually failed.
     */
    const byCode = new Map(rows.map((row) => [normalise(row.code), row]));
    const tally = {};
    const bump = (field, outcome) => {
      tally[field] ??= { correct: 0, incorrect: 0, missing: 0 };
      tally[field][outcome] += 1;
    };

    const detail = [];
    const semester = /Semester (\d)/.exec(main)?.[1] ?? null;
    bump(
      'semester',
      semester === null ? 'missing' : semester === document.semester ? 'correct' : 'incorrect',
    );
    if (semester !== document.semester) {
      detail.push({ row: '-', field: 'semester', outcome: semester === null ? 'missing' : 'incorrect' });
    }

    for (const [index, expected] of document.rows.entries()) {
      const got = byCode.get(normalise(expected.code));
      for (const field of FIELDS) {
        const actual = got?.[field] ?? null;
        const outcome =
          actual === null || actual === ''
            ? 'missing'
            : normalise(actual) === normalise(expected[field])
              ? 'correct'
              : 'incorrect';
        bump(field, outcome);
        if (outcome !== 'correct') {
          const entry = { row: index + 1, field, outcome };
          if (REVEAL) {
            entry.expected = expected[field];
            entry.got = actual;
          }
          detail.push(entry);
        }
      }
    }

    const extra = rows.filter((row) => !document.rows.some((r) => normalise(r.code) === normalise(row.code)));

    /*
     * THE QUESTION THAT MATTERS MORE THAN THE SCORE.
     *
     * A row the reader lost is acceptable; a row it lost SILENTLY is not. The
     * card does not print how many subjects it has, so unless the screen says
     * a line could not be read, a student has no way to notice a missing
     * subject. This records whether they were told.
     */
    const toldAboutMissing = /could not be read/i.test(main);
    const saysFromPicture = /check every mark against the card/i.test(main);

    const summary = {
      toldAboutMissing,
      saysFromPicture,
      /* The FILENAME is deliberately not recorded: it can carry a name or a
       * seat number, and this file is written to disk. The kind of document is
       * what a reader of the report needs. */
      kind: document.kind,
      bytes: buffer.length,
      ms,
      rowsExpected: document.rows.length,
      rowsRead: rows.length,
      rowsMatchedByCode: document.rows.filter((r) => byCode.has(normalise(r.code))).length,
      spuriousRows: extra.length,
      perField: tally,
      /* Structural only unless REVEAL is on, and REVEAL never reaches a file. */
      mismatches: detail.map(({ row, field, outcome }) => ({ row, field, outcome })),
    };
    report.documents.push(summary);

    const totals = Object.values(tally).reduce(
      (sum, counts) => ({
        correct: sum.correct + counts.correct,
        incorrect: sum.incorrect + counts.incorrect,
        missing: sum.missing + counts.missing,
      }),
      { correct: 0, incorrect: 0, missing: 0 },
    );

    console.log(`\n  ${document.kind} — ${String(buffer.length)} bytes, ${String(ms)}ms`);
    console.log(
      `    rows: ${String(rows.length)} read of ${String(document.rows.length)} expected` +
        `, ${String(summary.rowsMatchedByCode)} matched by code, ${String(extra.length)} spurious`,
    );
    console.log(
      `    told a row was unreadable: ${toldAboutMissing ? 'yes' : 'NO'}` +
        `  ·  marked as read from a picture: ${saysFromPicture ? 'yes' : 'NO'}`,
    );
    for (const [field, counts] of Object.entries(tally)) {
      console.log(
        `    ${field.padEnd(9)} correct ${String(counts.correct).padStart(2)}` +
          `  incorrect ${String(counts.incorrect).padStart(2)}` +
          `  missing ${String(counts.missing).padStart(2)}`,
      );
    }
    if (REVEAL && detail.length > 0) {
      console.log('    --- REVEAL (terminal only, never commit) ---');
      for (const entry of detail) {
        console.log(
          `    row ${String(entry.row)} ${String(entry.field)}: ${entry.outcome}` +
            (entry.expected === undefined
              ? ''
              : ` expected ${JSON.stringify(entry.expected)} got ${JSON.stringify(entry.got)}`),
        );
      }
    }
    if (totals.incorrect > 0 || totals.missing > 0) problems += 1;
  }


  /* ---------------------------------------------------------------------- */
  /* THE REAL SEMESTER PILOT                                                 */
  /* ---------------------------------------------------------------------- */

  /*
   * A calendar and a timetable the student actually holds, put through the
   * shipped import, and then the whole daily loop on top of what came out.
   *
   * ---------------------------------------------------------------------
   * WHY THIS SECTION SCORES STRUCTURE AND NOT VALUES
   * ---------------------------------------------------------------------
   *
   * The result cards above are scored field by field against a ground truth
   * somebody typed. That is worth doing for marks, where one wrong digit is
   * the whole failure. It is the wrong instrument for a calendar of sixty
   * dates and a timetable of thirty cells: transcribing them by hand to check
   * them would take longer than reading the documents, and it would put a
   * college's dates and a faculty list into a file for no gain.
   *
   * So this asks the questions a ground truth cannot answer anyway. Was the
   * document RECOGNISED? How much of it came out? Did the fields that decide
   * behaviour — semester, year, revision, effective date — arrive at all? And
   * then, the only question that really matters: does the product WORK on what
   * was extracted, end to end, without anybody typing a class or a date?
   *
   * What was extracted is written to `.qa/real/` so the person who owns the
   * documents can check the values against them. The harness does not know
   * whether "07 Sep" is right, and says so rather than implying it does.
   */
  const pilot = truth.pilot ?? {};
  /*
   * `file` may be one path or several. Several means REVISIONS, imported in the
   * order given — the real R1 and R2 of the same class timetable, which is the
   * only way to prove on real documents that the second REPLACES the first
   * rather than joining it (§20, §29).
   */
  const pilotDocs = ['calendar', 'timetable'].flatMap((kind) => {
    const entry = pilot[kind] ?? {};
    const files = Array.isArray(entry.file) ? entry.file : [entry.file];
    return files
      .filter((file) => typeof file === 'string' && existsSync(file))
      .map((file, index) => ({ kind, file, revisionIndex: index }));
  });

  report.pilot = { attempted: pilotDocs.length, documents: [], chain: null };

  if (pilotDocs.length === 0) {
    console.log(`\n  SEMESTER PILOT = NOT RUN — truth.pilot names no document on this machine.`);
  } else {
    /* A clean device: the pilot must build the semester, not inherit it. */
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(
      () =>
        new Promise((ok) => {
          const open = globalThis.indexedDB.open('keyval-store', 1);
          open.onsuccess = () => {
            const store = open.result.transaction('keyval', 'readwrite').objectStore('keyval');
            for (const key of [
              'results',
              'calendars',
              'timetable',
              'timetableImports',
              'attendance',
              'classMarks',
            ]) {
              store.delete(`gradtools:v1:anon:${key}`);
            }
            ok(true);
          };
          open.onerror = () => ok(false);
        }),
    );

    for (const entry of pilotDocs) {
      await page.goto(`${ORIGIN}/import`);
      await page.waitForTimeout(600);

      const buffer = await readFile(entry.file);
      const started = Date.now();
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: basename(entry.file),
          mimeType: UPLOAD_MIME[extname(entry.file).toLowerCase()] ?? 'application/octet-stream',
          buffer,
        });

      /* OCR on a photographed timetable is minutes, not seconds. */
      await page
        .locator('text=/dates · from|classes · from|could not|Failed|does not appear/i')
        .first()
        .waitFor({ timeout: 300_000 })
        .catch(() => undefined);
      const readMs = Date.now() - started;

      const main = await page.locator('#main').innerText();

      /*
       * ROUTING FIRST. Everything below is meaningless if the document was
       * handed to the wrong parser, and a calendar read as a result card would
       * still produce confident-looking numbers.
       */
      const routedTo = /dates · from/.test(main)
        ? 'academic_calendar'
        : /classes · from/.test(main)
          ? 'college_timetable'
          : /rows read/.test(main)
            ? 'result_card'
            : 'refused';
      const expectedRoute = entry.kind === 'calendar' ? 'academic_calendar' : 'college_timetable';

      const countOf = (pattern) => {
        const found = pattern.exec(main);
        return found === null ? null : Number(found[1]);
      };

      const found = {
        kind: entry.kind,
        bytes: buffer.length,
        readMs,
        routedTo,
        routedCorrectly: routedTo === expectedRoute,
        /* Present-or-absent only. The VALUES belong to the student. */
        extracted:
          entry.kind === 'calendar'
            ? {
                dates: countOf(/(\d+) dates · from/),
                semesterNamed: !/could not tell which semester/i.test(main),
                academicYearNamed: /Academic calendar \d/.test(main),
              }
            : {
                classes: countOf(/(\d+) classes · from/),
                classNameNamed: !/^Class timetable$/m.test(main),
                revisionNamed: /\bR\d\b/.test(main),
                effectiveFromNamed: /W\.?E\.?F|takes effect|from \d/i.test(main),
                batchAsked: /which of them are yours/i.test(main),
                partialCoverage: /could be identified, across/i.test(main),
              },
      };

      /*
       * ANSWER THE BATCH QUESTION, BECAUSE A STUDENT WOULD.
       *
       * A timetable whose cells are split between batches will not save until
       * somebody says which batch is theirs — the product refuses to guess
       * (§27), and the first run of this harness silently stored NOTHING
       * because it walked past the question and then found Save disabled.
       * Choosing the first offered batch is what a student does; leaving it
       * unanswered measures nothing.
       */
      const batch = page.getByLabel(/your batch/i);
      if ((await batch.count()) > 0) {
        const options = await batch.first().locator('option').all();
        const values = (await Promise.all(options.map((o) => o.getAttribute('value')))).filter(
          (value) => value !== null && value !== '',
        );
        found.batchOptions = values.length;
        if (values.length > 0) {
          await batch.first().selectOption(values[0]);
          await page.waitForTimeout(400);
        }
      }

      /*
       * SAVE IT. An import that reviews correctly and then fails to commit is
       * not an import, and only the stored state proves it happened.
       */
      const save = page.getByRole('button', {
        name: /Confirm and save (calendar|timetable)|Replace my timetable/i,
      });
      found.offeredSave = (await save.count()) > 0;
      found.saveEnabled = found.offeredSave && (await save.first().isEnabled());
      if (found.saveEnabled) {
        await save.first().click();
        await page.waitForTimeout(1500);
      }

      /*
       * THE HEADER FIRST. This used to print after the storage probe below, so
       * every "after saving" line appeared under the PREVIOUS document's
       * heading — which read as a refused import having saved fourteen classes.
       * Nothing was wrong but the order, and the order was enough to misreport.
       */
      console.log(
        `
  real ${entry.kind}${entry.revisionIndex > 0 ? ` (revision ${String(entry.revisionIndex + 1)})` : ''}` +
          ` — ${String(buffer.length)} bytes, ${String(readMs)}ms`,
      );

      /*
       * After a second timetable, the stored week must be the new one ENTIRELY.
       * A revision that merges leaves a student with a Monday that is partly
       * last term's, and the classes that moved are exactly the ones they would
       * turn up for.
       */
      if (entry.kind === 'timetable') {
        found.afterSave = await page.evaluate(
          () =>
            new Promise((ok) => {
              const open = globalThis.indexedDB.open('keyval-store', 1);
              open.onsuccess = () => {
                const store = open.result.transaction('keyval', 'readonly').objectStore('keyval');
                const slots = store.get('gradtools:v1:anon:timetable');
                const records = store.get('gradtools:v1:anon:timetableImports');
                slots.onsuccess = () => {
                  records.onsuccess = () =>
                    ok({
                      slots: (slots.result ?? []).length,
                      imports: (records.result ?? []).length,
                    });
                  records.onerror = () => ok({ slots: -1, imports: -1 });
                };
                slots.onerror = () => ok({ slots: -1, imports: -1 });
              };
              open.onerror = () => ok({ slots: -1, imports: -1 });
            }),
        );
        console.log(
          `    after saving: ${String(found.afterSave.slots)} classes stored, ` +
            `${String(found.afterSave.imports)} import record(s) kept`,
        );
      }

      report.pilot.documents.push(found);


      console.log(
        `    routed to ${found.routedTo}${found.routedCorrectly ? '' : '  <-- WRONG PARSER'}`,
      );
      console.log(`    extracted: ${JSON.stringify(found.extracted)}`);
      console.log(
        `    save offered: ${found.offeredSave ? 'yes' : 'NO'}` +
          ` · enabled: ${found.saveEnabled ? 'yes' : 'NO'}` +
          (found.batchOptions === undefined ? '' : ` · batches offered: ${String(found.batchOptions)}`),
      );
      if (!found.saveEnabled) problems += 1;
      if (!found.routedCorrectly) problems += 1;
    }

    /* -------------------------------------------------------------------- */
    /* THE CHAIN: does the product work on what came out?                   */
    /* -------------------------------------------------------------------- */

    const storedList = (key) =>
      page.evaluate(
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

    const calendars = await storedList('calendars');
    const slots = await storedList('timetable');
    const imports = await storedList('timetableImports');

    await page.goto(`${ORIGIN}/`);
    await page.waitForTimeout(900);
    const dashboard = await page.locator('#main').innerText();

    await page.goto(`${ORIGIN}/timetable`);
    await page.waitForTimeout(900);
    const timetableScreen = await page.locator('#main').innerText();

    /*
     * Mark a class from whatever the real timetable produced for today. There
     * may be none — a real Saturday, or a day the real calendar calls a
     * holiday — and that is a legitimate outcome rather than a failure, so it
     * is recorded rather than asserted.
     */
    const attendButton = page.getByRole('button', { name: /attended$/i }).first();
    const offeredToday = (await page.getByRole('button', { name: /attended$/i }).count()) > 0;
    let marked = null;
    let undone = null;
    if (offeredToday) {
      await attendButton.click();
      await page.waitForTimeout(600);
      const after = await storedList('attendance');
      const marks = await storedList('classMarks');
      marked = { attendanceRecords: after.length, marks: marks.length };

      await page.getByRole('button', { name: /^undo$/i }).click();
      await page.waitForTimeout(600);
      undone = { marks: (await storedList('classMarks')).length };
    }

    report.pilot.chain = {
      calendarsStored: calendars.length,
      slotsStored: slots.length,
      timetableImportsStored: imports.length,
      dashboardShowsNextDate: /Next on the calendar/i.test(dashboard),
      dashboardShowsToday: /Today/i.test(dashboard),
      todayIsHoliday: /no classes today/i.test(timetableScreen),
      timetableShowsProvenance: /·/.test(timetableScreen) && imports.length > 0,
      offeredAttendanceToday: offeredToday,
      marked,
      undone,
      /* Bytes of stored structured facts — no document is kept (§6, §51). */
      storageBytes: {
        calendars: JSON.stringify(calendars).length,
        timetable: JSON.stringify(slots).length,
        timetableImports: JSON.stringify(imports).length,
      },
    };

    const chain = report.pilot.chain;
    console.log(`\n  THE CHAIN, on real documents`);
    console.log(
      `    stored: ${String(chain.calendarsStored)} calendar(s), ` +
        `${String(chain.slotsStored)} classes, ${String(chain.timetableImportsStored)} import record(s)`,
    );
    console.log(
      `    dashboard: next date ${chain.dashboardShowsNextDate ? 'yes' : 'NO'}` +
        ` · today ${chain.dashboardShowsToday ? 'yes' : 'NO'}`,
    );
    console.log(
      `    today: ${chain.todayIsHoliday ? 'calendar says non-working' : 'teaching day'}` +
        ` · attendance offered ${chain.offeredAttendanceToday ? 'yes' : 'no'}`,
    );
    if (marked !== null)
      console.log(
        `    marked: ${String(marked.marks)} mark, ${String(marked.attendanceRecords)} record` +
          ` · after undo: ${String(undone.marks)} mark`,
      );
    console.log(
      `    storage: ${JSON.stringify(chain.storageBytes)} bytes of structured facts`,
    );

    /* What came out, for the owner of the documents to check against them. */
    await writeFile(
      join(OUT, 'pilot-extraction.json'),
      `${JSON.stringify({ calendars, slots, imports }, null, 2)}\n`,
      'utf8',
    );
    console.log(`    Extracted values: ${join(OUT, 'pilot-extraction.json')}  (private, gitignored)`);
  }

  /* A real card must not reach a third party any more than a synthetic one. */
  const OWN = [ORIGIN, 'http://localhost:3001', 'data:', 'blob:'];
  const offOrigin = requests.filter((url) => !OWN.some((prefix) => url.startsWith(prefix)));
  report.requests = {
    total: requests.length,
    offOrigin: offOrigin.length,
    ocrAssets: requests.filter((url) => url.includes('/ocr/')).map((url) => url.slice(ORIGIN.length)),
  };

  /*
   * The console is checked for LEAKAGE, not just for errors. A stray log of the
   * recognised text would put a name and a seat number into a place nobody
   * thinks of as storage.
   */
  const leaked = consoleLines.filter((line) =>
    /\b\d[A-Z]{2}\d{2}[A-Z]{2}\d{3}\b|Seat Number|Student Name/i.test(line),
  );
  report.console = { lines: consoleLines.length, errors: consoleLines.filter((l) => l.startsWith('error')).length, leaked: leaked.length };

  await browser.close();
  server.close();
  await writeFile(join(OUT, 'real-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n  Requests off-origin: ${String(offOrigin.length)}`);
  console.log(`  OCR assets: ${report.requests.ocrAssets.join(', ') || '(none)'}`);
  console.log(`  Console: ${String(report.console.lines)} lines, ${String(report.console.errors)} errors, ${String(leaked.length)} leaking identity`);
  console.log(`  Report: ${join(OUT, 'real-report.json')}  (structural only)`);
  console.log(
    `\n  REAL-DOCUMENT VERIFIED = ATTEMPTED on ${String(documents.length)} document(s); ` +
      `${String(problems)} with at least one incorrect or missing field\n`,
  );
  process.exit(offOrigin.length === 0 && leaked.length === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
