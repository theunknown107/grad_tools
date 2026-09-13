/**
 * Screenshot every route, so the Figma port can be compared rather than
 * asserted.
 *
 * Authority: Phase Figma-port §3, §30, §31
 *
 * §30 is explicit that "tests pass" is not visual QA. This exists to produce
 * the left-hand side of the comparison: the real application, populated with
 * the repository's own seeded data, at the widths and appearances the brief
 * names. It asserts almost nothing — it is an instrument, not a gate.
 *
 * The one thing it DOES assert is horizontal overflow, because that is a
 * measurement rather than a judgement and §13 forbids hiding it.
 *
 *   node tests/figma-delta-qa.mjs            # 1280, both appearances
 *   node tests/figma-delta-qa.mjs --all      # every width in §13
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('apps/web/dist');
const OUT = resolve('.qa/figma-delta');
const PORT = 4337;
const ALL = process.argv.includes('--all');

const WIDTHS = ALL ? [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920] : [1280];

/** Every destination the shell can reach, plus the two auth-adjacent ones. */
const ROUTES = [
  ['/', 'dashboard'],
  ['/announcements', 'announcements'],
  ['/notifications', 'notifications'],
  ['/semesters', 'degree'],
  ['/results', 'results'],
  ['/academics', 'sgpa'],
  ['/attendance', 'attendance'],
  ['/timetable', 'timetable'],
  ['/exams', 'exams'],
  ['/import', 'add-document'],
  ['/account', 'account'],
  ['/profile', 'profile'],
  /*
   * The five §6 destinations that are not in the sidebar. They are still
   * compositions the design specifies, and the harness was only screenshotting
   * what the shell can reach — so these were the pages nobody had looked at.
   */
  ['/sign-in', 'sign-in'],
  ['/first-sync', 'first-sync'],
  ['/welcome', 'welcome'],
  ['/no-such-page', 'not-found'],
];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
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

/**
 * The repository's own shape of data, not the Figma prototype's.
 *
 * §5 and §24: the screenshots must show what GradTools would show. Course
 * codes are deliberately synthetic placeholders rather than a real student's
 * record, and the figures are the harness's own.
 */
