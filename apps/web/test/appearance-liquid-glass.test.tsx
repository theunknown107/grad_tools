/**
 * The Liquid Glass appearance toggle (opt-in glass surfaces).
 *
 * Renders Appearance settings through the REAL ThemeProvider, so flipping the
 * control drives the shipped `applyTheme` path and the document attribute the
 * stylesheet gates on — the end-to-end wiring, not a mock. Separate from the
 * light/dark control, accessible, persistent, and genuinely reversible.
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
  document.documentElement.removeAttribute('data-button-style');
});

describe('Liquid Glass appearance toggle', () => {
  it('is a discoverable, accessibly-named control in Appearance settings', () => {
    renderWith(<AppearanceSettings />);
    expect(screen.getByRole('radiogroup', { name: /liquid glass/i })).toBeTruthy();
    // Kept separate from light/dark: a Reduced-motion control still sits here too.
    expect(screen.getByLabelText(/reduced motion/i)).toBeTruthy();
  });

  it('turning it OFF then ON flips the document attribute the stylesheet gates on', async () => {
    const user = userEvent.setup();
    renderWith(<AppearanceSettings />);
    // Default is glass: no attribute (glass needs no rule).
    expect(document.documentElement.hasAttribute('data-button-style')).toBe(false);

    await user.click(screen.getByRole('radio', { name: 'Off' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-button-style')).toBe('opaque'),
    );

    await user.click(screen.getByRole('radio', { name: 'On' }));
    await waitFor(() =>
      expect(document.documentElement.hasAttribute('data-button-style')).toBe(false),
    );
  });

  it('persists OFF across a remount (reused theme storage)', async () => {
    const user = userEvent.setup();
    const first = renderWith(<AppearanceSettings />);
    await user.click(screen.getByRole('radio', { name: 'Off' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-button-style')).toBe('opaque'),
    );
    first.unmount();

    renderWith(<AppearanceSettings />);
    // The restored preference re-applies opaque, and the control shows Off checked.
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-button-style')).toBe('opaque'),
    );
    expect(screen.getByRole('radio', { name: 'Off', checked: true })).toBeTruthy();
  });
});
