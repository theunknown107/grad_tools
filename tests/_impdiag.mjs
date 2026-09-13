/* Diagnostic only — feeds one synthetic result PDF and dumps the review step. */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { resultPdf } from './lib/documents.mjs';

const DIST = resolve('apps/web/dist');
const PORT = 4388;
const TYPES = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.map':'application/json','.woff2':'font/woff2','.png':'image/png','.wasm':'application/wasm','.gz':'application/gzip' };
const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  let file = join(DIST, url === '/' ? 'index.html' : url);
  if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html');
  try { const b = await readFile(file); res.writeHead(200,{'content-type':TYPES[extname(file)] ?? 'application/octet-stream'}); res.end(b); }
  catch { res.writeHead(404).end('x'); }
});
await new Promise((ok) => server.listen(PORT, ok));

const rows = [
  ['BXX101', 'Course one', '40', '40', '80', 'A'],
  ['BXX102', 'Course two', '38', '42', '80', 'A'],
  ['BXX103', 'Course three', '35', '45', '80', 'A'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', String(e).slice(0, 200)));
await page.goto(`http://localhost:${PORT}/import`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

await page.locator('input[type="file"]').first().setInputFiles([
  { name: 's1.pdf', mimeType: 'application/pdf', buffer: resultPdf(1, rows) },
]);

for (const wait of [3000, 6000, 12000]) {
  await page.waitForTimeout(wait === 3000 ? 3000 : 3000);
  const state = await page.evaluate(() => ({
    step: [...document.querySelectorAll('[data-state="active"]')].map((s) => s.textContent.trim().slice(0, 16)),
    listItems: [...document.querySelectorAll('li')].map((l) => l.textContent.trim().slice(0, 70)).filter(Boolean).slice(0, 8),
    labels: [...document.querySelectorAll('label')].map((l) => l.textContent.trim().slice(0, 30)).slice(0, 12),
    buttons: [...document.querySelectorAll('#main button')].map((b) => b.textContent.trim().slice(0, 30)).filter(Boolean).slice(0, 10),
  }));
  console.log(`\n--- after ~${wait}ms ---`);
  console.log(JSON.stringify(state, null, 1));
  if (state.labels.length > 0) break;
}
/* Expand the first review row and see what appears. */
await page.getByRole('button', { name: /Course one/ }).first().click();
await page.waitForTimeout(600);
console.log('--- after expanding row 1 ---');
console.log(JSON.stringify(await page.evaluate(() => ({
  labels: [...document.querySelectorAll('label')].map((l) => l.textContent.trim().slice(0, 30)).slice(0, 14),
  expanded: [...document.querySelectorAll('[aria-expanded]')].map((b) => `${b.textContent.trim().slice(0,14)}=${b.getAttribute('aria-expanded')}`).slice(0, 6),
})), null, 1));
await page.screenshot({ path: '.qa/import-diag.png', fullPage: true });
await browser.close(); server.close();
