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
  useRef,
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
  type ButtonStyle,
  type Density,
  type SurfaceStyle,
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
  readonly setButtonStyle: (buttonStyle: ButtonStyle) => void;
  /** The Liquid Glass surface mode; also keeps the glass controls in step. */
  readonly setSurface: (surface: SurfaceStyle) => void;
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

  /*
   * A visible change of environment (light <-> dark, or a new accent) cross-fades
   * the whole page as one through a view transition, so background, glass, text
   * and controls change together instead of at their own speeds. The first
   * render, reduced motion and engines without the API switch directly.
   */
  const applied = useRef(false);
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      applyTheme(root, preference);
      root.classList.toggle('dark', resolved === 'dark');
      root.style.colorScheme = resolved;
    };
    const visible =
      applied.current &&
      (root.classList.contains('dark') !== (resolved === 'dark') ||
        root.getAttribute('data-accent') !== preference.accent);
    applied.current = true;
    const transition = (
      document as Document & {
        startViewTransition?: (update: () => void) => { finished: Promise<void> };
      }
    ).startViewTransition;
    const still =
      preference.reducedMotion ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!visible || still || typeof transition !== 'function') {
      apply();
      return;
    }
    root.classList.add('gt-theme-swap');
    transition
      .call(document, apply)
      .finished.catch(() => undefined)
      .finally(() => root.classList.remove('gt-theme-swap'));
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
      setButtonStyle: (buttonStyle) => update({ buttonStyle }),
      // One control for the whole material: the glass nav follows `surface`, and
      // the glass buttons/search follow `buttonStyle` — kept in step here so the
      // Appearance setting is a single, unambiguous choice.
      setSurface: (surface) =>
        update({ surface, buttonStyle: surface === 'liquid' ? 'glass' : 'opaque' }),
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
