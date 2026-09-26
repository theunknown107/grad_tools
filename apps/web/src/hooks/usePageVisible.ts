/**
 * Whether the student can see the app right now.
 *
 * Two signals, one answer. In a browser, `visibilitychange` says a tab was
 * hidden. In the Android app, Capacitor fires `pause` and `resume` on the
 * document when the app goes to the background and comes back — and with
 * `KeepRunning: false` (capacitor.config.json) the WebView's timers are paused
 * too. Anything that holds a connection or a timer open reads this and stops
 * while the answer is false: a hidden app has nobody to update, and every open
 * socket and wake-up costs battery (docs/48 §Background).
 */

import { useSyncExternalStore } from 'react';

let paused = false;
const listeners = new Set<() => void>();

export function isPageVisible(): boolean {
  return !paused && document.visibilityState === 'visible';
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onVisibilityChange(): void {
  /* Seeing the page is proof it is not paused, even if a `resume` was missed. */
  if (document.visibilityState === 'visible') paused = false;
  notify();
}

function onPause(): void {
  paused = true;
  notify();
}

function onResume(): void {
  paused = false;
  notify();
}

/** Calls `listener` whenever visibility may have changed. Returns the unsubscribe. */
export function subscribePageVisibility(listener: () => void): () => void {
  if (listeners.size === 0) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('pause', onPause);
    document.addEventListener('resume', onResume);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('pause', onPause);
    document.removeEventListener('resume', onResume);
  };
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribePageVisibility, isPageVisible, () => true);
}
