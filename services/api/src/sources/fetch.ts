/**
 * Gated source fetching.
 *
 * Authority: docs/14 §14.4, §14.7 · docs/13 §T-11 (SSRF) · M5 §10, §22
 *
 * Fetching is deliberately NOT a method on an adapter. An adapter describes how
 * to read a source; it does not carry permission to read it. Permission lives
 * in the `sources` row, behind a database constraint, and is re-checked here at
 * the moment of use.
 *
 * NOTHING IN M5 CALLS `fetchSource`. The scheduler that would call it does not
 * exist, every seeded source is disabled, and the constraint prevents any of
 * them being enabled. This module exists so that the gate is written, tested
 * and unavoidable BEFORE the first fetch is ever possible — not retrofitted
 * around code that already runs.
 *
 * TWO INDEPENDENT REFUSALS
 *
 * 1. Permission. A source that is not enabled is not fetched, full stop. The
 *    check is re-read from the row rather than trusted from a cached object,
 *    because a source disabled a second ago must stop being fetched now.
 * 2. Destination. Even for a permitted source, the resolved address must be a
 *    public one. A fetcher that will follow a URL to 127.0.0.1 or 169.254.169.254
 *    is an SSRF gadget regardless of how carefully the source list is curated.
 */

import { lookup } from 'node:dns/promises';
import type { Source } from '@gradtools/shared-types';

/** docs/14 §14.4. */
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const USER_AGENT = 'GradTools/0.1 (student academic utility; +https://github.com/gradtools)';

export type FetchRefusal =
  | 'source_disabled'
  | 'robots_not_allowed'
  | 'terms_not_permitted'
  | 'source_unverified'
  | 'access_method_none'
  | 'unsupported_scheme'
  | 'private_address'
  | 'host_not_resolvable';

export interface FetchAllowed {
  readonly allowed: true;
}
export interface FetchRefused {
  readonly allowed: false;
  readonly refusal: FetchRefusal;
  readonly detail: string;
}
export type FetchDecision = FetchAllowed | FetchRefused;

/**
 * Whether this source may be fetched at all.
 *
 * Mirrors `source_enable_requires_all_gates` in migration 0004. Duplicating the
 * condition is deliberate: the constraint is the guarantee, and this is the
 * explanation. A caller gets a specific reason instead of a database error, and
 * if the two ever disagree the database wins — it is the one that cannot be
 * bypassed.
 */
export function checkSourcePermission(source: Source): FetchDecision {
  if (source.accessMethod === 'none') {
    return {
      allowed: false,
      refusal: 'access_method_none',
      detail: `Source "${source.id}" is recorded for reference only and is never accessed automatically.`,
    };
  }
  if (source.robotsStatus !== 'allowed') {
    return {
      allowed: false,
      refusal: 'robots_not_allowed',
      detail: `robots.txt for "${source.id}" is ${source.robotsStatus}. Unknown is not permission.`,
    };
  }
  if (source.termsStatus !== 'permitted') {
    return {
      allowed: false,
      refusal: 'terms_not_permitted',
      detail: `Terms of use for "${source.id}" are ${source.termsStatus} and have not been cleared for automated access.`,
    };
  }
  if (source.verification !== 'verified') {
    return {
      allowed: false,
      refusal: 'source_unverified',
      detail: `Source "${source.id}" has not been verified.`,
    };
  }
  if (!source.enabled) {
    return {
      allowed: false,
      refusal: 'source_disabled',
      detail: `Source "${source.id}" is disabled.`,
    };
  }
  return { allowed: true };
}

/**
 * Whether an IP literal is one a fetcher must never reach.
 *
 * Covers loopback, RFC1918, link-local (including the cloud metadata address
 * 169.254.169.254), carrier-grade NAT, and the IPv6 equivalents. This is the
 * SSRF boundary: without it, a source URL is an instruction to make the server
 * request an arbitrary address on its own network.
 */
export function isPrivateAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // unique local
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) must be judged as the IPv4 address.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped?.[1] !== undefined) return isPrivateAddress(mapped[1]);
  return false;
}

/**
 * Whether this URL may be requested.
 *
 * Resolves the hostname and judges the ADDRESS, not the name. A hostname check
 * alone is defeated by any attacker-controlled DNS record pointing at
 * 127.0.0.1 — the name looks public and the packet goes to loopback.
 *
 * A residual TOCTOU window remains between this resolution and the request. It
 * is noted rather than papered over; closing it needs a pinned-address
 * connection, which is worth adding when fetching is actually enabled and is
 * not worth pretending to have now.
 */
export async function checkDestination(rawUrl: string): Promise<FetchDecision> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, refusal: 'unsupported_scheme', detail: 'The URL is not valid.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      allowed: false,
      refusal: 'unsupported_scheme',
      detail: `Refusing scheme "${url.protocol}". Only http and https are fetchable.`,
    };
  }

  // An IP literal in the URL is judged directly, with no DNS involved.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(literal) || literal.includes(':')) {
    return isPrivateAddress(literal)
      ? {
          allowed: false,
          refusal: 'private_address',
          detail: 'Refusing a URL that points at a private or loopback address.',
        }
      : { allowed: true };
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(url.hostname, { all: true });
  } catch {
    return {
      allowed: false,
      refusal: 'host_not_resolvable',
      detail: 'The host could not be resolved.',
    };
  }

  // EVERY resolved address must be public. One private answer among several is
  // enough to make the request unsafe.
  for (const { address } of resolved) {
    if (isPrivateAddress(address)) {
      return {
        allowed: false,
        refusal: 'private_address',
        detail: 'The host resolves to a private or loopback address.',
      };
    }
  }

  return { allowed: true };
}

export interface FetchOutcome {
  readonly ok: boolean;
  readonly status?: number;
  readonly body?: string;
  readonly refusal?: FetchRefusal;
  readonly detail?: string;
}

/**
 * Fetches a source, if and only if both gates pass.
 *
 * Not called anywhere in M5. Present so the gate exists before the capability
 * does, and so both refusal paths are covered by tests rather than by intent.
 */
export async function fetchSource(source: Source, url: string): Promise<FetchOutcome> {
  const permission = checkSourcePermission(source);
  if (!permission.allowed) {
    return { ok: false, refusal: permission.refusal, detail: permission.detail };
  }

  const destination = await checkDestination(url);
  if (!destination.allowed) {
    return { ok: false, refusal: destination.refusal, detail: destination.detail };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      // Never follow redirects blindly: a redirect is a second destination and
      // has not passed checkDestination.
      redirect: 'manual',
    });

    const body = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    return { ok: response.ok, status: response.status, body };
  } catch (cause) {
    return { ok: false, detail: cause instanceof Error ? cause.message : 'Fetch failed.' };
  } finally {
    clearTimeout(timer);
  }
}
