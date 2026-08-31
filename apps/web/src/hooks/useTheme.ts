/**
 * The live theme preference.
 *
 * Authority: docs/05 §5.21 (M9.6)
 *
 * State lives in this hook, but the SOURCE OF TRUTH for what is on screen is
 * the pair of attributes on <html> — they are set by the inline script in
 * index.html before first paint, and this hook adopts whatever it finds rather
 * than re-deriving it. That ordering is what prevents the flash of the wrong
 * theme, and it means the hook can never disagree with the document.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  readStoredTheme,
  writeStoredTheme,
  resolveAppearance,
  type Accent,
  type Appearance,
  type ThemePreference,
} from '../lib/theme.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function prefersDark(): boolean {
  // matchMedia is absent in some test environments and old embedded webviews.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

export interface UseThemeResult {
  readonly preference: ThemePreference;
  /** What `system` currently resolves to — for labelling, never for logic. */
  readonly resolved: 'light' | 'dark';
  readonly setAppearance: (appearance: Appearance) => void;
  readonly setAccent: (accent: Accent) => void;
}

export function useTheme(): UseThemeResult {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readStoredTheme(window.localStorage),
  );
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  /*
   * Follow the operating system while the choice is `system`. The listener is
   * attached unconditionally rather than only under `system`, because a person
   * can switch back to `system` without the OS having changed, and a stale
   * `systemDark` would then resolve to the wrong appearance until they moved a
   * window.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    applyTheme(document.documentElement, preference);
  }, [preference]);

  /*
   * Derived from the CURRENT preference, not from a fresh storage read: if a
   * write failed (private mode, disabled site data) the stored value is stale,
   * and re-reading it would silently revert the choice the person just made.
   * The in-memory value is what is on screen, so it is what we extend.
   */
  const update = useCallback((patch: Partial<ThemePreference>) => {
    setPreference((current) => {
      const next = { ...current, ...patch };
      writeStoredTheme(window.localStorage, next);
      return next;
    });
  }, []);

  const setAppearance = useCallback((appearance: Appearance) => update({ appearance }), [update]);
  const setAccent = useCallback((accent: Accent) => update({ accent }), [update]);

  return {
    preference,
    resolved: resolveAppearance(preference.appearance, systemDark),
    setAppearance,
    setAccent,
  };
}
