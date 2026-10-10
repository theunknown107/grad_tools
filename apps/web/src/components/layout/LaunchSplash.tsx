/**
 * The app's first 800 ms on a phone: the mark, then the name, then the app.
 *
 * Android shows its own splash (brand red, the mark) while the WebView starts;
 * this picks up on the same ground so the hand-off is seamless, then steps
 * aside. CSS only — no video, no image asset, no network, no timer loop: the
 * overlay removes itself when its own fade-out animation ends.
 *
 * Only in the Android app, where a splash is expected; a website opening does
 * not delay its content. Reduced motion: not shown at all.
 */

import { useEffect, useRef, useState } from 'react';
import mark from '../../brand/gradtools-mark.svg?raw';

function shouldShow(): boolean {
  if (typeof window === 'undefined') return false;
  const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (native?.isNativePlatform?.() !== true) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LaunchSplash() {
  const [visible, setVisible] = useState(shouldShow);
  const ref = useRef<HTMLDivElement>(null);
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
      <div className="gt-splash-mark" dangerouslySetInnerHTML={{ __html: mark }} />
      <span className="gt-splash-name">GradTools</span>
    </div>
  );
}
