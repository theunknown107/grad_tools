/**
 * The theme control, as a person uses it.
 *
 * Authority: docs/05 §5.21 · docs/22 §22.30 (M9.6) · docs/27 §27.4
 *
 * These assert BEHAVIOUR — what the document ends up looking like and what
 * survives a reload — rather than which classes were applied. A theme control
 * that renders a checked radio but never stamps the attribute is broken, and
 * only the document can say so.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeControl } from '../src/components/ThemeControl.js';
import { THEME_STORAGE_KEY } from '../src/lib/theme.js';

function resetDocument(): void {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.style.colorScheme = '';
  window.localStorage.clear();
}

beforeEach(resetDocument);
afterEach(() => {
  cleanup();
  resetDocument();
});

const open = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await user.click(screen.getByRole('button', { name: /change appearance and accent/i }));
};

describe('the theme control', () => {
  it('opens, and its trigger reports the state', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);

    const trigger = screen.getByRole('button', { name: /change appearance and accent/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // The label names the CHOICE, so "System" must be visible in it rather
    // than whatever the device happens to resolve to.
    expect(trigger.getAttribute('aria-label')).toMatch(/System/);

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Theme' })).toBeTruthy();
  });

  it('applies an explicit appearance to the document and remembers it', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? '{}')).toMatchObject({
      appearance: 'dark',
    });
  });

  it('removes data-theme when returning to system', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    await user.click(screen.getByRole('button', { name: 'System' }));
    await waitFor(() => {
      // Absence is the contract: it is what lets prefers-color-scheme decide.
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
  });

  it('changes the accent without touching the appearance', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    await user.click(screen.getByRole('button', { name: 'Cyan' }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-accent')).toBe('cyan');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('marks the selected accent with more than colour', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Rose' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rose' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
    });
    // Every other swatch must drop back, or two accents read as selected.
    expect(screen.getByRole('button', { name: 'Violet' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('restores a stored preference on mount', async () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ appearance: 'light', accent: 'green' }),
    );
    render(<ThemeControl />);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
    expect(document.documentElement.getAttribute('data-accent')).toBe('green');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);
    const trigger = screen.getByRole('button', { name: /change appearance and accent/i });

    await open(user);
    expect(screen.getByRole('dialog', { name: 'Theme' })).toBeTruthy();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Theme' })).toBeNull();
    });
    // Losing focus to <body> would restart the tab order at the top of the page.
    expect(document.activeElement).toBe(trigger);
  });

  it('is reachable and operable by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /change appearance and accent/i }),
    );

    await user.keyboard('{Enter}');
    // Focus moves into the panel, or the person would tab through the whole
    // header to reach what they just opened.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Light' }));
    });

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
});
