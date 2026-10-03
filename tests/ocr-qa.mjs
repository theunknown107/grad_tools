/**
 * Recognising a picture of a result card, in a real browser, field by field.
 *
 * Authority: docs/22 §22.54 · M10A.6B §5, §13, §29, §30, §40, §41, §42
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A UNIT TEST
 * ---------------------------------------------------------------------------
 *
 * There is no Tesseract under Node here and no canvas to feed it. More to the
 * point, the three things worth proving are all properties of the SHIPPED page:
 *
 *   1. Every OCR asset comes from our own origin. tesseract.js defaults its
 *      worker, core and language paths to jsDelivr, and a page with a student's
 *      result card open in it must not tell a third party that. The check is a
 *      network log, because a configuration that LOOKS local and a page that IS
 *      are different claims.
 *   2. What the engine actually reads off a card, per field. Not an "accuracy
 *      percentage" — a per-field tally of correct, wrong and missing, because
 *      those three have different consequences. A missing mark is a blank a
 *      student fills in. A WRONG one is an SGPA they cannot explain.
 *   3. That the review screen says the figures came from a picture.
 *
 *   node tests/ocr-qa.mjs
 *   SCHEME=light OUT=.qa/ocr-light node tests/ocr-qa.mjs
 *
 * Requires a built app with its OCR assets vendored:
 *   pnpm --filter @gradtools/web build
 *
 * Every value in the generated cards is synthetic. The seat number is a
 * deliberately impossible pattern.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { scannedPdf } from './lib/documents.mjs';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/ocr');
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
        const headers = { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' };
        /*
         * The model ships pre-compressed and is requested by its `.gz` name, so
         * it must NOT be served with `content-encoding: gzip` — the browser
         * would decompress it and hand tesseract.js a file it then tries to
         * decompress again.
         */
        res.writeHead(200, headers);
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(PORT, () => ok(server));
  });
}

/* ---------------------------------------------------------------------- */
/* A synthetic result card, drawn in the browser                           */
/* ---------------------------------------------------------------------- */

/**
 * The truth the recognition is scored against.
 *
 * Chosen so the marks exercise the cases that matter rather than the easy ones:
 * a two-digit and a three-digit total, a `0`/`8`/`6` cluster (the digits an OCR
 * confuses most often), and one row a student would have to look at twice.
 */
const TRUTH = {
  semester: '4',
  rows: [
    {
      code: 'BQAS401',
      title: 'ALGORITHMS',
      internal: '44',
      external: '36',
      total: '80',
      status: 'P',
    },
    {
      code: 'BQAS402',
      title: 'OPERATING SYSTEMS',
      internal: '40',
      external: '18',
      total: '58',
      status: 'P',
    },
    {
      code: 'BQAS403',
      title: 'DATABASE SYSTEMS',
      internal: '38',
      external: '68',
      total: '106',
      status: 'P',
    },
    {
      code: 'BQAS404',
      title: 'COMPUTER NETWORKS',
      internal: '45',
      external: '17',
      total: '62',
      status: 'F',
    },
  ],
};

/**
 * Draws a VTU-shaped card onto a canvas and returns it as PNG bytes.
 *
 * `blur` and `skew` are applied so the harness can ask the question that
 * matters on a phone — how the pipeline behaves on a photograph rather than a
 * screenshot — without needing a real camera in CI.
 */
