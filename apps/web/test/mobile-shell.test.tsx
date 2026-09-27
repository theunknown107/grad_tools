/**
 * The phone shell after the first physical-device test.
 *
 * What the device showed, and what each test pins:
 *   - a full-width grey top bar          → no bar; floating 44px bubbles
 *   - the bottom bar riding the keyboard → hidden while an IME is up, back after
 *   - a college list opening over the
 *     status bar                         → capped, prefers down, measured insets
 *   - a two-column wall of pills in More → one column of plain rows
 *   - "could not be loaded" with no
 *     server configured at all           → says it is not connected, sends nothing
 *
 * jsdom applies no CSS, so these assert the contract the CSS depends on.
 * SYNTHETIC CONTENT ONLY.
 */

import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/components/layout/AppShell.js';
import { DESTINATIONS } from '../src/components/layout/nav.js';
import { Select } from '../src/components/ui/field.js';
import { BranchField, SchemeField } from '../src/features/onboarding/AcademicFields.js';
import { KEYBOARD_MIN_PX, collisionInsets } from '../src/lib/viewport.js';
import { renderWith } from './helpers.js';

afterEach(cleanup);

function shell(route = '/') {
  return renderWith(<AppShell>{null}</AppShell>, { route });
}

function bottomBar(): HTMLElement {
  return document.querySelector('nav[aria-label="Main"]') as HTMLElement;
}

/* -- A controllable visual viewport ---------------------------------------- */

class FakeViewport extends EventTarget {
  width = 390;
  height = 780;
  offsetTop = 0;
}
let viewport: FakeViewport;

beforeEach(() => {
  viewport = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport');
});

function keyboard(open: boolean): void {
  act(() => {
    viewport.height = open ? 780 - (KEYBOARD_MIN_PX + 150) : 780;
    viewport.dispatchEvent(new Event('resize'));
  });
}