function seedData() {
  const subjects = [
    ['BXXX501', 'Core course one', 4],
    ['BXXX502', 'Core course two', 4],
    ['BXXX503', 'Core course three', 3],
    ['BXXL504', 'Laboratory course', 1],
  ];
  const grades = ['O', 'A+', 'A', 'B+'];
  return {
    profile: {
      id: 'p1',
      authUserId: null,
      displayName: 'Sample Student',
      usn: '1XX22CS001',
      collegeName: 'Example Institute of Technology',
      branch: 'Computer Science and Engineering',
      programme: 'B.E.',
      schemeId: 'vtu-2022',
      currentSemester: 5,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    semesters: [1, 2, 3, 4, 5].map((n) => ({
      id: `s${n}`,
      number: n,
      status: n < 5 ? 'completed' : 'in_progress',
      subjects: subjects.map(([code, title, credits], i) => ({
        id: `${String(n)}-${code}`,
        semester: n,
        subjectCode: code,
        subjectTitle: title,
        credits,
        weeklyHours: 4,
        hasSee: i !== 3,
      })),
    })),
    results: [1, 2, 3, 4].map((n) => ({
      id: `r${n}`,
      profileId: 'p1',
      semester: n,
      schemeId: 'vtu-2022',
      ruleSetId: 'vtu-2022-v1',
      createdAt: '2026-09-01T00:00:00.000Z',
      sgpaAsserted: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
      subjects: subjects.map(([code, title, credits], i) => ({
        /*
         * `id` IS THE IDENTITY, and it was missing.
         *
         * ResultSubject requires one; this fixture left it out, so every row
         * compared `undefined === undefined` when the table asked which row is
         * expanded — and opening one course opened all of them. A defect in
         * the fixture that looked exactly like a defect in the page.
         */
        id: `${String(n)}-${code}`,
        subjectCode: code,
        subjectTitle: title,
        credits,
        gradeLetter: grades[(i + n) % grades.length],
      })),
    })),
    attendance: subjects.map(([code], i) => ({
      id: `a${code}`,
      semester: 5,
      subjectCode: code,
      attended: [44, 38, 33, 46][i],
      conducted: 48,
      updatedAt: '2026-09-01T00:00:00.000Z',
    })),
    /*
     * A WEEK, because an empty one is not a composition.
     *
     * The timetable page had never been screenshotted with anything in it —
     * the harness seeded `[]`, so every pass photographed its empty state and
     * the week grid, the day view, the lab batches and the non-teaching hours
     * went unlooked-at.
     *
     * Shaped like a real VTU week — six days, theory hours, a break and a
     * lunch, a lab in two batches, a non-teaching block — with the harness's
     * own synthetic codes. The real figures live in the academic regression;
     * §5 and §24 keep them out of a screenshot fixture.
     */
    timetable: week(),
  };
}

function week() {
  const hours = ['09:00', '10:00', '11:15', '12:15', '14:00', '15:00'];
  const ends = ['10:00', '11:00', '12:15', '13:15', '15:00', '16:00'];
  const slots = [];
  const push = (day, hour, slot) => {
    slots.push({
      id: `t-${day}-${String(hour)}`,
      profileId: 'p1',
      day,
      startTime: hours[hour] ?? '09:00',
      endTime: ends[hour] ?? '10:00',
      room: null,
      faculty: null,
      subjectCode: null,
      activity: null,
      ...slot,
    });
  };

  for (const [index, day] of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].entries()) {
    push(day, 0, { subjectCode: 'BXXX501', room: 'A-204' });
    push(day, 1, { subjectCode: 'BXXX502', room: 'A-204' });
    /* The two non-teaching hours every day has. */
    push(day, 2, { activity: 'BREAK' });
    push(day, 3, { activity: 'LUNCH' });
    if (index % 2 === 0) {
      /* A lab, in the batch the division splits into. */
      push(day, 4, { subjectCode: 'BXXL504', room: 'Lab 3', faculty: 'B1' });
    } else {
      push(day, 4, { subjectCode: 'BXXX503', room: 'A-206' });
    }
    if (index === 5) push(day, 5, { activity: 'Placement & Training' });
  }
  return slots;
}

