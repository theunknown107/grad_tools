/**
 * Timetable import, end to end, scored against source-checked expectations.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE CONTAINS NO STUDENT DATA, AND MUST NOT ACQUIRE ANY
 * ---------------------------------------------------------------------------
 *
 * Each document goes through the SHIPPED import page in a real browser: upload,
 * read (text layer or on-device OCR), review, choose a lab batch where the page
 * asks, confirm. Then the STORE is read, not the screen, and every stored hour
 * is scored against the expected entries in the git-ignored
 * `.qa/real/timetable-truth.json`. It prints counts only.
 *
 * Expected entries carry a status (`candidate-index`, `candidate-ai-read`,
 * `verified`) and every code a `codeStatus` (`stated`, `implied`,
 * `unresolved`). The report keeps them apart: a score against an unverified
 * candidate is reported as exactly that, never as accuracy.
 *
 * Without the truth file the harness SKIPS and says so: not verified is not the
 * same as passing.
 *
 *   # a local-first build (no Clerk key, no API):
 *   VITE_CLERK_PUBLISHABLE_KEY= VITE_API_URL= pnpm --filter @gradtools/web exec vite build --outDir <dir>
 *   QA_DIST=<dir> node tests/timetable-truth-qa.mjs
 *   QA_DIST=<dir> QA_BATCH=second node tests/timetable-truth-qa.mjs   # the other lab batch
 *   QA_DUMP=.qa/real/timetable-review/extraction  # also keep the stored hours (private)
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve(process.env.QA_DIST ?? 'apps/web/dist');
const TRUTH = resolve('.qa/real/timetable-truth.json');
const PORT = 4339;
const ORIGIN = `http://127.0.0.1:${String(PORT)}`;

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
  '.json': 'application/json',
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
    server.listen(PORT, '127.0.0.1', () => ok(server));
  });
}

const MIME_OF = {
  '.pdf': 'application/pdf',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

async function importOne(browser, doc) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (event) => errors.push(String(event)));
  try {
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(
      () =>
        new Promise((ok) => {
          const request = globalThis.indexedDB.deleteDatabase('keyval-store');
          request.onsuccess = () => ok();
          request.onerror = () => ok();
          request.onblocked = () => ok();
        }),
    );
    await page.goto(`${ORIGIN}/import`);
    await page.waitForTimeout(600);
    const started = Date.now();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: `timetable${extname(doc.file)}`,
        mimeType: MIME_OF[extname(doc.file).toLowerCase()] ?? 'application/octet-stream',
        buffer: await readFile(doc.file),
      });

    const confirm = page.getByRole('button', { name: /confirm and save timetable/i }).first();
    await confirm.waitFor({ timeout: 300_000 }).catch(() => undefined);
    const seconds = Math.round((Date.now() - started) / 1000);
    const text = await page
      .locator('main')
      .innerText()
      .catch(() => '');
    const partialWarning = /Only part of this timetable could be read/i.test(text);

    let batch = null;
    const picker = page.getByLabel(/your batch/i);
    if ((await picker.count()) > 0) {
      // A design-system combobox (Radix), not a native <select>.
      await picker.first().click();
      const options = page.getByRole('option');
      await options.first().waitFor({ timeout: 5_000 });
      const labels = await options.allTextContents();
      // QA_BATCH=second checks the other half of every batch rotation.
      const matching = labels
        .map((label, i) => [label, i])
        .filter(([label]) => (doc.batches ?? []).some((b) => label.includes(b)));
      const pick = process.env.QA_BATCH === 'second' ? matching[1] : matching[0];
      const chosen = pick === undefined ? 0 : pick[1];
      batch = (doc.batches ?? []).find((b) => (labels[chosen] ?? '').includes(b)) ?? null;
      await options.nth(chosen).click();
      await page.waitForTimeout(400);
    }

    let saved = false;
    if ((await confirm.count()) > 0 && !(await confirm.isDisabled())) {
      await confirm.scrollIntoViewIfNeeded();
      await confirm.click();
      await page.waitForTimeout(1500);
      saved = true;
    }

    const slots = await page.evaluate(
      () =>
        new Promise((ok) => {
          const open = globalThis.indexedDB.open('keyval-store');
          open.onsuccess = () => {
            try {
              const request = open.result
                .transaction('keyval', 'readonly')
                .objectStore('keyval')
                .get('gradtools:v1:anon:timetable');
              request.onsuccess = () => ok(request.result ?? []);
              request.onerror = () => ok([]);
            } catch {
              ok([]);
            }
          };
          open.onerror = () => ok([]);
        }),
    );
    return { slots, batch, saved, partialWarning, seconds, errors };
  } finally {
    await context.close();
  }
}

const norm = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** One stored hour satisfies one expected entry. */
function satisfies(slot, entry) {
  if (slot.day !== entry.day || slot.startTime !== entry.start) return false;
  if (entry.activity !== undefined) {
    return slot.subjectCode === null && norm(slot.activity).includes(norm(entry.activity));
  }
  if (entry.codeStatus === 'unresolved') return true; // presence only
  return slot.subjectCode === entry.code;
}