describe('the top of the app', () => {
  it('has no bar: the controls scroll with the page, on no fill and no rule', () => {
    shell();
    const header = document.querySelector('header') as HTMLElement;
    // Inside the scroll area, so no hard edge cuts the content off beneath it.
    expect(header.closest('#gt-main')).not.toBeNull();
    // No surface on a phone; only from md does it pin on the page colour.
    const phone = header.className.split(/\s+/).filter((name) => !name.startsWith('md:'));
    expect(phone.join(' ')).not.toMatch(/gt-bar|\bbg-|border-b|sticky|fixed/);
    expect(header.className).toContain('pt-[var(--gt-safe-top)]');
  });

  it('keeps a strip of page colour behind the status bar, and nothing more', () => {
    shell();
    const scrim = [...document.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find(
      (element) => (element.getAttribute('class') ?? '').includes('h-[var(--gt-safe-top)]'),
    ) as HTMLElement;
    expect(scrim).not.toBeNull();
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
    expect(scrim.className).toContain('pointer-events-none');
  });

  it('floats each control as its own compact bubble with a full-size touch ring', () => {
    shell();
    const header = document.querySelector('header') as HTMLElement;
    for (const name of [/^search$/i, /switch to (light|dark) theme/i, /^notifications/i]) {
      const control = within(header).getByRole(
        name.source.includes('notifications') ? 'link' : 'button',
        { name },
      );
      // The size lives in --gt-bubble-size (36px); the 44px target in .gt-hit.
      expect(control.className).toContain('gt-bubble');
      expect(control.className).toContain('gt-hit');
      expect(control.className).not.toMatch(/\bsize-\d/);
    }
    const home = within(header).getByRole('link', { name: 'GradTools home' });
    expect(home.className).toContain('gt-hit');
    expect((home.querySelector('[data-testid="gradtools-logo"]') as HTMLElement).style.width).toBe(
      '36px',
    );
    const profile = within(header).getByRole('link', { name: 'Open profile' });
    expect(profile.className).toContain('gt-hit');
    expect((profile.firstElementChild as HTMLElement).style.width).toBe('36px');
  });
});

describe('the bottom bar and the keyboard', () => {
  it('steps aside while a keyboard is up, and comes back when it goes', () => {
    renderWith(
      <AppShell>
        <input aria-label="USN" />
      </AppShell>,
    );
    const field = screen.getByRole('textbox', { name: 'USN' });
    act(() => {
      field.focus();
    });
    keyboard(true);
    expect(bottomBar().hidden).toBe(true);

    keyboard(false);
    expect(bottomBar().hidden).toBe(false);
  });

  it('stays aside through a rotation made with the keyboard up, without a flicker', () => {
    renderWith(
      <AppShell>
        <input aria-label="Branch" />
      </AppShell>,
    );
    act(() => {
      screen.getByRole('textbox', { name: 'Branch' }).focus();
    });
    keyboard(true);
    expect(bottomBar().hidden).toBe(true);

    /*
     * Landscape, keyboard still up: a width never seen before, whose only
     * height so far is the shrunken one. Two events, because a second one at
     * the same size is where a baseline learned from the shrunken height
     * would bring the bar back.
     */
    const seen: boolean[] = [];
    for (let event = 0; event < 2; event += 1) {
      act(() => {
        viewport.width = 780;
        viewport.height = 150;
        viewport.dispatchEvent(new Event('resize'));
      });
      seen.push(bottomBar().hidden);
    }
    expect(seen).toEqual([true, true]);

    // The keyboard closes in landscape: the bar comes back.
    act(() => {
      viewport.height = 390;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(bottomBar().hidden).toBe(false);

    // And back to portrait with the keyboard closed, it stays.
    act(() => {
      viewport.width = 390;
      viewport.height = 780;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(bottomBar().hidden).toBe(false);
  });

  it('does not hide for focus alone — a hardware keyboard leaves the screen whole', () => {
    renderWith(
      <AppShell>
        <input aria-label="Search" />
      </AppShell>,
    );
    act(() => {
      screen.getByRole('textbox', { name: 'Search' }).focus();
    });
    expect(bottomBar().hidden).toBe(false);
  });

  it('does not hide for a shrinking viewport without a field to type in', () => {
    shell();
    keyboard(true);
    expect(bottomBar().hidden).toBe(false);
  });
});

describe('a dropdown', () => {
  it('stays clear of the bottom bar, and of the keyboard when it only covers the page', () => {
    shell();
    Object.defineProperty(bottomBar(), 'getClientRects', { value: () => [{}] });
    Object.defineProperty(bottomBar(), 'getBoundingClientRect', {
      value: () => ({ height: 72 }),
    });
    expect(collisionInsets().bottom).toBe(72 + 8);

    // A keyboard that shrinks only the visual viewport covers more than the bar.
    vi.stubGlobal('innerHeight', 780);
    viewport.height = 440;
    expect(collisionInsets().bottom).toBe(340 + 8);
    vi.unstubAllGlobals();
  });

  it('opens downward, capped, and scrolls inside rather than flipping to fit', () => {
    renderWith(
      <Select
        value="a"
        onValueChange={() => undefined}
        aria-label="College"
        options={Array.from({ length: 40 }, (_, index) => ({
          value: index === 0 ? 'a' : `c${String(index)}`,
          label: `Synthetic College ${String(index)}`,
        }))}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('combobox'), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    const popup = document.querySelector('[data-slot="popup"]') as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.getAttribute('data-side')).toBe('bottom');
    expect(popup.className).toContain(
      'max-h-[min(var(--radix-select-content-available-height),18rem)]',
    );
  });
});

describe('More', () => {
  it('is one column of plain rows, with every destination still there', () => {
    shell();
    fireEvent.click(screen.getByRole('button', { name: /^more/i }));
    const sheet = screen.getByRole('navigation', { name: 'All destinations' });
    expect(sheet.querySelector('.grid-cols-2')).toBeNull();
    const links = within(sheet).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href')).sort()).toEqual(
      DESTINATIONS.map((item) => item.to).sort(),
    );
    for (const link of links) expect(link.className).not.toMatch(/\bborder\b/);
  });

  it('marks where you are with the same pill as the rest of the navigation', () => {
    shell('/timetable');
    fireEvent.click(screen.getByRole('button', { name: /^more/i }));
    const sheet = screen.getByRole('navigation', { name: 'All destinations' });
    const current = within(sheet).getByRole('link', { name: /^timetable$/i });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('bg-accent-weak');
  });
});

describe('an app with no server configured', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '');
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(window, 'Capacitor');
  });

  it('says it is not connected rather than that the server failed, and sends nothing', async () => {
    const sent = vi.spyOn(globalThis, 'fetch');
    renderWith(
      <>
        <SchemeField value="vtu-2022" onChange={() => undefined} />
        <BranchField value="" onChange={() => undefined} />
      </>,
    );
    // The branch list is the transcribed 2022 one: offered with no request at all.
    expect(await screen.findByRole('combobox', { name: /branch/i })).toBeTruthy();
    expect(screen.getByText(/2022-scheme branch list, as transcribed/i)).toBeTruthy();
    // The scheme list is versioned into the app: it needs no server either.
    expect(screen.getByText(/GradTools calculates figures for this scheme/i)).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
    sent.mockRestore();
  });
});