async function seed(page, payload) {
  await page.evaluate(async (data) => {
    const put = (key, value) =>
      new Promise((ok, fail) => {
        const request = window.indexedDB.open('keyval-store', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('keyval');
        request.onsuccess = () => {
          const tx = request.result.transaction('keyval', 'readwrite');
          tx.objectStore('keyval').put(value, key);
          tx.oncomplete = ok;
          tx.onerror = fail;
        };
        request.onerror = fail;
      });
    const base = 'gradtools:v1:anon:';
    await put(`${base}profile`, data.profile);
    await put(`${base}semesters`, data.semesters);
    await put(`${base}results`, data.results);
    await put(`${base}attendance`, data.attendance);
    await put(`${base}timetable`, data.timetable);
  }, payload);
}

const problems = [];
let checks = 0;

/**
 * The collapsed rail (Figma-port §22).
 *
 * Every line here is a MEASUREMENT, which is the only kind of assertion this
 * file is allowed to make. §22 names six things collapsed mode must preserve,
 * and four of them can be measured rather than eyeballed: the width, that no
 * destination is lost, that every row still carries a hover name and an
 * accessible name, and that the active fill stays inside its own row.
 */
async function probeRail(browser, dist) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() =>
    window.localStorage.setItem(
      'gradtools:v1:theme',
      JSON.stringify({ appearance: 'light', accent: 'mono' }),
    ),
  );
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await seed(page, dist);
  await page.goto(`http://localhost:${PORT}/results`, { waitUntil: 'networkidle' });

  const NAV = 'aside#gt-sidebar nav[aria-label="Destinations"] a';
  const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
  const width = () => page.locator('aside#gt-sidebar').evaluate((el) => el.getBoundingClientRect().width);

  /* §22: expanded is the design's 256, collapsed its 76. */
  const expanded = await width();
  checks += 1;
  if (Math.round(expanded) !== 256) problems.push(`rail: expanded sidebar is ${String(expanded)}px, not 256`);

  const before = await page.locator(NAV).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  );

  await toggle.click();
  await page.waitForTimeout(320);

  const collapsed = await width();
  checks += 1;
  if (Math.round(collapsed) !== 76) problems.push(`rail: collapsed sidebar is ${String(collapsed)}px, not 76`);

  const rail = await page.locator(NAV).evaluateAll((nodes) =>
    nodes.map((node) => ({
      href: node.getAttribute('href'),
      title: node.getAttribute('title'),
      /* The accessible name must survive the rail: clip-path, not display:none. */
      name: (node.textContent ?? '').trim(),
      current: node.getAttribute('aria-current'),
      box: node.getBoundingClientRect().width,
    })),
  );

  /* No destination may be lost, and none may go nameless. */
  checks += 1;
  if (rail.length !== before.length)
    problems.push(`rail: ${String(before.length)} destinations expanded, ${String(rail.length)} collapsed`);
  for (const item of rail) {
    checks += 1;
    if (item.title === null || item.title === '')
      problems.push(`rail: ${String(item.href)} has no tooltip when collapsed`);
    if (item.name === '') problems.push(`rail: ${String(item.href)} has no accessible name when collapsed`);
  }

  /*
   * §22: "No detached stripe. No pseudo-element leaking outside the active
   * row." The active row's painted fill is its own background, so the test is
   * that nothing inside it is wider than it is.
   */
  const active = page.locator(`${NAV}[aria-current="page"]`);
  checks += 1;
  if ((await active.count()) !== 1) {
    problems.push(`rail: ${String(await active.count())} nav rows claim aria-current, expected 1`);
  } else {
    const leak = await active.evaluate((el) => {
      const row = el.getBoundingClientRect();
      const own = getComputedStyle(el);
      const painted = own.backgroundColor !== 'rgba(0, 0, 0, 0)';
      let widest = 0;
      for (const child of el.querySelectorAll('*')) {
        const style = getComputedStyle(child);
        if (style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.boxShadow === 'none') continue;
        widest = Math.max(widest, child.getBoundingClientRect().width);
      }
      return { painted, overhang: Math.round(widest - row.width), width: Math.round(row.width) };
    });
    checks += 1;
    if (!leak.painted) problems.push('rail: the active row has no fill of its own when collapsed');
    if (leak.overhang > 0)
      problems.push(`rail: something inside the active row is ${String(leak.overhang)}px wider than the row`);
  }

  /* Keyboard traversal: the rail is still a list you can tab through. */
  await page.locator(`${NAV}`).first().focus();
  const reached = [];
  for (let i = 0; i < rail.length; i += 1) {
    reached.push(
      await page.evaluate(() => document.activeElement?.getAttribute('href') ?? null),
    );
    await page.keyboard.press('Tab');
  }
  checks += 1;
  const missed = rail.map((item) => item.href).filter((href) => !reached.includes(href));
  if (missed.length > 0) problems.push(`rail: Tab never reached ${missed.join(', ')}`);

  /* Focus is left on a nav row by the traversal above; a screenshot of the
     rail should not also be a screenshot of a focus ring. */
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: join(OUT, 'rail-collapsed.png'), fullPage: false });

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.waitForTimeout(320);
  const reexpanded = await width();
  checks += 1;
  if (Math.round(reexpanded) !== 256)
    problems.push(`rail: re-expanded sidebar is ${String(reexpanded)}px, not 256`);

  await context.close();
}

/**
 * The two overlays (Figma-port §24, §25).
 *
 * The command menu and the mobile More sheet are compositions the design
 * specifies and no screenshot had ever contained, because both are closed
 * until something opens them. Same rule as everywhere else in this file: it
 * measures what can be measured and photographs the rest.
 */