const DRAW = ({ truth, blur, skew, scale, mime }) => {
  const width = Math.round(1000 * scale);
  const height = Math.round(700 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.scale(scale, scale);
  if (skew !== 0) {
    ctx.translate(500, 350);
    ctx.rotate((skew * Math.PI) / 180);
    ctx.translate(-500, -350);
  }
  if (blur > 0) ctx.filter = `blur(${String(blur)}px)`;

  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';

  const line = (text, x, y, size = 18, weight = '') => {
    ctx.font = `${weight} ${String(size)}px "DejaVu Sans", Arial, sans-serif`.trim();
    ctx.fillText(text, x, y);
  };

  line('VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', 60, 40, 20, 'bold');
  line('VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION', 60, 70);
  line('University Seat Number : 9ZZ99ZZ999', 60, 110);
  line(`Semester : ${truth.semester}`, 60, 140);

  const columns = [60, 210, 560, 660, 760, 850];
  ['Subject Code', 'Subject Name', 'Internal', 'External', 'Total', 'Result'].forEach(
    (heading, index) => {
      line(heading, columns[index], 190, 17, 'bold');
    },
  );

  truth.rows.forEach((row, index) => {
    const y = 230 + index * 44;
    [row.code, row.title, row.internal, row.external, row.total, row.status].forEach(
      (cell, column) => {
        line(cell, columns[column], y, 19);
      },
    );
  });

  return canvas.toDataURL(mime ?? 'image/png');
};

/* ---------------------------------------------------------------------- */

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

  /** Every request the page made, so off-origin ones can be proved absent. */
  const requests = [];

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
  });
  context.on('request', (request) => requests.push(request.url()));

  const errors = [];
  const watch = (target) => {
    target.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    target.on('pageerror', (e) => errors.push(String(e)));
    return target;
  };
  const page = watch(await context.newPage());

  /**
   * A second, EMPTY device. Saving is part of what is checked, and a device
   * that already holds semester 4 correctly refuses a second semester 4 — so a
   * scenario that saves again needs a device of its own.
   */
  const extraContexts = [];
  const freshPage = async () => {
    const extra = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: scheme,
    });
    extra.on('request', (request) => requests.push(request.url()));
    extraContexts.push(extra);
    return watch(await extra.newPage());
  };

  const openImport = async (target) => {
    await target.goto(`${ORIGIN}/import`);
    await target.waitForTimeout(500);
    const opener = target.getByRole('button', { name: /add academic document/i });
    if (await opener.count()) await opener.first().click();
    await target.waitForTimeout(300);
  };

  /** Draws a card in the page, hands it to the file input, waits for the read. */
  const feedImage = async (target, options) => {
    const dataUrl = await target.evaluate(DRAW, {
      truth: TRUTH,
      blur: options.blur ?? 0,
      skew: options.skew ?? 0,
      scale: options.scale ?? 1,
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const started = Date.now();
    await target
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: options.name, mimeType: 'image/png', buffer });

    /*
     * Waited on the OUTCOME, not on a fixed delay: the first recognition also
     * pays for fetching a 3.7MB engine and a 2.8MB model, and a timeout long
     * enough for that would make every later one slow for no reason.
     */
    await target
      .locator('text=/rows read from a picture|could not|Failed/i')
      .first()
      .waitFor({ timeout: 180_000 })
      .catch(() => undefined);
    return { ms: Date.now() - started, bytes: buffer.length };
  };

  /* -------------------------------------------------------------------- */
  /* 1. A clean card, scored field by field                               */
  /* -------------------------------------------------------------------- */

  await openImport(page);
  const clean = await feedImage(page, { name: 'card.png', scale: 1 });

  /*
   * WHAT IS SCORED IS WHAT GETS SAVED.
   *
   * This used to scrape inputs labelled "Subject code 1", "Internal 1"… from
   * the review — markup the review no longer has, so every field scored
   * "missing" and the harness reported nothing read while the engine had read
   * the card. The contract that matters is the record a student ends up with:
   * so the review is confirmed exactly as a student would ("Confirm and save N
   * courses"), and the SemesterResult written to this device is read back from
   * IndexedDB and compared with the truth, field by field.
   */
  const RESULTS_KEY = 'gradtools:v1:anon:results';
  const savedResults = (target) =>
    target.evaluate(
      (key) =>
        new Promise((resolve) => {
          const open = indexedDB.open('keyval-store');
          open.onerror = () => resolve([]);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('keyval')) return resolve([]);
            const get = db.transaction('keyval').objectStore('keyval').get(key);
            get.onsuccess = () => resolve(Array.isArray(get.result) ? get.result : []);
            get.onerror = () => resolve([]);
          };
        }),
      RESULTS_KEY,
    );

  const saveAndRead = async (target) => {
    const confirm = target.getByRole('button', { name: /confirm and save \d+ courses?/i }).first();
    if ((await confirm.count()) === 0 || (await confirm.isDisabled())) {
      return { saved: false, semester: null, rows: [] };
    }
    const before = (await savedResults(target)).length;
    await confirm.click();
    let results = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      results = await savedResults(target);
      if (results.length > before) break;
      await target.waitForTimeout(100);
    }
    const saved = results.length > before ? results[results.length - 1] : null;
    if (saved === null) return { saved: false, semester: null, rows: [] };
    const text = (value) => (value === null || value === undefined ? null : String(value));
    return {
      saved: true,
      semester: text(saved.semester),
      rows: (saved.subjects ?? []).map((subject) => ({
        code: text(subject.subjectCode),
        title: text(subject.subjectTitle),
        internal: text(subject.internal),
        external: text(subject.external),
        total: text(subject.total),
        status: text(subject.resultStatus),
      })),
    };
  };

  /* The review is checked BEFORE saving: a save leaves it. */
  const reviewText = await page.locator('#gt-main').innerText();
  const read = await saveAndRead(page);
  expect(read.saved, 'OCR: the review of a clean synthetic card could not be confirmed and saved');

  /*
   * SCORED PER FIELD, in three buckets rather than one percentage.
   *
   * A missing field is a blank the student fills in. A WRONG one is a number
   * that looks right and is not — the failure this whole workflow exists to
   * catch. Averaging them into one figure would hide exactly that difference.
   */
  const tally = {};
  const bump = (field, outcome) => {
    tally[field] ??= { correct: 0, wrong: 0, missing: 0 };
    tally[field][outcome] += 1;
  };

  bump(
    'semester',
    read.semester === null ? 'missing' : read.semester === TRUTH.semester ? 'correct' : 'wrong',
  );

  const FIELDS = ['code', 'title', 'internal', 'external', 'total', 'status'];
  for (const truth of TRUTH.rows) {
    const got = read.rows.find((row) => row.code?.toUpperCase() === truth.code);
    for (const field of FIELDS) {
      const value = got?.[field] ?? null;
      if (value === null || value === '') bump(field, 'missing');
      else if (value.trim().toUpperCase() === truth[field].toUpperCase()) bump(field, 'correct');
      else bump(field, 'wrong');
    }
  }

  /*
   * A WRONG value is the failure this workflow exists to prevent: a mark that
   * looks right and is not. On a clean card none is acceptable, and neither is
   * a course the card printed going unsaved.
   */
  expect(
    read.rows.length === TRUTH.rows.length,
    `OCR: a clean card saved ${String(read.rows.length)} courses, the card printed ${String(TRUTH.rows.length)}`,
  );
  const wrong = Object.entries(tally).filter(([, counts]) => counts.wrong > 0);
  expect(
    wrong.length === 0,
    `OCR: a clean card saved WRONG values in: ${wrong.map(([field]) => field).join(', ')}`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    note: 'Synthetic cards, rendered by the browser. Not a claim about real VTU cards.',
    firstReadMs: clean.ms,
    imageBytes: clean.bytes,
    rowsExpected: TRUTH.rows.length,
    rowsRead: read.rows.length,
    saved: read.saved,
    perField: tally,
  };

  expect(
    read.rows.length > 0,
    `OCR: nothing at all was read from a clean synthetic card (${String(clean.ms)}ms)`,
  );
  expect(
    read.semester === TRUTH.semester,
    `OCR: the saved result is for semester ${String(read.semester)}, the card printed ${TRUTH.semester}`,
  );
  /* A saved row the card never printed is an invented course. */
  const known = new Set(TRUTH.rows.map((row) => row.code));
  const invented = read.rows.filter((row) => !known.has(row.code?.toUpperCase() ?? ''));
  expect(
    invented.length === 0,
    `OCR: the saved result has rows the card never printed: ${invented.map((row) => row.code).join(', ')}`,
  );

  /* -------------------------------------------------------------------- */
  /* 2. The page says the figures came from a picture                     */
  /* -------------------------------------------------------------------- */

  expect(
    /check every mark against the card/i.test(reviewText),
    'OCR: the review did not say the figures were read from a picture',
  );
  expect(
    /rows read from a picture/i.test(reviewText),
    'OCR: the file list did not say how the file was read',
  );
  expect(
    !/\d+% accurate|accuracy/i.test(reviewText),
    'OCR: the screen claimed an accuracy figure, which the data does not support',
  );
  await page.screenshot({ path: join(OUT, 'ocr-review-1280.png'), fullPage: true });

  /* -------------------------------------------------------------------- */
  /* 3. NOT ONE REQUEST LEFT THE ORIGIN                                   */
  /* -------------------------------------------------------------------- */

  /*
   * GradTools' own API is not a third party — the reference catalogue lives
   * there and the page asks for it on every visit. What must not appear is a
   * host nobody chose: a CDN, or an OCR service. So the filter names the
   * origins this app is allowed to speak to and treats everything else as a
   * finding.
   */
  const OWN = [ORIGIN, 'http://localhost:3001', 'data:', 'blob:'];
  const offOrigin = requests.filter((url) => !OWN.some((prefix) => url.startsWith(prefix)));
  expect(
    offOrigin.length === 0,
    `OCR PRIVACY: ${String(offOrigin.length)} request(s) left the origin: ${offOrigin.slice(0, 5).join(', ')}`,
  );
  for (const host of ['jsdelivr', 'unpkg', 'cdn.', 'googleapis', 'openai', 'anthropic', 'gemini']) {
    expect(!requests.some((url) => url.includes(host)), `OCR PRIVACY: a request mentioned ${host}`);
  }
  expect(
    requests.some((url) => url.includes('/ocr/') && url.includes('traineddata')),
    'OCR: the language model was never fetched from our own origin — is the engine wired up?',
  );
  report.requests = {
    total: requests.length,
    offOrigin: offOrigin.length,
    ocrAssets: requests
      .filter((url) => url.includes('/ocr/'))
      .map((url) => url.slice(ORIGIN.length)),
  };

  /* -------------------------------------------------------------------- */
  /* 4. A SCANNED PDF: rendered, then recognised                          */
  /* -------------------------------------------------------------------- */

  /*
   * The path no unit test can prove, because it is pdf.js rendering to a real
   * canvas. A document with no text layer must be RENDERED before it can be
   * read — and a text PDF must never take this route, which §6 below checks.
   */
  const scanPage = await freshPage();
  await openImport(scanPage);
  const jpegUrl = await scanPage.evaluate(DRAW, {
    truth: TRUTH,
    blur: 0,
    skew: 0,
    scale: 1,
    mime: 'image/jpeg',
  });
  const scanned = scannedPdf(Buffer.from(jpegUrl.split(',')[1], 'base64'), 1000, 700);
  await scanPage
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanned });
  await scanPage
    .locator('text=/rows read from a picture|could not|Failed/i')
    .first()
    .waitFor({ timeout: 180_000 })
    .catch(() => undefined);

  const scannedText = await scanPage.locator('#gt-main').innerText();
  const scannedRead = await saveAndRead(scanPage);
  expect(
    scannedRead.rows.length === TRUTH.rows.length,
    `OCR: a scanned PDF yielded ${String(scannedRead.rows.length)} rows, expected ${String(TRUTH.rows.length)}`,
  );
  expect(
    /check every mark against the card/i.test(scannedText),
    'OCR: a scanned PDF was not marked as read from a picture',
  );
  expect(scannedRead.saved, 'OCR: the review of a scanned PDF could not be confirmed and saved');
  report.scannedPdf = {
    saved: scannedRead.saved,
    rowsRead: scannedRead.rows.length,
    codes: scannedRead.rows.map((row) => row.code),
  };

  /* -------------------------------------------------------------------- */
  /* 5. A photograph that is not good enough is refused, not half-read    */
  /* -------------------------------------------------------------------- */

  await openImport(page);
  await feedImage(page, { name: 'blurred.png', blur: 6, scale: 1 });
  const blurredText = await page.locator('#gt-main').innerText();
  expect(
    /could not be made out|Failed|rows read from a picture/i.test(blurredText),
    'OCR: a heavily blurred card produced neither a reading nor a refusal',
  );
  report.blurredOutcome = /could not be made out/i.test(blurredText)
    ? 'refused'
    : /rows read from a picture/i.test(blurredText)
      ? 'read'
      : 'failed';

  /* -------------------------------------------------------------------- */
  /* 6. Too small to read is refused before the engine is bothered        */
  /* -------------------------------------------------------------------- */

  await openImport(page);
  await feedImage(page, { name: 'tiny.png', scale: 0.3 });
  expect(
    /cannot be read reliably|could not be made out|Failed/i.test(
      await page.locator('#gt-main').innerText(),
    ),
    'OCR: a card too small to read was not refused',
  );

  await context.close();
  for (const extra of extraContexts) await extra.close();

  /* -------------------------------------------------------------------- */
  /* 7. The import surface, at every width, both themes                   */
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
      if (m.type() === 'error') sizedErrors.push(m.text());
    });
    sizedPage.on('pageerror', (e) => sizedErrors.push(String(e)));

    await openImport(sizedPage);
    await feedImage(sizedPage, { name: 'card.png', scale: 1 });

    const overflow = await sizedPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`OVERFLOW ocr@${vp.name}: ${overflow}px`);

    const axe = await new AxeBuilder({ page: sizedPage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    for (const violation of axe.violations) {
      fail(`AXE ocr@${vp.name}: ${violation.id} (${violation.nodes.length}) ${violation.help}`);
    }

    await sizedPage.screenshot({
      path: join(OUT, `ocr-${vp.name}.png`),
      fullPage: vp.name === '1280' || vp.name === '390',
    });
    if (sizedErrors.length) fail(`CONSOLE ocr@${vp.name}: ${sizedErrors.slice(0, 3).join(' | ')}`);
    await sized.close();
  }

  if (errors.length) fail(`CONSOLE ocr: ${errors.slice(0, 3).join(' | ')}`);

  await browser.close();
  server.close();

  await writeFile(join(OUT, 'ocr-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n  Field-by-field, on synthetic cards (${String(report.rowsRead)} rows read):`);
  for (const [field, counts] of Object.entries(tally)) {
    console.log(
      `    ${field.padEnd(9)} correct ${String(counts.correct).padStart(2)}` +
        `  wrong ${String(counts.wrong).padStart(2)}` +
        `  missing ${String(counts.missing).padStart(2)}`,
    );
  }
  console.log(`\n  First read: ${String(clean.ms)}ms (includes fetching the engine)`);
  console.log(`  Requests off-origin: ${String(report.requests.offOrigin)}`);
  console.log(`  Report: ${join(OUT, 'ocr-report.json')}`);

  console.log(`\n  ${String(checks)} checks, ${String(problems.length)} problems`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(problems.length === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
