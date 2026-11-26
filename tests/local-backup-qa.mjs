/**
 * Local backup and restore, in real browser engines (docs/51).
 *
 * Drives the shipped Account → Data & privacy card against a built app:
 * save a backup (a real download), refuse bad files and a non-empty workspace
 * without changing anything, then wipe the workspace and restore the
 * downloaded file through the real file picker and confirmation dialog.
 *
 * Synthetic data only. It is written straight into IndexedDB in the exact
 * shape the app stores (`gradtools:v1:anon:<key>` in idb-keyval's database),
 * because the subject under test is the backup, not the screens that create
 * records.
 *
 * Signed-out only: an account workspace needs a real sign-in, which this
 * harness does not do. Persistence is whatever the engine answers; nothing is
 * stubbed. Playwright's WebKit is the WebKit engine, not Safari.
 *
 *   # a local-first build (no Clerk key, no API) — e.g. without touching .env.local:
 *   VITE_CLERK_PUBLISHABLE_KEY= VITE_API_URL= pnpm --filter @gradtools/web exec vite build --outDir <dir>
 *   QA_DIST=<dir> node tests/local-backup-qa.mjs            # chromium, firefox, webkit
 *   QA_DIST=<dir> QA_BROWSERS=chromium node tests/local-backup-qa.mjs
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve(process.env.QA_DIST ?? 'apps/web/dist');
const PORT = 4337;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const ENGINES = { chromium, firefox, webkit };
const WANTED = (process.env.QA_BROWSERS ?? 'chromium,firefox,webkit').split(',');

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
  '.webmanifest': 'application/manifest+json',
};

function serve() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '/').split('?')[0];
      // A same-origin page with no app on it, so seeding IndexedDB cannot race the app's own first writes.
      if (url === '/__qa_blank')
        return res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<!doctype html><title>qa</title>');
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

const T = '2026-10-20T09:00:00.000Z';
/** Records shaped as the app writes them (same fixture as test/local-backup.test.tsx). */
const SEED = {
  profile: {
    id: 'profile-1',
    authUserId: null,
    displayName: 'Synthetic Student',
    usn: null,
    collegeName: null,
    schemeId: 'vtu-2022',
    programme: 'B.E.',
    branch: 'CSBS',
    currentSemester: 4,
    createdAt: T,
    updatedAt: T,
  },
  semesters: [
    {
      id: 'sem-4',
      profileId: 'profile-1',
      number: 4,
      status: 'in_progress',
      startedOn: null,
      completedOn: null,
      updatedAt: T,
    },
  ],
  timetable: [
    {
      id: 'slot-1',
      profileId: 'profile-1',
      classId: 'class-1',
      day: 'Mon',
      startTime: '09:00',
      endTime: '10:00',
      subjectCode: 'BCS401',
      activity: null,
      room: null,
      faculty: null,
      kind: 'course',
    },
  ],
  attendanceLedger: [
    {
      kind: 'occurrence',
      id: '2026-10-19:class-1',
      classId: 'class-1',
      date: '2026-10-19',
      subjectCode: 'BCS401',
      subjectTitle: null,
      startTime: '09:00',
      endTime: '10:00',
      outcome: 'attended',
      markedAt: T,
    },
    {
      kind: 'occurrence',
      id: '2026-10-26:class-1',
      classId: 'class-1',
      date: '2026-10-26',
      subjectCode: 'BCS401',
      subjectTitle: null,
      startTime: '09:00',
      endTime: '10:00',
      outcome: 'missed',
      markedAt: T,
    },
  ],
  timetableOverrides: [
    {
      id: '2026-11-02:class-1',
      profileId: 'profile-1',
      date: '2026-11-02',
      classId: 'class-1',
      status: 'cancelled',
      addition: null,
      replacedBy: null,
      createdAt: T,
    },
  ],
  schemaVersion: 1,
};

const PREFIX = 'gradtools:v1:anon:';