async function probeOverlays(browser, dist) {
  for (const [appearance, width, name, open] of [
    ['light', 1280, 'command-menu', 'command'],
    ['dark', 1280, 'command-menu', 'command'],
    ['light', 390, 'more-sheet', 'more'],
    ['dark', 390, 'more-sheet', 'more'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: appearance,
      deviceScaleFactor: 1,
    });
    await context.addInitScript(
      (mode) =>
        window.localStorage.setItem(
          'gradtools:v1:theme',
          JSON.stringify({ appearance: mode, accent: 'mono' }),
        ),
      appearance,
    );
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await seed(page, dist);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

    if (open === 'command') {
      /* The shortcut, not the button: the shortcut is the thing the design
         prints on the trigger, so it is the thing worth testing. */
      await page.keyboard.press('Control+k');
    } else {
      await page.getByRole('button', { name: 'More' }).click();
    }
    await page.waitForTimeout(400);

    const shape = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog === null) return null;
      const focused = document.activeElement;
      /*
       * MODAL BY EITHER TECHNIQUE.
       *
       * The overlays here are modal in two different ways and both are
       * correct. The Radix ones mark the rest of the tree `aria-hidden` and
       * deliberately do NOT set `aria-modal`, because `aria-modal` has known
       * problems in some screen readers; the hand-rolled command palette is
       * not Radix and sets `aria-modal` instead. Asserting one technique
       * would have forced the other overlay to adopt it — which is what this
       * check did on its first version, and it was wrong to.
       */
      const hiddenBehind = [...document.body.children].some(
        (node) => node.getAttribute('aria-hidden') === 'true' && node.contains(document.querySelector('#main')),
      );
      return {
        tag: dialog.tagName + ' ' + String(dialog.className).slice(0, 40),
        count: document.querySelectorAll('[role="dialog"]').length,
        modal: dialog.getAttribute('aria-modal') === 'true' || hiddenBehind,
        named:
          dialog.getAttribute('aria-label') !== null ||
          dialog.getAttribute('aria-labelledby') !== null,
        /* Focus has to be INSIDE the overlay, or Tab walks the page behind it. */
        focusInside: focused !== null && dialog.contains(focused),
      };
    });

    checks += 1;
    if (shape === null) {
      problems.push(`${name} ${appearance} ${String(width)}: nothing opened`);
    } else {
      if (!shape.modal)
        problems.push(
          `${name}: neither aria-modal nor hiding the page behind it (${shape.tag})`,
        );
      if (!shape.named) problems.push(`${name}: the dialog has no accessible name`);
      if (!shape.focusInside) problems.push(`${name}: focus stayed outside the overlay`);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    checks += 1;
    if (overflow > 0) problems.push(`${name} ${appearance}: horizontal overflow ${String(overflow)}px`);

    await page.screenshot({ path: join(OUT, `${appearance}-${String(width)}-${name}.png`) });

    /*
     * §24: the control that opens this promises "results, courses, actions".
     * Typing a course code the seeded student actually has must find it, or
     * the promise on the trigger is one the palette does not keep.
     */
    if (open === 'command') {
      await page.keyboard.type('BXXL504');
      await page.waitForTimeout(250);
      const hits = await page
        .locator('[role="option"]')
        .filter({ hasText: 'BXXL504' })
        .count();
      checks += 1;
      if (hits === 0) problems.push(`${name}: searching a course code found nothing`);
      for (let i = 0; i < 7; i += 1) await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);
    }

    /* Escape closes it, and closing is not optional. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    checks += 1;
    if ((await page.locator('[role="dialog"]').count()) > 0) {
      problems.push(`${name}: Escape did not close it`);
    }

    await context.close();
  }
}

/**
 * States that only exist after a click.
 *
 * A tab nobody switches to and a row nobody expands are compositions the
 * design specifies and no screenshot contains. Same contract as the rest of
 * this file: measure the measurable, photograph the rest.
 */
