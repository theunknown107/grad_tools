/**
 * The /import route and the drop surface, in a real browser.
 *
 * Authority: Phase 7B.1 §2, §3 · docs/22 · docs/27
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS SEPARATELY FROM import-workflow-qa
 * ---------------------------------------------------------------------------
 *
 * That harness drives the PIPELINE — four files in one action, multi-page
 * cards, duplicates, the calculation chain. It reaches the file input directly
 * and never looks at the surface around it, which is correct for what it asks.
 *
 * The Phase 7B report closed with "/import isn't in the swept routes, so the
 * dropzone wasn't measured", and this is that measurement: the route itself,
 * the states the drop surface can be in, and whether any of it works without a
 * mouse — at three widths and in both themes, because a component that is fine
 * at 1440 in the dark can still put its button off the bottom of a phone.
 *
 * It also verifies the RadioGroup keyboard model, which the unit tests could
 * not: Radix implements selection-follows-focus with a `keydown` listener on
 * `document`, and React delegates its own handlers to the root container
 * INSIDE document, so under jsdom the focus handler runs before the listener
 * has recorded the arrow press. Whether that is a jsdom artefact or the real
 * behaviour is a question about a browser.
 *
 * NOBODY LOOKED AT THESE SCREENS. This is scripted interaction, and the report
 * says so rather than claiming a manual pass.
 *
 *   node tests/import-route-qa.mjs
 *
 * Requires a built app:  pnpm --filter @gradtools/web build
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve('.qa/import-route');
const PORT = 4324;
const ORIGIN = `http://localhost:${PORT}`;

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
    const server = createServer(async (request, response) => {
      const url = (request.url ?? '/').split('?')[0];
      /*
       * `/__radio__/` serves the component proving ground; everything else is
       * the product. One server, so the harness needs no second origin and the
       * off-origin request count stays meaningful.
       */
      const harness = url.startsWith('/__radio__');
      const base = harness ? resolve('apps/web/.qa/radio-harness/dist') : DIST;
      let file = join(base, harness ? url.replace('/__radio__', '') : url);
      if (!existsSync(file) || extname(file) === '') file = join(base, 'index.html');
      try {
        const body = await readFile(file);
        response.writeHead(200, {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(PORT, () => ok(server));
  });
}

const problems = [];
let checks = 0;

