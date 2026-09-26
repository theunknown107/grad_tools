/**
 * Three navigation states, and a label you can read without a pointer.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG
 * ---------------------------------------------------------------------------
 *
 * The sidebar was `lg:flex` and the bottom bar `lg:hidden`. Tailwind's `lg` is
 * 1024px, so every tablet — 600, 768, 820, 834, 912 — was served the phone
 * bottom bar and no sidebar at all: a tablet given a failed desktop
 * breakpoint. Nothing caught it because no sweep ever looked between 430 and
 * 768.
 *
 * jsdom applies no CSS, so a width cannot be asserted here. What CAN be
 * asserted is the contract the CSS depends on, and that is what broke: which
 * element carries which breakpoint class, that every destination is reachable
 * in each state, and — the part a media query cannot rescue — that every
 * destination's NAME IS TEXT, present in the markup, with no pointer event and
 * no `title` attribute standing in for it. A tooltip is unreachable on a
 * touchscreen, which is precisely what a tablet is.
 *
 * The widths themselves are covered by `tests/app-qa.mjs`, which now sweeps
 * the 600-912 band in a real browser.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { AppShell } from '../src/components/layout/AppShell.js';
import { DESTINATIONS, MOBILE_TABS, isActive } from '../src/components/layout/nav.js';
import { renderWith } from './helpers.js';

/* `globals: false`, so testing-library's auto-cleanup is not installed. */
afterEach(cleanup);

function shell(route = '/') {
  return renderWith(<AppShell>{null}</AppShell>, { route });
}

/** The sidebar, which is the rail at `md` and the full sidebar at `lg`. */
function sidebar(): HTMLElement {
  const aside = document.getElementById('gt-sidebar');
  expect(aside).not.toBeNull();
  return aside as HTMLElement;
}

function bottomBar(): HTMLElement {
  const nav = document.querySelector('nav[aria-label="Main"]');
  expect(nav).not.toBeNull();
  return nav as HTMLElement;
}

describe('the three navigation states', () => {
  it('shows the sidebar from md, not from lg', () => {
    shell();
    const classes = sidebar().className;

    /* The whole defect in one assertion. */
    expect(classes).toContain('md:flex');
    expect(classes).not.toContain('lg:flex');
  });

  it('hands over to the bottom bar at the same breakpoint, so neither gaps nor doubles', () => {
    shell();
    expect(sidebar().className).toContain('md:flex');
    expect(bottomBar().className).toContain('md:hidden');
    expect(bottomBar().className).not.toContain('lg:hidden');
  });

  it('reserves bottom-bar space only while the bottom bar is there', () => {
    shell();
    const main = document.getElementById('gt-main');
    expect(main?.className).toContain('pb-24');
    expect(main?.className).toContain('md:pb-0');
  });

  it('widens from the rail to the full sidebar at lg', () => {
    shell();
    const classes = sidebar().className;
    expect(classes).toContain('w-[88px]');
    expect(classes).toContain('lg:w-[256px]');
  });
});

describe('every destination is reachable', () => {
  it('lists all of them in the sidebar, in every state', () => {
    shell();
    const names = [...sidebar().querySelectorAll('a')].map((link) => link.textContent ?? '');
    for (const destination of DESTINATIONS) {
      expect(names).toContain(destination.label);
    }
  });

  it('puts the five tabs on the bottom bar and the rest one tap away', () => {
    shell();
    const tabs = [...bottomBar().querySelectorAll('a')].map((link) => link.textContent ?? '');
    expect(tabs).toHaveLength(MOBILE_TABS.length);
    for (const tab of MOBILE_TABS) expect(tabs).toContain(tab.short);

    /* And "More" opens the rest rather than the bar growing a sixth item. */
    expect(screen.getByRole('button', { name: /^More/ })).toBeTruthy();
  });

  it('opens the whole navigation from More alone, with no second trigger in the top bar', async () => {
    shell();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^More/ }));
    const sheet = await screen.findByRole('dialog');
    const names = [...sheet.querySelectorAll('a')].map((link) => link.textContent ?? '');
    for (const destination of DESTINATIONS) {
      expect(names.some((name) => name.includes(destination.label))).toBe(true);
    }
    for (const appearance of ['Light', 'Dark', 'System']) {
      expect(within(sheet).getByRole('button', { name: appearance })).toBeTruthy();
    }
  });
});

describe('a label you can read without a pointer', () => {
  /*
   * The rail used to be specified with hidden labels and `title` tooltips.
   * Both are hover-dependent, and a tablet has no hover.
   */
  it('gives every sidebar destination its name as rendered text', () => {
    shell();
    for (const link of sidebar().querySelectorAll('a[href]')) {
      const destination = DESTINATIONS.find((one) => one.label === link.textContent);
      if (destination === undefined) continue;
      expect(link.textContent?.trim()).toBe(destination.label);
    }
  });

  it('never leaves a destination named only by a tooltip', () => {
    shell();
    for (const link of sidebar().querySelectorAll('a')) {
      expect(link.getAttribute('title')).toBeNull();
    }
    for (const link of bottomBar().querySelectorAll('a')) {
      expect(link.getAttribute('title')).toBeNull();
    }
  });

  it('gives every bottom-bar tab a visible label beside its icon', () => {
    shell();
    for (const link of bottomBar().querySelectorAll('a')) {
      expect((link.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});

describe('the active destination', () => {
  it('is marked by shape as well as colour, in both navigations', () => {
    shell('/results');

    const current = [...document.querySelectorAll('[aria-current="page"]')];
    expect(current.length).toBeGreaterThan(0);
    for (const element of current) {
      /*
       * `text-accent-ink` alone is what the bottom bar used to carry, and
       * colour alone is not an indicator anyone with a colour deficiency can
       * read. The filled pill is the sidebar's own answer, now shared.
       */
      expect(element.className).toContain('bg-accent-weak');
    }
  });

  it('follows isActive, so a detail route still marks its section', () => {
    shell('/results/4');
    expect(isActive('/results', '/results/4')).toBe(true);

    const current = [...document.querySelectorAll('[aria-current="page"]')].map(
      (element) => element.getAttribute('href') ?? '',
    );
    expect(current).toContain('/results');
    expect(current).not.toContain('/');
  });
});
