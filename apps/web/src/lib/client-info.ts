/**
 * Safe client diagnostics (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * Everything here is non-identifying and operational: platform, app version,
 * OS/browser FAMILY (never a full user-agent string, which can fingerprint),
 * route, online state. Nothing academic, no token, no email. This is the only
 * place that builds the `context` a problem report carries.
 */

import type { SupportContext } from '@gradtools/shared-types';

interface Capacitor {
  isNativePlatform?: () => boolean;
}

function capacitor(): Capacitor | undefined {
  return (window as { Capacitor?: Capacitor }).Capacitor;
}

export function platform(): 'web' | 'android' {
  const cap = capacitor();
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform() ? 'android' : 'web';
}

/** The web build version. On Android the native version is read lazily in `nativeVersion`. */
export function webAppVersion(): string {
  try {
    return __APP_VERSION__;
  } catch {
    return '0.0.0';
  }
}

/** Native app version + build, read from Capacitor only on a native platform. */
async function nativeVersion(): Promise<{ appVersion?: string; buildId?: string }> {
  if (platform() !== 'android') return {};
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return { appVersion: info.version, buildId: info.build };
  } catch {
    return {};
  }
}

/** A coarse OS family from the platform hint — never the full UA. */
function osFamily(): string | undefined {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return undefined;
}

/** A coarse browser family — enough to reproduce a bug, not enough to fingerprint. */
function browserFamily(): string | undefined {
  const ua = navigator.userAgent;
  if (/edg\//i.test(ua)) return 'Edge';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return undefined;
}

/** The safe diagnostic context for a report, merged with any caller-supplied fields. */
export async function collectContext(extra?: Partial<SupportContext>): Promise<SupportContext> {
  const native = await nativeVersion();
  const route = `${window.location.pathname}`.slice(0, 120);
  return {
    platform: platform(),
    appVersion: native.appVersion ?? webAppVersion(),
    ...(native.buildId !== undefined ? { buildId: native.buildId } : {}),
    route,
    online: navigator.onLine,
    ...(osFamily() !== undefined ? { osFamily: osFamily() } : {}),
    ...(browserFamily() !== undefined ? { browserFamily: browserFamily() } : {}),
    ...extra,
  };
}

/** Headers that correlate an API call with a support event, server-side. */
export function clientHeaders(): Record<string, string> {
  return { 'X-GradTools-Platform': platform(), 'X-GradTools-App-Version': webAppVersion() };
}
