/**
 * Pure helpers for the auth diagnostic (DIAGNOSTIC build only — see
 * DiagnosticsPage, gated by `VITE_DIAGNOSTICS`). Nothing here touches the Clerk
 * lifecycle; it only *describes* configuration and sanitizes probe results.
 *
 * PRIVACY: a publishable key is public, but this never renders the whole of it
 * — only its public prefix, category and last 4 chars for correlation. No
 * secret key, token, cookie or header value is ever produced here.
 */

export type KeyCategory = 'test' | 'live' | 'unknown';

export interface KeyReport {
  readonly present: boolean;
  readonly validFormat: boolean;
  readonly category: KeyCategory;
  /** Safe to show: prefix + last 4, never the whole key. */
  readonly masked: string;
}

/** A Clerk publishable key is `pk_(test|live)_<base64-ish>`. */
const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9/+=_-]+$/;

export function classifyPublishableKey(key: string | null): KeyReport {
  if (key === null || key === '') {
    return { present: false, validFormat: false, category: 'unknown', masked: '—' };
  }
  const category: KeyCategory = key.startsWith('pk_test_')
    ? 'test'
    : key.startsWith('pk_live_')
      ? 'live'
      : 'unknown';
  const prefix =
    category === 'test' ? 'pk_test_' : category === 'live' ? 'pk_live_' : key.slice(0, 3);
  const tail = key.length >= 4 ? key.slice(-4) : '';
  return {
    present: true,
    validFormat: PUBLISHABLE_KEY.test(key),
    category,
    masked: `${prefix}…${tail}`,
  };
}

export interface ApiUrlReport {
  /** What a request actually targets (own origin shown explicitly). */
  readonly effective: string;
  /** `VITE_API_URL` was set at build time. */
  readonly configured: boolean;
  readonly https: boolean;
  /** Using `http://localhost:3001` because nothing was configured — fatal on a phone. */
  readonly localhostFallback: boolean;
  /** Served next to its own API (no cross-origin URL needed). */
  readonly sameOrigin: boolean;
}

export function analyzeApiUrl(opts: {
  readonly effective: string;
  readonly configuredRaw: string | undefined;
  readonly origin: string;
}): ApiUrlReport {
  const configured = typeof opts.configuredRaw === 'string' && opts.configuredRaw !== '';
  const effective = opts.effective;
  const sameOrigin = effective === '';
  const https = sameOrigin ? opts.origin.startsWith('https://') : effective.startsWith('https://');
  const localhostFallback = !configured && /^https?:\/\/localhost(:\d+)?/i.test(effective);
  return {
    effective: sameOrigin ? `${opts.origin} (own origin)` : effective,
    configured,
    https,
    localhostFallback,
    sameOrigin,
  };
}

/** A probe outcome, already stripped of any response body. */
export type ProbeResult =
  | { readonly kind: 'ok'; readonly status: number }
  | { readonly kind: 'unauthorized'; readonly status: number }
  | { readonly kind: 'forbidden'; readonly status: number }
  | { readonly kind: 'server-error'; readonly status: number }
  | { readonly kind: 'no-token' }
  | { readonly kind: 'unconfigured' }
  /** The server answered, but CORS forbids this origin from reading it. */
  | { readonly kind: 'cors' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network' };

export const PROBE_TIMEOUT_MS = 15_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Runs one read-only probe and says WHY it failed, as far as a browser can.
 * A browser reports a CORS refusal and a dead network identically — `fetch`
 * rejects — so after a rejection an opaque `no-cors` GET to the same URL is
 * tried: if it resolves, the server answered and CORS is the cause. If the
 * server also sends a restrictive Cross-Origin-Resource-Policy (the GradTools
 * API sends `same-site`), the opaque request is blocked too and the cause
 * stays ambiguous — reported as `network`, worded as "network, TLS or CORS",
 * never as a proven outage. `doFetch` resolving to null means no session token.
 */
export async function runProbe(
  doFetch: () => Promise<Response | null>,
  url: string,
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Promise<ProbeResult> {
  try {
    const res = await doFetch();
    return res === null ? { kind: 'no-token' } : classifyStatus(res.status);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') return { kind: 'timeout' };
    try {
      await fetchFn(url, { mode: 'no-cors', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return { kind: 'cors' };
    } catch {
      return { kind: 'network' };
    }
  }
}

/** HTTP status → a sanitized, UI-ready category. */
export function classifyStatus(status: number): ProbeResult {
  if (status >= 200 && status < 300) return { kind: 'ok', status };
  if (status === 401) return { kind: 'unauthorized', status };
  if (status === 403) return { kind: 'forbidden', status };
  return { kind: 'server-error', status };
}

export const PROBE_LABEL: Record<ProbeResult['kind'], string> = {
  ok: 'Reachable, request accepted',
  unauthorized: 'Reachable, token rejected (401)',
  forbidden: 'Reachable, forbidden (403)',
  'server-error': 'Reachable, server error',
  'no-token': 'No session — nothing to send',
  unconfigured: 'No GradTools server configured',
  cors: 'Reachable, but CORS blocks this origin',
  timeout: `No answer within ${String(PROBE_TIMEOUT_MS / 1000)} s`,
  network: 'No readable reply (network, TLS or CORS)',
};

/* -------------------------------------------------------------------------- */
/* Session restoration verdict                                                */
/* -------------------------------------------------------------------------- */

export interface RestoreVerdict {
  readonly value: string;
  readonly tone: 'success' | 'neutral' | 'info' | 'warning' | 'danger';
}

/**
 * What happened to the session between the last recorded load and this one,
 * claimed only as far as the evidence goes.
 *
 * - A deliberate sign-out (its timestamp, recorded by AuthContext) is never a
 *   "lost" session. While the server has not confirmed it, that is said.
 * - No client session is NOT proof the server revoked one: the wording stays
 *   on this device.
 * - "Not restored" is reported only when there WAS a session before, nobody
 *   signed out here, and the provider now reports none.
 */
export function restoreVerdict(input: {
  readonly previous: string | null;
  readonly current: string;
  readonly signedOutAt: string | null;
  readonly signOutPending: boolean;
}): RestoreVerdict {
  const { previous, current, signedOutAt, signOutPending } = input;
  if (current === 'restoring') return { value: 'Checking…', tone: 'info' };
  if (current === 'expired') {
    return { value: 'Unknown — the sign-in service could not be reached', tone: 'warning' };
  }
  if (current === 'signed_out' && signedOutAt !== null) {
    return signOutPending
      ? { value: 'Signed out on purpose — server-side sign-out pending', tone: 'warning' }
      : { value: 'Signed out on purpose — no active session on this device', tone: 'neutral' };
  }
  if (current === 'signed_in') {
    if (previous === 'signed_in') return { value: 'Yes — session restored', tone: 'success' };
    return { value: 'n/a — signed in during this load', tone: 'neutral' };
  }
  if (previous === null) return { value: 'Unknown — no earlier load recorded', tone: 'neutral' };
  if (previous === 'signed_in') {
    return {
      value: 'NO — the session was not restored, and nobody signed out here',
      tone: 'danger',
    };
  }
  return { value: 'n/a — no session (signed out before this load)', tone: 'neutral' };
}
