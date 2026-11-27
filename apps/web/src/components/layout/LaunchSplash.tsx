/**
 * The app's first ~900 ms on a phone: the cap draws itself, then the name,
 * then the app.
 *
 * Android shows its own splash (the black cap on white) while the WebView
 * starts; this picks up on the same ground so the hand-off is seamless, then
 * steps aside. CSS only — no video, no image asset, no network, no timer loop:
 * the overlay removes itself when its own fade-out animation ends, and nothing
 * (Clerk, routing) waits for it.
 *
 * Only in the Android app, where a splash is expected; a website opening does
 * not delay its content. Reduced motion — the device's or the app's own
 * setting — not shown at all; the static native splash already shows the mark.
 */

import { useEffect, useRef, useState } from 'react';
import logo from '../../brand/gradtools-logo.png';

function shouldShow(): boolean {
  if (typeof window === 'undefined') return false;
  const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (native?.isNativePlatform?.() !== true) return false;
  if (document.documentElement.getAttribute('data-motion') === 'reduced') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LaunchSplash() {
  const [visible, setVisible] = useState(shouldShow);
  const ref = useRef<HTMLDivElement>(null);
  // The overlay (or, without one, the app) now covers the screen: drop the
  // pre-paint white ground index.html set, whether or not a splash shows.
  useEffect(() => {
    document.documentElement.classList.remove('gt-booting');
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    /* A native listener: the standard event name, in every WebView. */
    const ended = (event: Event): void => {
      if ((event as AnimationEvent).animationName === 'gt-splash-out') setVisible(false);
    };
    element.addEventListener('animationend', ended);
    return () => {
      element.removeEventListener('animationend', ended);
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <div ref={ref} aria-hidden="true" data-testid="launch-splash" className="gt-splash">
      <div className="gt-splash-mark">
        <img src={logo} alt="" width={96} height={96} />
      </div>
      <span className="gt-splash-name">GradTools</span>
    </div>
  );
}
