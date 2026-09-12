import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const DIST = resolve('apps/web/dist');
const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  let file = join(DIST, url === '/' ? 'index.html' : url);
  if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html');
  const t = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png' };
  try { const b = await readFile(file); res.writeHead(200,{'content-type':t[extname(file)] ?? 'application/octet-stream'}); res.end(b); }
  catch { res.writeHead(404).end('x'); }
});
await new Promise((ok) => server.listen(4401, ok));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto('http://localhost:4401/', { waitUntil: 'networkidle' });
console.log(JSON.stringify(await page.evaluate(() => {
  const r = document.documentElement;
  const cs = getComputedStyle(r);
  const body = getComputedStyle(document.body);
  return {
    dataTheme: r.getAttribute('data-theme'),
    dataAccent: r.getAttribute('data-accent'),
    inlineColorScheme: r.style.colorScheme,
    storedTheme: (() => { try { return window.localStorage.getItem('gradtools:v1:theme'); } catch { return 'throw'; } })(),
    tokens: {
      text: cs.getPropertyValue('--text').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      bg: cs.getPropertyValue('--bg').trim(),
      glassPanelBg: cs.getPropertyValue('--glass-panel-bg').trim(),
    },
    bodyBg: body.backgroundColor,
    bodyColor: body.color,
  };
}), null, 1));
await browser.close(); server.close();
