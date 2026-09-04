/**
 * EMPTY-STATE sweep: every page with no data at all.
 *
 * Authority: docs/22 §22.32 · M9.6B §38, §40
 *
 * The populated sweep (m96b-qa.mjs) is the one that exercises metrics, tables
 * and charts. This is its opposite and is just as necessary: a page with no
 * data must look DELIBERATE rather than broken, and an empty state is the
 * screen a brand-new student actually sees first.
 *
 * Deliberately does not seed. Everything below renders its empty state.
 *
 *   node tests/empty-qa.mjs
 *
 * Screenshots land in .qa/empty/, gitignored.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve(process.env.OUT ?? '.qa/empty');
/* 4322 is the origin the API allows — see tests/README. */
const PORT = 4322;

const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
];

const ROUTES = [
  ['/welcome', 'landing'],
  ['/', 'dashboard'],
  ['/semesters', 'degree'],
  ['/results', 'results'],
  ['/academics', 'gpa'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable'],
  ['/papers', 'papers'],
  ['/announcements', 'announcements'],
  ['/notifications', 'notifications'],
  ['/profile', 'profile'],
  ['/account', 'account'],
  ['/sign-in', 'sign-in'],
  ['/documents', 'documents'],
];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    let file = join(DIST, url === '/' ? 'index.html' : url);
    if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const problems = [];
  let checks = 0;

  for (const appearance of ['dark', 'light']) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        colorScheme: appearance === 'light' ? 'dark' : 'light',
      });
      await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
      await context.addInitScript(
        (a) =>
          window.localStorage.setItem(
            'gradtools:v1:theme',
            JSON.stringify({ appearance: a, accent: 'violet' }),
          ),
        appearance,
      );

      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(`http://localhost:${PORT}/`);

      for (const [path, name] of ROUTES) {
        const label = `${name}@${vp.name}/${appearance}`;
        await page.goto(`http://localhost:${PORT}${path}`);
        await page.waitForTimeout(400);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0) problems.push(`OVERFLOW ${label}: ${overflow}px`);

        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        for (const v of axe.violations) {
          problems.push(`AXE ${label}: ${v.id} (${v.nodes.length}) ${v.help}`);
        }

        checks += 1;
        if (vp.name === '1280' || vp.name === '390') {
          await page.screenshot({ path: join(OUT, `${name}-${vp.name}-${appearance}.png`) });
        }
      }

      for (const e of errors) {
        /*
         * The API is not required for this sweep, and a transient network
         * blip is not a frontend defect either. Both are counted separately
         * so they cannot mask a real console error.
         */
        const tag = /Failed to fetch|ERR_CONNECTION|ERR_NETWORK_CHANGED|CORS/.test(e)
          ? 'API-DOWN'
          : 'CONSOLE';
        problems.push(`${tag} ${appearance}@${vp.name}: ${e.slice(0, 120)}`);
      }
      await context.close();
    }
  }

  await browser.close();
  server.close();

  const real = problems.filter((p) => !p.startsWith('API-DOWN'));
  const apiDown = problems.length - real.length;

  console.log(
    `\n${checks} page checks (${ROUTES.length} routes x ${VIEWPORTS.length} widths x 2 themes)`,
  );
  if (apiDown > 0)
    console.log(`${apiDown} API-unavailable console messages (not frontend defects)`);
  if (real.length === 0) {
    console.log('CLEAN — 0 axe violations, 0 horizontal overflow, 0 frontend console errors');
  } else {
    console.log(`${real.length} problems:`);
    const seen = new Set();
    for (const p of real) {
      const key = p.replace(/@\d+/, '@*');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log('  ' + p);
    }
  }
  process.exit(real.length === 0 ? 0 : 1);
};

run();