function score(doc, slots, batch) {
  const expected = doc.entries.filter(
    (entry) => entry.batch === undefined || batch === null || entry.batch === batch,
  );
  const used = new Set();
  const found = expected.map((entry) => {
    const index = slots.findIndex((slot, i) => !used.has(i) && satisfies(slot, entry));
    if (index >= 0) used.add(index);
    return index >= 0;
  });
  const by = (pick) => {
    const rows = expected.map((entry, i) => [entry, found[i]]).filter(([entry]) => pick(entry));
    return `${String(rows.filter(([, ok]) => ok).length)}/${String(rows.length)}`;
  };
  return {
    expected: expected.length,
    stored: slots.length,
    recalled: found.filter(Boolean).length,
    storedMatched: used.size,
    storedUnmatched: slots.length - used.size,
    stated: by((e) => e.code !== undefined && e.codeStatus === 'stated'),
    implied: by((e) => e.codeStatus === 'implied'),
    unresolvedPresence: by((e) => e.codeStatus === 'unresolved'),
    activities: by((e) => e.activity !== undefined),
    missed: expected
      .filter((_, i) => !found[i])
      .map((e) => `${e.day} ${e.start} ${e.code ?? e.activity ?? e.label}`),
    extra: slots
      .filter((_, i) => !used.has(i))
      .map((s) => `${s.day} ${s.startTime} ${s.subjectCode ?? `[${String(s.activity)}]`}`),
  };
}

if (!existsSync(TRUTH)) {
  console.log(
    '\n  SKIPPED - no .qa/real/timetable-truth.json. NOT VERIFIED is not the same as passing.\n',
  );
  process.exit(0);
}
const truth = JSON.parse(await readFile(TRUTH, 'utf8'));
const only = process.env.QA_DOCS?.split(',');
const server = await serve();
const browser = await chromium.launch();
try {
  for (const doc of truth.documents) {
    if (only !== undefined && !only.includes(doc.id)) continue;
    if (!existsSync(doc.file)) {
      console.log(`SKIP  ${doc.id}: document not on this machine`);
      continue;
    }
    const run = await importOne(browser, doc);
    const result = score(doc, run.slots, run.batch);
    // QA_DUMP=<dir> keeps the stored hours for human review. Private: point it inside .qa/.
    if (process.env.QA_DUMP !== undefined) {
      await mkdir(process.env.QA_DUMP, { recursive: true });
      await writeFile(
        join(process.env.QA_DUMP, `${doc.id}.${run.batch ?? 'all'}.json`),
        JSON.stringify({ doc: doc.id, batch: run.batch, slots: run.slots }, null, 1),
      );
    }
    console.log(
      JSON.stringify({
        doc: doc.id,
        status: doc.status,
        saved: run.saved,
        batch: run.batch,
        partialWarning: run.partialWarning,
        seconds: run.seconds,
        pageErrors: run.errors.length,
        ...result,
      }),
    );
  }
} finally {
  await browser.close();
  server.close();
}
