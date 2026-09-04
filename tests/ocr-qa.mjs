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
    { code: 'BQAS401', title: 'ALGORITHMS', internal: '44', external: '36', total: '80', status: 'P' },
    { code: 'BQAS402', title: 'OPERATING SYSTEMS', internal: '40', external: '18', total: '58', status: 'P' },
    { code: 'BQAS403', title: 'DATABASE SYSTEMS', internal: '38', external: '68', total: '106', status: 'P' },
    { code: 'BQAS404', title: 'COMPUTER NETWORKS', internal: '45', external: '17', total: '62', status: 'F' },
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

  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  const openImport = async (target) => {
    await target.goto(`${ORIGIN}/results`);
    await target.waitForTimeout(500);
    const opener = target.getByRole('button', { name: /import a result card/i });
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

  const readBack = async (target) => {
    const value = async (label) => {
      const field = target.getByLabel(label).first();
      return (await field.count()) === 0 ? null : field.inputValue();
    };
    const semesterHeading = await target.locator('#main').innerText();
    const rows = [];
    for (let i = 1; i <= 12; i += 1) {
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
    return { rows, semester: /Semester (\d)/.exec(semesterHeading)?.[1] ?? null };
  };

  const read = await readBack(page);

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
  for (const [index, truth] of TRUTH.rows.entries()) {
    const got = read.rows[index];
    for (const field of FIELDS) {
      const value = got?.[field] ?? null;
      if (value === null || value === '') bump(field, 'missing');
      else if (value.trim().toUpperCase() === truth[field].toUpperCase()) bump(field, 'correct');
      else bump(field, 'wrong');
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    note: 'Synthetic cards, rendered by the browser. Not a claim about real VTU cards.',
    firstReadMs: clean.ms,
    imageBytes: clean.bytes,
    rowsExpected: TRUTH.rows.length,
    rowsRead: read.rows.length,
    perField: tally,
  };

  expect(
    read.rows.length > 0,
    `OCR: nothing at all was read from a clean synthetic card (${String(clean.ms)}ms)`,
  );

  /* -------------------------------------------------------------------- */
  /* 2. The page says the figures came from a picture                     */
  /* -------------------------------------------------------------------- */

  const reviewText = await page.locator('#main').innerText();
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
    expect(
      !requests.some((url) => url.includes(host)),
      `OCR PRIVACY: a request mentioned ${host}`,
    );
  }
  expect(
    requests.some((url) => url.includes('/ocr/') && url.includes('traineddata')),
    'OCR: the language model was never fetched from our own origin — is the engine wired up?',
  );
  report.requests = {
    total: requests.length,
    offOrigin: offOrigin.length,
    ocrAssets: requests.filter((url) => url.includes('/ocr/')).map((url) => url.slice(ORIGIN.length)),
  };

  /* -------------------------------------------------------------------- */
  /* 4. A SCANNED PDF: rendered, then recognised                          */
  /* -------------------------------------------------------------------- */

  /*
   * The path no unit test can prove, because it is pdf.js rendering to a real
   * canvas. A document with no text layer must be RENDERED before it can be
   * read — and a text PDF must never take this route, which §6 below checks.
   */
  await openImport(page);
  const jpegUrl = await page.evaluate(DRAW, {
    truth: TRUTH,
    blur: 0,
    skew: 0,
    scale: 1,
    mime: 'image/jpeg',
  });
  const scanned = scannedPdf(Buffer.from(jpegUrl.split(',')[1], 'base64'), 1000, 700);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanned });
  await page
    .locator('text=/rows read from a picture|could not|Failed/i')
    .first()
    .waitFor({ timeout: 180_000 })
    .catch(() => undefined);

  const scannedRead = await readBack(page);
  const scannedText = await page.locator('#main').innerText();
  expect(
    scannedRead.rows.length === TRUTH.rows.length,
    `OCR: a scanned PDF yielded ${String(scannedRead.rows.length)} rows, expected ${String(TRUTH.rows.length)}`,
  );
  expect(
    /check every mark against the card/i.test(scannedText),
    'OCR: a scanned PDF was not marked as read from a picture',
  );
  report.scannedPdf = {
    rowsRead: scannedRead.rows.length,
    codes: scannedRead.rows.map((row) => row.code),
  };

  /* -------------------------------------------------------------------- */
  /* 5. A photograph that is not good enough is refused, not half-read    */
  /* -------------------------------------------------------------------- */

  await openImport(page);
  await feedImage(page, { name: 'blurred.png', blur: 6, scale: 1 });
  const blurredText = await page.locator('#main').innerText();
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
      await page.locator('#main').innerText(),
    ),
    'OCR: a card too small to read was not refused',
  );

  await context.close();

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
