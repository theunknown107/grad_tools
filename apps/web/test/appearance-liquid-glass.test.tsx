/**
 * The Glass control on the Themes page (Clear / Regular / Frosted / Solid).
 *
 * Renders the settings through the REAL ThemeProvider, so flipping the control
 * drives the shipped `applyTheme` path and the document attributes the
 * stylesheet gates on (`data-glass` for the level, `data-transparency` for
 * Solid) — the end-to-end wiring, not a mock. This replaced the release
 * candidate's separate Surface-style control when the two theme systems were
 * merged into production's.
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
  root.removeAttribute('data-glass');
  root.removeAttribute('data-transparency');
});

describe('Glass control', () => {
  it('is a discoverable, accessibly-named control', () => {
    renderWith(<AppearanceSettings />);
    expect(screen.getByRole('radiogroup', { name: 'Glass' })).toBeTruthy();
    for (const name of ['Clear', 'Regular', 'Frosted', 'Solid']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
  });

  it('each choice drives the document attributes the stylesheet gates on', async () => {
    const user = userEvent.setup();
    renderWith(<AppearanceSettings />);
    const root = document.documentElement;

    await user.click(screen.getByRole('radio', { name: 'Solid' }));
    await waitFor(() => expect(root.getAttribute('data-transparency')).toBe('reduced'));

    await user.click(screen.getByRole('radio', { name: 'Frosted' }));
    await waitFor(() => expect(root.getAttribute('data-glass')).toBe('frosted'));
    expect(root.hasAttribute('data-transparency')).toBe(false);
  });

  it('persists the choice across a remount', async () => {
    const user = userEvent.setup();
    const first = renderWith(<AppearanceSettings />);
    await user.click(screen.getByRole('radio', { name: 'Solid' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-transparency')).toBe('reduced'),
    );
    first.unmount();

    renderWith(<AppearanceSettings />);
    expect(screen.getByRole('radio', { name: 'Solid', checked: true })).toBeTruthy();
  });
});