async function probeStates(browser, dist) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() =>
    window.localStorage.setItem(
      'gradtools:v1:theme',
      JSON.stringify({ appearance: 'light', accent: 'mono' }),
    ),
  );
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await seed(page, dist);

  /* Results → Semesters tab. */
  await page.goto(`http://localhost:${PORT}/results`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Semesters/ }).click();
  await page.waitForTimeout(300);
  /*
   * The tab's own panel has semester cards in it. Counted by their heading
   * text rather than by tag: the card is whatever element it needs to be, and
   * a selector that guesses at the tag reports the page broken when it is the
   * selector that is wrong.
   */
  checks += 1;
  const semesterCards = await page
    .locator('[role="tabpanel"]')
    .filter({ hasText: /Semester\s*\d/i })
    .count();
  if (semesterCards === 0) {
    const seen = await page.locator('[role="tabpanel"]').count();
    problems.push(
      `results: the Semesters tab rendered no semester cards (${String(seen)} panels)`,
    );
  }
  await page.screenshot({ path: join(OUT, 'light-1280-results-semesters.png'), fullPage: true });

  /*
   * Results → a semester opened → a course expanded.
   *
   * This product's result detail is not a route: pressing a semester row on
   * Overview switches to the Semesters tab and opens that record there. So the
   * drill-in has to be driven, not navigated to.
   */
  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /^S\d\s*Semester \d/ }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'light-1280-results-open.png'), fullPage: true });

  /* Inside the table: the topbar's rail toggle is also an [aria-expanded]. */
  const subject = page.locator('table [aria-expanded]').first();
  checks += 1;
  if ((await subject.count()) === 0) {
    problems.push('results: an opened semester offers no course to expand');
  } else {
    await subject.click();
    await page.waitForTimeout(350);
    checks += 1;
    if ((await subject.getAttribute('aria-expanded')) !== 'true') {
      problems.push('results: expanding a course did not mark it expanded');
    }
    /* ONE row, not all of them. */
    checks += 1;
    const openRows = await page.locator('table [aria-expanded="true"]').count();
    if (openRows !== 1) {
      problems.push(`results: expanding one course opened ${String(openRows)} of them`);
    }
    await page.screenshot({ path: join(OUT, 'light-1280-results-course.png'), fullPage: true });
  }

  /* SGPA → the calculator tab. */
  await page.goto(`http://localhost:${PORT}/academics`, { waitUntil: 'networkidle' });
  const calc = page.getByRole('tab', { name: /Calculator/i });
  if ((await calc.count()) > 0) {
    await calc.first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'light-1280-sgpa-calculator.png'), fullPage: true });
  }

  await context.close();
}

/**
 * The type stack, and where it comes from.
 *
 * The faces used to be fetched from Google on every page load. They are served
 * from this origin now, and both halves of that are worth holding: the files
 * have to actually arrive — a self-hosted face that 404s silently falls back
 * to a system one and nothing looks obviously wrong — and nothing may go out
 * to a font CDN again.
 */
