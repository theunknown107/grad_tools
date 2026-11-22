/**
 * The Android app's first frame (device test 2026-11-05): the native side sets
 * `window.__GT_NATIVE__` before any page script, and the theme starts from it —
 * the synchronously saved theme over localStorage, Android's dark mode over
 * the WebView's media query — so there is no light frame to correct later.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from '../src/hooks/useTheme.js';

type NativeWindow = Window & { __GT_NATIVE__?: unknown };

afterEach(() => {
  cleanup();
  delete (window as NativeWindow).__GT_NATIVE__;
  window.localStorage.clear();
  document.documentElement.className = '';
});

function Probe() {
  const { preference, resolved } = useTheme();
  return (
    <p data-testid="probe">
      {preference.appearance}/{preference.accent}/{resolved}
    </p>
  );
}

describe('starting from the native answer', () => {
  it('resolves System from Android, not the media query, on the first render', () => {
    (window as NativeWindow).__GT_NATIVE__ = {
      systemDark: true,
      theme: JSON.stringify({ appearance: 'system', accent: 'crimson-tinted' }),
    };
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('system/crimson-tinted/dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('prefers the natively saved theme over an older localStorage copy', () => {
    window.localStorage.setItem(
      'gradtools:v1:theme',
      JSON.stringify({ appearance: 'light', accent: 'mono' }),
    );
    (window as NativeWindow).__GT_NATIVE__ = {
      systemDark: false,
      theme: JSON.stringify({ appearance: 'dark', accent: 'ocean' }),
    };
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('dark/ocean/dark');
  });

  it('keeps an explicit Light whatever Android says', () => {
    (window as NativeWindow).__GT_NATIVE__ = {
      systemDark: true,
      theme: JSON.stringify({ appearance: 'light', accent: 'violet' }),
    };
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('light/violet/light');
  });

  it('applies the saved-id migrations to the native copy too', () => {
    (window as NativeWindow).__GT_NATIVE__ = {
      systemDark: false,
      theme: JSON.stringify({ appearance: 'light', accent: 'cyan' }),
    };
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('light/turquoise/light');
  });
});
