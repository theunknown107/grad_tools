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
  addListener(
    event: 'change',
    listener: (state: { dark: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
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
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin<SystemAppearancePlugin>('SystemAppearance');
      const handle = await plugin.addListener('change', ({ dark }) => {
        if (!cancelled) onChange(dark);
      });
      if (cancelled) {
        void handle.remove();
        return;
      }
      remove = () => void handle.remove();
      const { dark } = await plugin.get();
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