/** Runs in the page: raw IndexedDB, idb-keyval's own database and store. */
async function idb(page, action, payload) {
  return page.evaluate(
    async ({ action, payload, prefix }) => {
      const db = await new Promise((ok, fail) => {
        const open = indexedDB.open('keyval-store');
        open.onupgradeneeded = () => open.result.createObjectStore('keyval');
        open.onsuccess = () => ok(open.result);
        open.onerror = () => fail(open.error);
      });
      const run = (mode, work) =>
        new Promise((ok, fail) => {
          const tx = db.transaction('keyval', mode);
          const result = work(tx.objectStore('keyval'));
          tx.oncomplete = () => ok(result);
          tx.onerror = () => fail(tx.error);
        });
      try {
        if (action === 'seed') {
          await run('readwrite', (store) => {
            for (const [key, value] of Object.entries(payload)) store.put(value, prefix + key);
          });
          return null;
        }
        if (action === 'wipe') {
          const keys = await new Promise((ok) => {
            const req = db.transaction('keyval').objectStore('keyval').getAllKeys();
            req.onsuccess = () => ok(req.result);
          });
          await run('readwrite', (store) => {
            for (const key of keys) if (String(key).startsWith(prefix)) store.delete(key);
          });
          return null;
        }
        // dump: every key of the signed-out workspace, sorted, as JSON.
        const store = db.transaction('keyval').objectStore('keyval');
        const [keys, values] = await Promise.all(
          ['getAllKeys', 'getAll'].map(
            (method) =>
              new Promise((ok) => {
                const req = store[method]();
                req.onsuccess = () => ok(req.result);
              }),
          ),
        );
        const out = {};
        keys.forEach((key, index) => {
          if (String(key).startsWith(prefix)) out[String(key).slice(prefix.length)] = values[index];
        });
        return JSON.stringify(Object.fromEntries(Object.entries(out).sort()));
      } finally {
        db.close();
      }
    },
    { action, payload, prefix: PREFIX },
  );
}

const results = [];

