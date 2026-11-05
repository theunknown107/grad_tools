/**
 * Android's real light/dark mode and status-bar style, for the installed app.
 *
 * In the browser, `prefers-color-scheme` is the authority and nothing here
 * runs. In the Android app the WebView reported light while the system was in
 * dark mode (device test 2026-11-05, defect 4), so the native
 * `SystemAppearance` plugin (android/app/.../SystemAppearancePlugin.java)
 * reports the activity's own night mode instead, and again on every change.
 *
 * The status-bar icons follow the app's RESOLVED appearance, not the
 * system's: an explicit Dark choice on a light phone needs light icons
 * (defect 3). Capacitor's built-in SystemBars plugin sets them; no new
 * dependency.
 */

interface SystemAppearancePlugin {
  get(): Promise<{ dark: boolean }>;
  saveTheme(options: { value: string }): Promise<void>;
  addListener(
    event: 'change',
    listener: (state: { dark: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/*
 * One registration per page: registering twice only logs a Capacitor warning.
 * Boxed, because a Capacitor plugin proxy answers every property — `then`
 * included — so a promise must never resolve to the proxy itself.
 */
let pluginBox: Promise<{ readonly native: SystemAppearancePlugin }> | null = null;
function plugin(): Promise<{ readonly native: SystemAppearancePlugin }> {
  pluginBox ??= import('@capacitor/core').then(({ registerPlugin }) => ({
    native: registerPlugin<SystemAppearancePlugin>('SystemAppearance'),
  }));
  return pluginBox;
}

export function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

/**
 * Calls `onChange` with Android's night mode now and on every change. Returns
 * the unsubscribe; a no-op outside the Android app.
 */
export function watchNativeSystemDark(onChange: (dark: boolean) => void): () => void {
  if (!isNativeApp()) return () => undefined;
  let cancelled = false;
  let remove: (() => void) | undefined;
  void (async () => {
    try {
      const appearance = (await plugin()).native;
      const handle = await appearance.addListener('change', ({ dark }) => {
        if (!cancelled) onChange(dark);
      });
      if (cancelled) {
        void handle.remove();
        return;
      }
      remove = () => void handle.remove();
      const { dark } = await appearance.get();
      if (!cancelled) onChange(dark);
    } catch {
      /* An older app build without the plugin: prefers-color-scheme stays in charge. */
    }
  })();
  return () => {
    cancelled = true;
    remove?.();
  };
}

/** Light icons on a dark app, dark icons on a light one. A no-op on the web. */
export function setNativeBarsFor(appearance: 'light' | 'dark'): void {
  if (!isNativeApp()) return;
  void (async () => {
    try {
      const { SystemBars, SystemBarsStyle } = await import('@capacitor/core');
      await SystemBars.setStyle({
        style: appearance === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
      });
    } catch {
      /* The bars keep their previous style; nothing else depends on it. */
    }
  })();
}

/**
 * What the native side set before the page's first script ran
 * (SystemAppearancePlugin's document-start script): Android's dark mode and
 * the theme it saved. Undefined in the browser, and on a WebView without
 * document-start scripts.
 */
export function nativeStart():
  { readonly systemDark: boolean; readonly theme: string | null } | undefined {
  const start = (window as { __GT_NATIVE__?: { systemDark?: unknown; theme?: unknown } })
    .__GT_NATIVE__;
  if (start === undefined || typeof start.systemDark !== 'boolean') return undefined;
  return {
    systemDark: start.systemDark,
    theme: typeof start.theme === 'string' ? start.theme : null,
  };
}

/**
 * Saves the theme JSON on the native side, synchronously there
 * (SharedPreferences.commit). localStorage alone reached disk too late: a
 * theme chosen and force-stopped within a second came back old. A no-op on
 * the web. Calls reach native in order, so the latest choice is the one kept.
 */
export function saveNativeTheme(value: string): void {
  if (!isNativeApp()) return;
  void (async () => {
    try {
      await (await plugin()).native.saveTheme({ value });
    } catch {
      /* localStorage still holds it; it reaches disk a moment later. */
    }
  })();
}
