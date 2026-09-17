/**
 * The one appearance state the whole app shares.
 *
 * A provider, not a hook each caller instantiates: the top-bar toggle, the
 * mobile sheet, the command menu and Profile → Appearance all change the same
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
  applyTheme,
  readStoredTheme,
  resolveAppearance,
  writeStoredTheme,
  type Accent,
  type Appearance,
  type Density,
  type ThemePreference,
} from '../lib/theme.js';

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
  readonly setDensity: (density: Density) => void;
}

const ThemeContext = createContext<UseThemeResult | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const store = storage();
    return store === null ? readStoredTheme({ getItem: () => null }) : readStoredTheme(store);
  });
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  useEffect(() => {
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
  }, [preference, resolved]);

  const update = useCallback((patch: Partial<ThemePreference>) => {
    setPreference((current) => {
      const next = { ...current, ...patch };
      const store = storage();
      if (store !== null) writeStoredTheme(store, next);
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
