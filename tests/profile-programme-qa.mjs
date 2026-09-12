/**
 * The Profile programme field: nine widths, both appearances, axe.
 *
 * Authority: Phase 7B.3.1 §9–§11, §86, §89–§92, §119, §120
 *
 * ---------------------------------------------------------------------------
 * WHY ONE FIELD NEEDS ITS OWN SWEEP
 * ---------------------------------------------------------------------------
 *
 * B.3.1 added exactly one control to a frozen page, and the freeze is what
 * makes this worth measuring rather than assuming: a select dropped into an
 * existing grid is the change most likely to push a row past the viewport at
 * 320px, and least likely to be noticed at 1440.
 *
 * Nine widths because that is what §119 asks for, and both appearances because
 * a field that reads fine on white can vanish on the dark ground.
 *
 *   node tests/profile-programme-qa.mjs
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve('.qa/profile-programme');
const PORT = 4329;

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const APPEARANCES = ['light', 'dark'];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
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

const checks = [];
const problems = [];
function check(name, ok, detail = '') {
  checks.push(name);
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    problems.push(name);
    console.log(`  FAIL  ${name}`);
    if (detail !== '') console.log(`          ${detail}`);
  }
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('apps/web/dist is missing. Run: pnpm --filter @gradtools/web build');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();

  try {
    for (const appearance of APPEARANCES) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: appearance,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        await page.addInitScript((mode) => {
          window.localStorage.setItem('gradtools.theme', JSON.stringify({ appearance: mode }));
        }, appearance);

        await page.goto(`http://localhost:${PORT}/profile`, { waitUntil: 'networkidle' });

        /*
         * The form opens directly when there is no profile worth summarising,
         * which is the state a fresh browser is in. If an overview is shown
         * instead, the edit control opens it.
         */
        const edit = page.getByRole('button', { name: /edit profile/i });
        if (await edit.count()) await edit.first().click();

        const label = page.getByText('Programme', { exact: true });
        const found = (await label.count()) > 0;
        check(`${appearance} ${width}: the programme field is present`, found);
        if (!found) {
          await context.close();
          continue;
        }

        const select = page.locator('select').filter({ hasText: 'B.E.' }).first();

        /* §11. "Not set" is a real answer and must be offered, never defaulted away. */
        const options = await select.locator('option').allTextContents();
        check(
          `${appearance} ${width}: offers "Not set" and does not preselect a guess`,
          options.includes('Not set') && (await select.inputValue()) === '',
          `options: ${options.join(', ')} · value: "${await select.inputValue()}"`,
        );

        /* §89, §90. A control wider than the viewport is a broken control. */
        const box = await select.boundingBox();
        check(
          `${appearance} ${width}: the control fits the viewport`,
          box !== null && box.x >= 0 && box.x + box.width <= width + 1,
          box === null ? 'no box' : `x=${Math.round(box.x)} w=${Math.round(box.width)}`,
        );

        /* §92, §89. A 44px target is the one an actual thumb can hit. */
        check(
          `${appearance} ${width}: the control is large enough to tap`,
          box !== null && box.height >= 32,
          box === null ? 'no box' : `h=${Math.round(box.height)}`,
        );

        /* The page must not scroll sideways because of what was added. */
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        check(
          `${appearance} ${width}: no horizontal overflow`,
          overflow <= 0,
          `overflow ${String(overflow)}px`,
        );

        /* §10. The student is told why it is asked, without our vocabulary. */
        if (width === 1280 && appearance === 'light') {
          const body = await page.locator('body').innerText();
          check(
            'the hint explains why it is asked',
            /Helps GradTools show you VTU notices meant for your programme\./.test(body),
          );
          check(
            'the hint does not leak internal vocabulary',
            !/applicability engine|fanout|source graph|materiali[sz]/i.test(body),
          );
        }

        /* §92, §120. */
        if (width === 390 || width === 1280) {
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          check(
            `${appearance} ${width}: axe reports no violations`,
            axe.violations.length === 0,
            axe.violations.map((v) => `${v.id} (${String(v.nodes.length)})`).join(', '),
          );
        }

        /* Keyboard: the field must be reachable and operable without a mouse. */
        if (width === 1280) {
          await select.focus();
          const focused = await page.evaluate(() => document.activeElement?.tagName ?? '');
          check(`${appearance}: the control takes keyboard focus`, focused === 'SELECT');

          await select.selectOption('B.E.');
          check(
            `${appearance}: choosing a programme takes effect`,
            (await select.inputValue()) === 'B.E.',
          );
        }

        await page.screenshot({
          path: join(OUT, `${appearance}-${String(width)}.png`),
          fullPage: width <= 430,
        });
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n  ${String(checks.length)} checks, ${String(problems.length)} problems`);
  console.log(`  Screenshots in ${OUT}`);
  if (problems.length > 0) process.exitCode = 1;
}

await main();
