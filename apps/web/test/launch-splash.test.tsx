/**
 * The launch splash: Android only, brief, self-removing, and absent for
 * anyone who asked for reduced motion.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchSplash } from '../src/components/layout/LaunchSplash.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'Capacitor');
  vi.unstubAllGlobals();
});

function native(reducedMotion: boolean) {
  (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reducedMotion && query.includes('reduce'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('the launch splash', () => {
  it('never delays a website', () => {
    render(<LaunchSplash />);
    expect(screen.queryByTestId('launch-splash')).toBeNull();
  });

  it('shows the mark and the name in the app, then removes itself when it has faded', () => {
    native(false);
    render(<LaunchSplash />);
    const splash = screen.getByTestId('launch-splash');
    expect(splash.querySelector('svg')).not.toBeNull();
    expect(splash.textContent).toContain('GradTools');
    // Its own fade-out ending is what removes it — no timer, nothing left behind.
    // jsdom has no AnimationEvent, so the event carries its name by hand.
    const ended = new Event('animationend', { bubbles: true });
    Object.defineProperty(ended, 'animationName', { value: 'gt-splash-out' });
    act(() => {
      splash.dispatchEvent(ended);
    });
    expect(screen.queryByTestId('launch-splash')).toBeNull();
  });

  it('is not shown at all under reduced motion', () => {
    native(true);
    render(<LaunchSplash />);
    expect(screen.queryByTestId('launch-splash')).toBeNull();
  });
});