async function probeFonts(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  /* Give the faces a moment to be requested and decoded. */
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const loaded = await page.evaluate(() => {
    const families = ['IBM Plex Sans', 'Space Grotesk', 'JetBrains Mono'];
    const seen = new Set();
    document.fonts.forEach((face) => {
      if (face.status === 'loaded') seen.add(face.family.replace(/^['"]|['"]$/g, ''));
    });
    return families.map((family) => ({ family, loaded: seen.has(family) }));
  });

  for (const face of loaded) {
    checks += 1;
    if (!face.loaded) problems.push(`fonts: "${face.family}" never loaded from this origin`);
  }

  /*
   * Nothing may leave the origin. GradTools' own API on 3001 is not "away" —
   * it is the other half of the product, and the harnesses that assert this
   * elsewhere allow it for the same reason. `data:` and `blob:` are the page's
   * own bytes rather than a request to anyone.
   */
  const own = [`http://localhost:${String(PORT)}`, 'http://localhost:3001', 'data:', 'blob:'];
  const offOrigin = requests.filter((url) => !own.some((prefix) => url.startsWith(prefix)));
  checks += 1;
  if (offOrigin.length > 0) {
    problems.push(
      `fonts: ${String(offOrigin.length)} request(s) left the origin: ${offOrigin.slice(0, 3).join(', ')}`,
    );
  }

  await context.close();
}

/**
 * The shell's geometry, against the numbers the design states.
 *
 * These are the measurements a screenshot comparison keeps missing: a bar
 * seven pixels too tall and a content inset with its two values the wrong way
 * round both look fine in isolation and are wrong on every screen. Each number
 * below is quoted from the Figma source beside it, so a future change to
 * either side shows up here rather than in someone's eye.
 */
async function probeGeometry(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const measured = await page.evaluate(() => {
    const header = document.querySelector('header');
    const aside = document.querySelector('aside');
    const main = document.querySelector('#main');
    const nav = document.querySelector('aside nav a');
    const style = main === null ? null : getComputedStyle(main);
    return {
      topbar: header === null ? null : Math.round(header.getBoundingClientRect().height),
      sidebar: aside === null ? null : Math.round(aside.getBoundingClientRect().width),
      mainMax: style?.maxWidth ?? null,
      padTop: style === null ? null : Math.round(parseFloat(style.paddingTop)),
      padLeft: style === null ? null : Math.round(parseFloat(style.paddingLeft)),
      navHeight: nav === null ? null : Math.round(nav.getBoundingClientRect().height),
    };
  });

  /* [what the design says] -> [what it should measure] */
  const expected = [
    ['topbar', 64, 'header h-16'],
    ['sidebar', 256, 'aside w-[256px]'],
    ['padTop', 32, 'main sm:py-8'],
    ['padLeft', 40, 'main lg:px-10'],
    ['navHeight', 40, 'nav row h-10'],
  ];
  for (const [key, want, from] of expected) {
    checks += 1;
    if (measured[key] !== want) {
      problems.push(
        `geometry: ${key} is ${String(measured[key])}, the design says ${String(want)} (${from})`,
      );
    }
  }

  checks += 1;
  if (measured.mainMax !== '1180px') {
    problems.push(`geometry: main max-width is ${String(measured.mainMax)}, expected 1180px`);
  }

  await context.close();
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('apps/web/dist is missing. Run: pnpm --filter @gradtools/web build');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const data = seedData();

  try {
    for (const appearance of ['light', 'dark']) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: appearance,
          deviceScaleFactor: 1,
        });
        await context.clock.setFixedTime(new Date('2026-09-07T10:15:00'));
        await context.addInitScript(
          (mode) =>
            window.localStorage.setItem(
              'gradtools:v1:theme',
              JSON.stringify({ appearance: mode, accent: 'mono' }),
            ),
          appearance,
        );

        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (event) => errors.push(String(event)));
        await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
        await seed(page, data);

        for (const [path, name] of ROUTES) {
          await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' });
          await page.waitForTimeout(220);

          /* §13. A measurement, not an opinion. */
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          checks += 1;
          if (overflow > 0) {
            problems.push(`${appearance} ${width} ${name}: horizontal overflow ${overflow}px`);
          }

          /*
            FULL PAGE, always. Comparing a COMPOSITION against the design means
            seeing the whole of it: a viewport crop hides the sections below the
            fold, which is where the differences usually are.
          */
          await page.screenshot({
            path: join(OUT, `${appearance}-${String(width)}-${name}.png`),
            fullPage: true,
          });
        }

        if (errors.length > 0)
          problems.push(`${appearance} ${width}: ${errors.length} page error(s)`);
        await context.close();
      }
    }

    await probeRail(browser, data);
    await probeOverlays(browser, data);
    await probeStates(browser, data);
    await probeFonts(browser);
    await probeGeometry(browser);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n  ${String(checks)} route renders, ${String(problems.length)} problems`);
  for (const problem of problems) console.log(`    ${problem}`);
  console.log(`  Screenshots in ${OUT}`);
  if (problems.length > 0) process.exitCode = 1;
}

await main();