async function check(engineName, label, fn) {
  try {
    const note = await fn();
    results.push({ engine: engineName, label, ok: true, note: note ?? '' });
  } catch (error) {
    results.push({ engine: engineName, label, ok: false, note: String(error?.message ?? error) });
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function openDataPage(page) {
  await page.goto(`${BASE}/account?section=data`);
  await page.getByRole('button', { name: /save backup file/i }).waitFor({ timeout: 30_000 });
}

async function upload(page, name, text) {
  await page.getByLabel('Backup file to restore').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
}

async function runEngine(engineName) {
  const browser = await ENGINES[engineName].launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    await page.goto(`${BASE}/__qa_blank`);
    await idb(page, 'seed', SEED);
    const seeded = await idb(page, 'dump');
    await openDataPage(page);

    let fileText = '';

    await check(
      engineName,
      'Account page shows the browser’s real persistent-storage answer',
      async () => {
        const shown = await page
          .getByText(/This browser (has agreed|may clear|does not say)/)
          .first()
          .textContent();
        const actual = await page.evaluate(async () =>
          globalThis.navigator.storage?.persisted
            ? String(await globalThis.navigator.storage.persisted())
            : 'no-api',
        );
        const expected =
          actual === 'true' ? /has agreed/ : actual === 'false' ? /may clear/ : /does not say/;
        assert(expected.test(shown ?? ''), `shown "${shown}" but persisted() = ${actual}`);
        return `persisted() = ${actual}`;
      },
    );

    await check(engineName, 'Save backup file downloads a valid backup', async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15_000 }),
        page.getByRole('button', { name: /save backup file/i }).click(),
      ]);
      const path = await download.path();
      assert(path !== null, 'the download produced no file');
      fileText = await readFile(path, 'utf8');
      const file = JSON.parse(fileText);
      assert(file.format === 'gradtools-local-backup', 'wrong format field');
      assert(file.owner?.kind === 'anon', 'owner is not the signed-out workspace');
      const stored = JSON.parse(await idb(page, 'dump')).attendanceLedger?.length;
      assert(
        file.collections.attendanceLedger?.length === 2,
        `per-class attendance missing (file: ${String(file.collections.attendanceLedger?.length)}, stored now: ${String(stored)})`,
      );
      assert(file.collections.timetableOverrides?.length === 1, 'date overrides missing');
      assert(!('syncState' in file.collections), 'sync bookkeeping leaked into the file');
      return `${download.suggestedFilename()}, ${String(fileText.length)} bytes`;
    });

    await check(
      engineName,
      'A file that is not a backup is explained and changes nothing',
      async () => {
        await upload(page, 'notes.json', 'just some notes');
        const alert = await page.getByRole('alert').first().textContent();
        assert(/not a GradTools backup/.test(alert ?? ''), `alert said "${alert}"`);
        assert((await idb(page, 'dump')) === seeded, 'stored data changed');
      },
    );

    await check(
      engineName,
      'A backup with one damaged record is refused and changes nothing',
      async () => {
        const damaged = JSON.parse(fileText);
        damaged.collections.attendanceLedger[1].date = '26-10-2026';
        await upload(page, 'damaged.json', JSON.stringify(damaged));
        const alert = await page.getByRole('alert').first().textContent();
        assert(/record is damaged/.test(alert ?? ''), `alert said "${alert}"`);
        assert(/Per-class attendance, entry 2/.test(alert ?? ''), 'did not say where');
        assert((await idb(page, 'dump')) === seeded, 'stored data changed');
      },
    );

    await check(
      engineName,
      'Restoring into a workspace that holds records is refused',
      async () => {
        await upload(page, 'backup.json', fileText);
        await page.getByRole('button', { name: /^restore$/i }).click();
        const alert = await page.getByRole('alertdialog').getByRole('alert').textContent();
        assert(/never overwrites/.test(alert ?? ''), `dialog said "${alert}"`);
        await page.getByRole('button', { name: /cancel/i }).click();
        assert((await idb(page, 'dump')) === seeded, 'stored data changed');
      },
    );

    await check(engineName, 'A backup from an account is refused while signed out', async () => {
      await idb(page, 'wipe');
      const empty = await idb(page, 'dump');
      const foreign = JSON.parse(fileText);
      foreign.owner = { kind: 'account', tag: 'a'.repeat(64) };
      await upload(page, 'account.json', JSON.stringify(foreign));
      await page.getByRole('button', { name: /^restore$/i }).click();
      const alert = await page.getByRole('alertdialog').getByRole('alert').textContent();
      assert(/Sign in to that account/.test(alert ?? ''), `dialog said "${alert}"`);
      await page.getByRole('button', { name: /cancel/i }).click();
      assert((await idb(page, 'dump')) === empty, 'stored data changed');
    });

    await check(
      engineName,
      'The downloaded file restores an emptied workspace exactly',
      async () => {
        await idb(page, 'wipe');
        await openDataPage(page);
        await upload(page, 'backup.json', fileText);
        await page.getByText(/Per-class attendance: 2/).waitFor();
        await Promise.all([
          page.waitForEvent('load', { timeout: 20_000 }),
          page.getByRole('button', { name: /^restore$/i }).click(),
        ]);
        await page.getByRole('button', { name: /save backup file/i }).waitFor({ timeout: 30_000 });
        const restored = JSON.parse(await idb(page, 'dump'));
        const original = JSON.parse(seeded);
        for (const key of [
          'profile',
          'semesters',
          'timetable',
          'attendanceLedger',
          'timetableOverrides',
          'schemaVersion',
        ]) {
          assert(
            JSON.stringify(restored[key]) === JSON.stringify(original[key]),
            `${key} differs after restore`,
          );
        }
      },
    );

    await check(engineName, 'No uncaught page errors during the run', async () => {
      assert(errors.length === 0, errors.join(' | '));
    });
  } finally {
    await browser.close();
  }
}

const server = await serve();
try {
  for (const name of WANTED) {
    if (!(name in ENGINES)) continue;
    try {
      await runEngine(name);
    } catch (error) {
      results.push({
        engine: name,
        label: 'launch',
        ok: false,
        note: String(error?.message ?? error),
      });
    }
  }
} finally {
  server.close();
}

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.engine}] ${r.label}${r.note ? ` — ${r.note}` : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${String(results.length - failed)}/${String(results.length)} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