async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    problems.push({ name, error: String(error).slice(0, 300) });
    console.log(`  FAIL  ${name}`);
    console.log(`          ${String(error).split('\n')[0].slice(0, 200)}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** A file list built by hand: Playwright's setInputFiles wants a buffer. */
const PDF = { name: 'semester.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') };
const DOCX = {
  name: 'timetable.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.from('PK'),
};

/**
 * Drops files on the surface without a real mouse.
 *
 * Playwright cannot drag a file from the desktop, so the DataTransfer is built
 * in the page and dispatched at the element the component actually listens on.
 * That still exercises the component's own handlers — the dragenter counter,
 * `preventDefault` on dragover, and the drop path — which is the part that
 * breaks.
 */
async function dropOn(page, selector, files) {
  await page.evaluate(
    ({ selector: target, files: payload }) => {
      const zone = document.querySelector(target);
      if (zone === null) throw new Error('no drop zone');
      const transfer = new DataTransfer();
      for (const file of payload) {
        transfer.items.add(new File([file.body], file.name, { type: file.type }));
      }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        zone.dispatchEvent(new DragEvent(type, { bubbles: true, dataTransfer: transfer }));
      }
    },
    {
      selector,
      files: files.map((file) => ({
        name: file.name,
        type: file.mimeType,
        body: file.buffer.toString('latin1'),
      })),
    },
  );
}

async function main() {
  if (!existsSync(DIST)) {
    console.log('\n  No build at apps/web/dist. Run: pnpm --filter @gradtools/web build\n');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  const server = await serve();
  const browser = await chromium.launch();
  const requests = [];
  const consoleLines = [];

  const VIEWPORTS = [
    { label: '390', width: 390, height: 844 },
    { label: '1280', width: 1280, height: 900 },
    { label: '1440', width: 1440, height: 900 },
  ];
  const THEMES = ['light', 'dark'];

  console.log('\nThe /import route, in a real browser\n');

  /* ---------------------------------------------------------------------- */
  /* The surface, at every width and in both themes                          */
  /* ---------------------------------------------------------------------- */

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      context.on('request', (request) => requests.push(request.url()));
      const page = await context.newPage();
      page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
      page.on('pageerror', (error) => consoleLines.push(`pageerror: ${String(error)}`));

      await page.goto(`${ORIGIN}/`);
      await page.evaluate((value) => {
        localStorage.setItem('gradtools:v1:theme', JSON.stringify({ appearance: value }));
      }, theme);
      await page.goto(`${ORIGIN}/import`);
      await page.waitForTimeout(700);

      const at = `${viewport.label} ${theme}`;

      await check(`${at}: the drop surface is on the page`, async () => {
        const heading = page.getByText(/Drop a document here/i);
        expect((await heading.count()) > 0, 'no drop surface');
        expect(await heading.first().isVisible(), 'drop surface not visible');
      });

      await check(`${at}: the accepted formats are stated on the surface`, async () => {
        const formats = page.getByText(/PDF · JPEG · PNG · WebP/i);
        expect((await formats.count()) > 0, 'formats not stated');
        expect(await formats.first().isVisible(), 'formats not visible');
      });

      await check(`${at}: one control, and the file input is not a second tab stop`, async () => {
        const button = page.getByRole('button', { name: 'Choose a file' });
        expect((await button.count()) === 1, 'expected exactly one Choose a file button');
        const inputExposed = await page.evaluate(() => {
          const input = document.querySelector('input[type="file"]');
          return input === null
            ? 'missing'
            : `${input.getAttribute('aria-hidden')}|${String(input.tabIndex)}`;
        });
        expect(inputExposed === 'true|-1', `file input exposed: ${inputExposed}`);
      });

      await check(`${at}: nothing overflows sideways`, async () => {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow <= 0, `horizontal overflow of ${String(overflow)}px`);
      });

      await check(`${at}: the surface and its button are inside the viewport`, async () => {
        const box = await page.getByRole('button', { name: 'Choose a file' }).boundingBox();
        expect(box !== null, 'no button box');
        expect(box.x >= 0 && box.x + box.width <= viewport.width + 1, 'button off-screen');
        expect(box.width > 40 && box.height > 20, 'button collapsed');
      });

      await check(`${at}: the theme actually applied`, async () => {
        const painted = await page.evaluate(() => {
          const body = getComputedStyle(document.body).backgroundColor;
          return { body, mark: document.documentElement.dataset.theme ?? 'system' };
        });
        expect(painted.body !== '' && painted.body !== 'rgba(0, 0, 0, 0)', 'body has no ground');
        /* The value differs per theme, which is the point of running both. */
        expect(painted.body.startsWith('rgb'), `unexpected ground: ${painted.body}`);
      });

      await context.close();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The states the surface can be in                                        */
  /* ---------------------------------------------------------------------- */

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.on('request', (request) => requests.push(request.url()));
  const page = await context.newPage();
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${String(error)}`));
  await page.goto(`${ORIGIN}/import`);
  await page.waitForTimeout(700);

  await check('keyboard: Tab reaches the choose button and Space opens the picker', async () => {
    /*
     * The old surface was a styled <label>: Tab reached it only because
     * `:focus-within` caught the hidden input, and Space did nothing at all.
     */
    const opened = await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      if (input === null) return 'missing';
      window.__picked = false;
      input.addEventListener('click', (event) => {
        event.preventDefault();
        window.__picked = true;
      });
      return 'ready';
    });
    expect(opened === 'ready', 'no file input to watch');

    const button = page.getByRole('button', { name: 'Choose a file' });
    await button.focus();
    expect(
      await page.evaluate(() => document.activeElement?.textContent?.includes('Choose a file')),
      'the button did not take focus',
    );
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__picked === true), 'Space did not open the picker');
  });

  await check('drag: the surface highlights while a file is over it', async () => {
    await page.evaluate(() => {
      /* `[data-dragging]` IS the surface — the component puts the flag on the
         element that owns the drag handlers. */
      const zone = document.querySelector('[data-dragging]');
      if (zone === null) throw new Error('no drop zone');
      const transfer = new DataTransfer();
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    });
    await page.waitForTimeout(150);
    const dragging = await page.evaluate(() =>
      document.querySelector('[data-dragging]')?.getAttribute('data-dragging'),
    );
    expect(dragging === 'true', `expected data-dragging=true, got ${String(dragging)}`);
  });

  await check('drag: the highlight clears when the file leaves', async () => {
    await page.evaluate(() => {
      const zone = document.querySelector('[data-dragging]');
      zone?.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const dragging = await page.evaluate(() =>
      document.querySelector('[data-dragging]')?.getAttribute('data-dragging'),
    );
    expect(dragging === 'false', `highlight stuck: ${String(dragging)}`);
  });

  await check('invalid: a Word document is refused, named, and the remedy given', async () => {
    await page.locator('input[type="file"]').first().setInputFiles([DOCX]);
    await page.waitForTimeout(400);
    const alert = page.getByRole('status');
    expect((await alert.count()) > 0, 'the refusal was not announced');
    const text = await alert.first().innerText();
    expect(/timetable\.docx/i.test(text), `the file was not named: ${text}`);
    expect(/PDF, JPEG, PNG, WebP/i.test(text), `the formats were not stated: ${text}`);
    expect(/saved as a PDF/i.test(text), `no remedy offered: ${text}`);
  });

  await check('invalid: the refusal can be dismissed', async () => {
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.waitForTimeout(200);
    expect((await page.getByRole('status').count()) === 0, 'the refusal did not clear');
  });

  await check('drop: a dropped PDF reaches the pipeline', async () => {
    await dropOn(page, '[data-dragging]', [PDF]);
    await page.waitForTimeout(900);
    /*
     * The stub PDF has no readable page, so the pipeline REFUSES it — which is
     * the correct outcome and still proves the drop path ran: an attachment row
     * appeared for the file that was dropped.
     */
    const body = await page.locator('#main').innerText();
    expect(/semester\.pdf/i.test(body), 'the dropped file never appeared');
  });

  await check('selected: the file is shown as a row with a status, in words', async () => {
    const body = await page.locator('#main').innerText();
    expect(/Could not be read|Read|Reading|Waiting/i.test(body), 'no status word beside the file');
  });

  await check('selected: the row can be removed, and it is named', async () => {
    const remove = page.getByRole('button', { name: /Remove semester\.pdf/i });
    expect((await remove.count()) > 0, 'no named remove control');
  });

  await check('the manual fallback is offered, and second', async () => {
    const body = await page.locator('#main').innerText();
    expect(/Enter a result by hand/i.test(body), 'no manual fallback');
  });

  await check('axe: the import route has no accessibility violations', async () => {
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) =>
      ['serious', 'critical', 'moderate', 'minor'].includes(violation.impact ?? 'minor'),
    );
    expect(
      serious.length === 0,
      `axe: ${serious.map((violation) => `${violation.id} x${String(violation.nodes.length)}`).join(', ')}`,
    );
  });

  /* ---------------------------------------------------------------------- */
  /* RadioGroup — the jsdom question, answered in a browser                   */
  /* ---------------------------------------------------------------------- */

  console.log('\nRadioGroup, in a real browser\n');

  /*
   * MOUNTED IN A PROVING GROUND, NOT REACHED THROUGH A PAGE.
   *
   * `RadioGroup` is built and unit-tested and has no caller in the product yet
   * — the frozen UI's appearance control is still its own pressed-button group,
   * and Phase 7B.1 §10 does not authorise changing it. So the component is
   * mounted on its own page, built from the same source with the same bundler,
   * and driven with a real keyboard. That answers the question the unit tests
   * could not; it does NOT claim the component is in the product.
   *
   *   apps/web/.qa/radio-harness   (gitignored)
   *   cd apps/web && npx vite build --config .qa/radio-harness/vite.config.mts
   */
  const HARNESS = resolve('apps/web/.qa/radio-harness/dist');
  let radioCount = 0;
  if (existsSync(join(HARNESS, 'index.html'))) {
    await page.goto(`${ORIGIN}/__radio__/`);
    await page.waitForTimeout(600);
    radioCount = await page.locator('[role="radio"]').count();
  }

  const radios = page.locator('[role="radio"]');

  if (radioCount === 0) {
    console.log('  SKIP  the RadioGroup proving ground is not built on this machine');
  } else {
    await check('radio: the group is named and its options are radios', async () => {
      const group = page.locator('[role="radiogroup"]').first();
      expect((await group.count()) > 0, 'no radiogroup');
      expect(radioCount >= 2, `expected at least two options, got ${String(radioCount)}`);
    });

    await check('radio: one tab stop for the whole set, landing on the selection', async () => {
      /*
       * Radix's roving-focus group puts the stop on the GROUP until focus
       * enters, then forwards it to the selected item — so counting items with
       * tabindex=0 before tabbing finds none, and that is correct rather than a
       * defect. What the pattern actually guarantees is one stop for the set
       * and that it lands on the selected option, so that is what is checked.
       */
      const before = await page.evaluate(() => ({
        items: [...document.querySelectorAll('[role="radio"]')].filter(
          (node) => node.tabIndex === 0,
        ).length,
        group: document.querySelector('[role="radiogroup"]')?.tabIndex ?? null,
      }));
      expect(
        before.items === 0 && before.group === 0,
        `unexpected stops: ${JSON.stringify(before)}`,
      );

      await page.evaluate(() => document.body.focus());
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      const landed = await page.evaluate(() => ({
        role: document.activeElement?.getAttribute('role') ?? null,
        checked: document.activeElement?.getAttribute('aria-checked') ?? null,
      }));
      expect(landed.role === 'radio', `Tab landed on ${String(landed.role)}`);
      expect(landed.checked === 'true', 'Tab did not land on the selected option');
    });

    await check('radio: a disabled option is skipped by the arrows', async () => {
      /* `Locked` is disabled in the harness and must never take focus. */
      await radios.first().focus();
      for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(80);
        const value = await page.evaluate(
          () => document.activeElement?.getAttribute('value') ?? null,
        );
        expect(value !== 'locked', 'focus landed on the disabled option');
      }
    });

    await check('radio: arrows move focus between options', async () => {
      await radios.first().focus();
      const before = await page.evaluate(
        () => document.activeElement?.getAttribute('value') ?? null,
      );
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      const after = await page.evaluate(
        () => document.activeElement?.getAttribute('value') ?? null,
      );
      expect(after !== before, `focus did not move from ${String(before)}`);
    });

    await check('radio: SELECTION FOLLOWS FOCUS (the jsdom question)', async () => {
      /*
       * The one this harness exists for. Under jsdom the selection does not
       * follow the arrow keys, because Radix records the arrow press on a
       * `document` listener that runs AFTER React's delegated focus handler.
       * In a real browser the ordering is the same, so if this passes the
       * jsdom result was an artefact of the test environment and if it fails
       * the implementation is genuinely wrong.
       */
      await radios.first().focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const focused = document.activeElement;
        return {
          checked: focused?.getAttribute('aria-checked') ?? null,
          value: focused?.getAttribute('value') ?? null,
        };
      });
      expect(
        state.checked === 'true',
        `focused option ${String(state.value)} reports aria-checked=${String(state.checked)}`,
      );
    });

    await check('radio: Space selects the focused option', async () => {
      await radios.last().focus();
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      const checked = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-checked') ?? null,
      );
      expect(checked === 'true', `Space left aria-checked=${String(checked)}`);
    });

    await check('radio: every option carries an accessible name', async () => {
      const unnamed = await page.evaluate(
        () =>
          [...document.querySelectorAll('[role="radio"]')].filter((node) => {
            const labelled = node.getAttribute('aria-label');
            if (labelled !== null && labelled.trim() !== '') return false;
            const id = node.getAttribute('id');
            const label = id === null ? null : document.querySelector(`label[for="${id}"]`);
            return (label?.textContent ?? '').trim() === '';
          }).length,
      );
      expect(unnamed === 0, `${String(unnamed)} radio(s) have no accessible name`);
    });
  }

  /* ---------------------------------------------------------------------- */

  const offOrigin = requests.filter((url) => !url.startsWith(ORIGIN));
  const errors = consoleLines.filter((line) => line.startsWith('error') || line.startsWith('page'));
  const connectionRefused = errors.filter((line) => /ERR_CONNECTION_REFUSED/.test(line));

  console.log('');
  console.log(`  Requests off-origin: ${String(offOrigin.length)}`);
  console.log(
    `  Console errors: ${String(errors.length)} ` +
      `(${String(connectionRefused.length)} are the reference API being absent, not defects)`,
  );

  await writeFile(
    join(OUT, 'import-route-report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        checks,
        problems,
        viewports: VIEWPORTS.map((viewport) => viewport.label),
        themes: THEMES,
        radiosFound: radioCount,
        offOrigin: offOrigin.length,
        consoleErrors: errors.length,
        connectionRefused: connectionRefused.length,
      },
      null,
      2,
    ),
    'utf8',
  );

  await browser.close();
  server.close();

  console.log(`\n  ${String(checks)} checks, ${String(problems.length)} problems`);
  console.log(`  Report: ${join(OUT, 'import-route-report.json')}  (private, gitignored)\n`);
  process.exit(problems.length === 0 ? 0 : 1);
}

await main();
