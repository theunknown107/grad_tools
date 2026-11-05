/**
 * The one appearance state the whole app shares.
 *
 * A provider, not a hook each caller instantiates: the top-bar toggle, the
 * mobile sheet, the command menu and Settings → Appearance all change the same
 * preference, and separate `useState`s would each believe their own copy.
 *
 * Presentation only. No academic rule, repository read or API request may
 * branch on anything here (lib/theme.ts).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  resolveAppearance,
  writeStoredTheme,
  type Accent,
  type Appearance,
  type Density,
  type ThemePreference,
} from '../lib/theme.js';
import {
  isNativeApp,
  nativeStart,
  saveNativeTheme,
  setNativeBarsFor,
  watchNativeSystemDark,
} from '../lib/system-appearance.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface UseThemeResult {
  readonly preference: ThemePreference;
  readonly resolved: 'light' | 'dark';
  readonly setAppearance: (appearance: Appearance) => void;
  /** Light ↔ dark from whatever is showing now. The top-bar control. */
  readonly toggleAppearance: () => void;
  readonly setAccent: (accent: Accent) => void;
  readonly setReducedMotion: (reducedMotion: boolean) => void;
  readonly setReducedTransparency: (reducedTransparency: boolean) => void;
  readonly setDensity: (density: Density) => void;
}

const ThemeContext = createContext<UseThemeResult | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  /*
   * The saved theme. In the Android app the native copy (written synchronously)
   * comes first; localStorage is the browser's store and the fallback. Both
   * hold the same JSON, so readStoredTheme's compatibility rules (cyan, green,
   * unknown ids) apply to either.
   */
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const native = nativeStart();
    if (native !== undefined && native.theme !== null) {
      const saved = native.theme;
      return readStoredTheme({ getItem: () => saved });
    }
    const store = storage();
    return store === null ? readStoredTheme({ getItem: () => null }) : readStoredTheme(store);
  });
  /* Native: start from the media query only until the plugin answers (it
     replaces it within a frame or two of startup). */
  const [systemDark, setSystemDark] = useState<boolean>(
    () => nativeStart()?.systemDark ?? prefersDark(),
  );

  /*
   * First run of a build with native storage: carry the existing localStorage
   * choice across once, so the native copy never starts out older than it.
   */
  useEffect(() => {
    const native = nativeStart();
    if (native === undefined || native.theme !== null) return;
    const raw = storage()?.getItem(THEME_STORAGE_KEY) ?? null;
    if (raw !== null) saveNativeTheme(raw);
  }, []);

  /*
   * ONE source of truth for "is the system dark".
   *
   * Browser: the `prefers-color-scheme` media query. Android app: Android's own
   * night mode, from the SystemAppearance plugin — and the media query is NOT
   * consulted there at all. The WebView reported light while the system was
   * dark, and listening to both made them fight: every status-bar restyle
   * re-fired the media query, which flipped the theme back (device test
   * 2026-11-05, defect 4).
   */
  useEffect(() => {
    if (isNativeApp()) return watchNativeSystemDark(setSystemDark);
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveAppearance(preference.appearance, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    applyTheme(root, preference);
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    setNativeBarsFor(resolved);
  }, [preference, resolved]);

  const update = useCallback((patch: Partial<ThemePreference>) => {
    setPreference((current) => {
      const next = { ...current, ...patch };
      const store = storage();
      if (store !== null) writeStoredTheme(store, next);
      /* Android: the synchronous copy, so a force-stop right after cannot lose it. */
      saveNativeTheme(JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<UseThemeResult>(
    () => ({
      preference,
      resolved,
      setAppearance: (appearance) => update({ appearance }),
      toggleAppearance: () => update({ appearance: resolved === 'dark' ? 'light' : 'dark' }),
      setAccent: (accent) => update({ accent }),
      setReducedMotion: (reducedMotion) => update({ reducedMotion }),
      setReducedTransparency: (reducedTransparency) => update({ reducedTransparency }),
      setDensity: (density) => update({ density }),
    }),
    [preference, resolved, update],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): UseThemeResult {
  const context = useContext(ThemeContext);
  if (context === null) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
