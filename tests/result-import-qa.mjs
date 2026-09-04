/**
 * Importing a result PDF, in a real browser.
 *
 * Authority: docs/22 §22.50 · M10A.6 §29, §30
 *
 * ---------------------------------------------------------------------------
 * THE ONLY PLACE pdf.js IS ACTUALLY EXERCISED AS IT SHIPS
 * ---------------------------------------------------------------------------
 *
 * The unit tests read generated PDFs through the real engine, but under Node.
 * This drives the whole path as a student meets it: a file chosen in a file
 * input, read by the bundled worker on the page's own origin, parsed, reviewed,
 * corrected, confirmed — and then SGPA and CGPA recomputed from the saved
 * record by the ordinary academic engine.
 *
 *   node tests/result-import-qa.mjs
 *   SCHEME=light OUT=.qa/import-light node tests/result-import-qa.mjs
 *
 * Every value in the generated documents is synthetic.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { graded, makePdf, resultPdf } from './lib/documents.mjs';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/import');
/* The origin the API's CORS allowlist carries; see tests/results-qa.mjs. */
const PORT = 4322;

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

  const openImport = async (page) => {
    await page.goto(`http://localhost:${PORT}/results`);
    await page.waitForTimeout(500);
    const opener = page.getByRole('button', { name: /import a result card/i });
    if (await opener.count()) await opener.first().click();
    await page.waitForTimeout(300);
  };

  const feed = async (page, buffer, name) => {
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name, mimeType: 'application/pdf', buffer });
    // Reading is a real PDF parse on a real worker; give it room.
    await page.waitForTimeout(2500);
  };

  /* -------------------------------------------------------------------- */
  /* Sweep: the import surface at every width, both themes                */
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

    await openImport(page);
    await feed(page, resultPdf(4, graded('BQAS40', 9)), 'semester4.pdf');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`OVERFLOW import@${vp.name}: ${overflow}px`);

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    for (const v of axe.violations) {
      fail(`AXE import@${vp.name}: ${v.id} (${v.nodes.length}) ${v.help}`);
    }

    await page.screenshot({
      path: join(OUT, `import-${vp.name}.png`),
      fullPage: vp.name === '1280' || vp.name === '390',
    });

    if (errors.length) fail(`CONSOLE @${vp.name}: ${errors.slice(0, 3).join(' | ')}`);
    await context.close();
  }

  /* -------------------------------------------------------------------- */
  /* The pipeline, driven end to end                                      */
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

  /* ---- a real PDF is read by the real engine ------------------------- */
  await openImport(page);
  await feed(page, resultPdf(1, graded('BQAS10', 8)), 'first.pdf');

  let text = await page.locator('#main').innerText();
  expect(/Semester 1/.test(text), 'IMPORT: the semester on the page was not detected');
  expect(/8 subjects/.test(text), `IMPORT: expected 8 rows read, got "${text.slice(0, 200)}"`);
  /*
   * Case-insensitive: the label is upper-cased by CSS, so `innerText` returns
   * "READ FROM". The line beside it is the source text the parser actually saw.
   */
  expect(/read from/i.test(text), 'IMPORT: the line the parser read was not shown');
  await page.screenshot({ path: join(OUT, 'review-1280.png'), fullPage: true });

  /* ---- nothing is saved before confirming ---------------------------- */
  const beforeSave = await page.evaluate(async () => {
    const open = globalThis.indexedDB.open('keyval-store', 1);
    return new Promise((ok) => {
      open.onsuccess = () => {
        const request = open.result
          .transaction('keyval', 'readonly')
          .objectStore('keyval')
          .get('gradtools:v1:anon:results');
        request.onsuccess = () => ok((request.result ?? []).length);
        request.onerror = () => ok(-1);
      };
      open.onerror = () => ok(-1);
    });
  });
  expect(
    beforeSave === 0 || beforeSave === -1,
    `IMPORT: ${String(beforeSave)} results saved before confirming`,
  );

  /* ---- correcting a field, then confirming --------------------------- */
  const firstInternal = page.getByLabel(/internal 1/i).first();
  await firstInternal.scrollIntoViewIfNeeded();
  await firstInternal.fill('45');

  const confirm = page.getByRole('button', { name: /confirm and save result/i }).first();
  await confirm.scrollIntoViewIfNeeded();
  await confirm.click();
  await page.waitForTimeout(700);

  expect(
    (await page.getByText('Saved', { exact: true }).count()) > 0,
    'IMPORT: no confirmation was shown after saving',
  );

  /* ---- the saved record is an ordinary result ------------------------ */
  await page.goto(`http://localhost:${PORT}/results`);
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: /semesters/i }).click();
  await page.waitForTimeout(400);

  text = await page.locator('#main').innerText();
  expect(/Semester 1/.test(text), 'IMPORT: the imported semester is not in Results');
  expect(/45/.test(text), 'IMPORT: the corrected mark was not saved');
  expect(
    /No SGPA yet/i.test(text),
    'IMPORT: a provisional card with no grades should explain its missing SGPA',
  );
  await page.screenshot({ path: join(OUT, 'saved-1280.png'), fullPage: true });

  /* ---- it survives a reload ------------------------------------------ */
  await page.reload();
  await page.waitForTimeout(700);
  expect(
    /Semester|Subjects/.test(await page.locator('#main').innerText()),
    'IMPORT: the imported result did not survive a reload',
  );

  /* ---- and reaches the dashboard and the degree page ----------------- */
  for (const [path, label] of [
    ['/', 'dashboard'],
    ['/semesters', 'degree'],
  ]) {
    await page.goto(`http://localhost:${PORT}${path}`);
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`OVERFLOW ${label} after import: ${overflow}px`);
  }

  /* ---- a second copy of the same semester is blocked ----------------- */
  await openImport(page);
  await feed(page, resultPdf(1, graded('BQAS10', 8)), 'first-again.pdf');
  expect(
    /already has a saved result/i.test(await page.locator('#main').innerText()),
    'IMPORT: a duplicate semester was not blocked',
  );

  /* ---- a file that is not a result card ------------------------------ */
  await feed(
    page,
    /* One page, hence the extra array: `makePdf` takes a list of pages. */
    makePdf([
      [
        { text: 'ACME SUPPLIES LIMITED', x: 60, y: 700 },
        { text: 'Invoice 4417', x: 60, y: 680 },
      ],
    ]),
    'invoice.pdf',
  );
  /*
   * REFUSED EARLIER THAN IT USED TO BE. Before the document router (M10A.7)
   * an invoice reached the result parser and was rejected by it, with "this
   * does not look like a VTU result card". It is now refused at
   * classification, before any parser sees it, and the message says what to do
   * instead. Either sentence is a correct refusal; what must never happen is
   * the invoice being treated as a result.
   */
  expect(
    /does not look like a VTU result card|could not identify this as a result card/i.test(
      await page.locator('#main').innerText(),
    ),
    'IMPORT: a non-result PDF was treated as a result',
  );

  /* ---- a corrupt file fails on its own, and says so ------------------ */
  await feed(page, Buffer.from('this is not a pdf at all', 'latin1'), 'broken.pdf');
  const afterBroken = await page.locator('#main').innerText();
  expect(/Failed/.test(afterBroken), 'IMPORT: a corrupt file was not reported as failed');
  expect(
    /already has a saved result|does not look like/i.test(afterBroken),
    'IMPORT: one bad file destroyed the other results in the batch',
  );
  await page.screenshot({ path: join(OUT, 'errors-1280.png'), fullPage: true });

  if (errors.length) fail(`CONSOLE pipeline: ${errors.slice(0, 3).join(' | ')}`);
  await context.close();

  await browser.close();
  server.close();

  console.log(
    problems.length === 0
      ? `CLEAN (${scheme}): ${checks} import checks, 0 axe, 0 overflow, 0 console errors`
      : problems.join('\n'),
  );
  if (problems.length > 0) process.exitCode = 1;
};

run();
