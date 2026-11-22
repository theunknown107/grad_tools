/**
 * The Liquid Glass surface-style control (Liquid Glass / Opaque / Off).
 *
 * Renders Appearance settings through the REAL ThemeProvider, so flipping the
 * control drives the shipped `applyTheme` path and the document attributes the
 * stylesheet gates on (`data-surface` for the glass nav, `data-button-style`
 * for the glass controls) — the end-to-end wiring, not a mock. One control,
 * three genuinely distinct modes, accessible, persistent and reversible.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSettings } from '../src/features/profile/AppearanceSettings.js';
import { renderWith } from './helpers.js';

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom storage may be unavailable; ignore. */
  }
  const root = document.documentElement;
  root.removeAttribute('data-surface');
  root.removeAttribute('data-button-style');
});

describe('Liquid Glass surface-style control', () => {
  it('is a discoverable, accessibly-named control in Appearance settings', () => {
    renderWith(<AppearanceSettings />);
    expect(screen.getByRole('radiogroup', { name: /surface style/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Liquid Glass' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Opaque' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Off' })).toBeTruthy();
    // Kept separate from light/dark: a Reduced-motion control still sits here too.
    expect(screen.getByLabelText(/reduced motion/i)).toBeTruthy();
  });

  it('each mode drives the document attributes the stylesheet gates on', async () => {
    const user = userEvent.setup();
    renderWith(<AppearanceSettings />);
    const root = document.documentElement;
    // Default is Liquid Glass: neither attribute (the material is the plain selector).
    expect(root.hasAttribute('data-surface')).toBe(false);
    expect(root.hasAttribute('data-button-style')).toBe(false);

    // Opaque: solid nav AND solid glass controls.
    await user.click(screen.getByRole('radio', { name: 'Opaque' }));
    await waitFor(() => expect(root.getAttribute('data-surface')).toBe('opaque'));
    expect(root.getAttribute('data-button-style')).toBe('opaque');

    // Off: material removed on the nav, controls solid.
    await user.click(screen.getByRole('radio', { name: 'Off' }));
    await waitFor(() => expect(root.getAttribute('data-surface')).toBe('off'));
    expect(root.getAttribute('data-button-style')).toBe('opaque');

    // Back to Liquid Glass: both attributes cleared.
    await user.click(screen.getByRole('radio', { name: 'Liquid Glass' }));
    await waitFor(() => expect(root.hasAttribute('data-surface')).toBe(false));
    expect(root.hasAttribute('data-button-style')).toBe(false);
  });

  it('persists the chosen mode across a remount (reused theme storage)', async () => {
    const user = userEvent.setup();
    const first = renderWith(<AppearanceSettings />);
    await user.click(screen.getByRole('radio', { name: 'Off' }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-surface')).toBe('off'));
    first.unmount();

    renderWith(<AppearanceSettings />);
    await waitFor(() => expect(document.documentElement.getAttribute('data-surface')).toBe('off'));
    expect(screen.getByRole('radio', { name: 'Off', checked: true })).toBeTruthy();
  });
});
