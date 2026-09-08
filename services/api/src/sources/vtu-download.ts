/**
 * Retrieving discovered documents, politely and once each.
 *
 * Authority: Phase 7D §8, §9, §10, §11, §12, §34, §37
 *
 * ---------------------------------------------------------------------------
 * EVERY URL ENDS SOMEWHERE (§9)
 * ---------------------------------------------------------------------------
 *
 * A run reports an outcome for every URL it was given. None is dropped, and one
 * failure does not end the run — a broken link in the middle of a thousand
 * documents is normal, and a crawler that stops there is useless.
 *
 * ---------------------------------------------------------------------------
 * THE MANIFEST IS THE MEMORY
 * ---------------------------------------------------------------------------
 *
 * What was fetched, when, what it hashed to, and which URLs pointed at it. That
 * is what makes a second run cheap (§12), what makes a changed document visible
 * rather than silent (§7), and what lets several URLs share one binary (§6).
 */

import { sha256Of, type DocumentStore } from './document-store.js';
import { USER_AGENT } from './fetch.js';

/** How a single URL turned out. Every URL gets exactly one of these (§9). */
export type DownloadState =
  | 'downloaded'
  | 'already_present'
  | 'duplicate'
  | 'changed'
  | 'failed'
  | 'blocked'
  | 'invalid_document';

export interface DownloadOutcome {
  readonly url: string;
  readonly state: DownloadState;
  readonly sha256: string | null;
  readonly byteSize: number | null;
  /** Why, for anything that is not a plain success. */
  readonly reason: string | null;
}

/** One document the manifest knows about, and every URL that led to it. */
export interface ManifestEntry {
  readonly sha256: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly urls: readonly string[];
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface Manifest {
  readonly version: 1;
  readonly entries: readonly ManifestEntry[];
  /**
   * A URL's history of hashes, newest last.
   *
   * §7: a URL whose bytes change gets a new version rather than overwriting
   * the old one, and the old hash stays reachable.
   */
  readonly urlHistory: Readonly<Record<string, readonly string[]>>;
}

export const EMPTY_MANIFEST: Manifest = { version: 1, entries: [], urlHistory: {} };

/* -------------------------------------------------------------------------- */
/* Politeness                                                                 */
/* -------------------------------------------------------------------------- */

/** One request at a time is plenty for a few hundred documents (§10). */
export const DEFAULT_CONCURRENCY = 1;
/** Between requests, so a run is a trickle rather than a burst. */
export const DEFAULT_DELAY_MS = 750;
export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A PDF begins `%PDF-`. A server returning HTML with a PDF content type does not. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * Only http(s), only VTU, and nothing that could reach inside the network.
 *
 * §37. The discovery adapter already refuses non-VTU links; this is the second
 * check, at the point where bytes are actually requested.
 */
export function isFetchableUrl(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'Not a URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `Refusing protocol ${parsed.protocol}` };
  }
  if (!/(^|\.)vtu\.ac\.in$/i.test(parsed.hostname)) {
    return { ok: false, reason: `Not a vtu.ac.in host: ${parsed.hostname}` };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

export interface FetchedDocument {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  /** 304: the server says the copy already held is current. */
  readonly notModified: boolean;
}

/**
 * One document, with retries and backoff.
 *
 * Conditional headers are sent when the manifest knows an ETag or a
 * Last-Modified for this URL, so `--changed-only` costs a 304 rather than a
 * download (§12).
 */
export async function fetchDocument(
  url: string,
  options: { readonly etag?: string | null; readonly lastModified?: string | null } = {},
  deps: { readonly fetch?: typeof globalThis.fetch; readonly delayMs?: number } = {},
): Promise<FetchedDocument> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/pdf,*/*',
  };
  if (options.etag !== null && options.etag !== undefined) headers['If-None-Match'] = options.etag;
  if (options.lastModified !== null && options.lastModified !== undefined) headers['If-Modified-Since'] = options.lastModified;

  let lastError = 'unknown';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await doFetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 304) {
        return {
          bytes: new Uint8Array(),
          mimeType: '',
          etag: options.etag ?? null,
          lastModified: options.lastModified ?? null,
          notModified: true,
        };
      }
      if (!response.ok) {
        lastError = `HTTP ${String(response.status)}`;
        /* 4xx will not improve by asking again; 5xx might. */
        if (response.status < 500) throw new Error(lastError);
      } else {
        const declared = response.headers.get('content-length');
        if (declared !== null && Number(declared) > MAX_DOCUMENT_BYTES) {
          throw new Error(`Declares ${declared} bytes, over the limit.`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
          throw new Error(`${String(bytes.byteLength)} bytes, over the limit.`);
        }
        return {
          bytes,
          mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          notModified: false,
        };
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      if (attempt === MAX_ATTEMPTS) break;
    }
    /* Exponential backoff: 1s, 2s. Not a tight retry loop against a server. */
    await sleep((deps.delayMs ?? 1000) * 2 ** (attempt - 1));
  }
  throw new Error(lastError);
}

/* -------------------------------------------------------------------------- */
/* The run                                                                    */
/* -------------------------------------------------------------------------- */

export interface DownloadOptions {
  readonly dryRun: boolean;
  readonly changedOnly: boolean;
  readonly delayMs: number;
  readonly limit: number | null;
}

/**
 * Downloads a list of URLs into the store, updating the manifest.
 *
 * Sequential on purpose (§10). A few hundred documents at one request a second
 * is a few minutes, and that is the right trade against being a burst of
 * parallel load on a university's web server.
 */
export async function downloadAll(
  urls: readonly string[],
  store: DocumentStore,
  manifest: Manifest,
  options: DownloadOptions,
  deps: { readonly fetch?: typeof globalThis.fetch; readonly now?: () => string } = {},
): Promise<{ outcomes: DownloadOutcome[]; manifest: Manifest }> {
  const now = deps.now ?? (() => new Date().toISOString());
  const byUrl = new Map<string, ManifestEntry>();
  for (const entry of manifest.entries) for (const url of entry.urls) byUrl.set(url, entry);
  const bySha = new Map(manifest.entries.map((entry) => [entry.sha256, entry]));
  const history: Record<string, string[]> = Object.fromEntries(
    Object.entries(manifest.urlHistory).map(([url, shas]) => [url, [...shas]]),
  );

  const outcomes: DownloadOutcome[] = [];
  const selected = options.limit === null ? urls : urls.slice(0, options.limit);

  for (const url of selected) {
    const known = byUrl.get(url) ?? null;

    const fetchable = isFetchableUrl(url);
    if (!fetchable.ok) {
      outcomes.push({
        url,
        state: 'blocked',
        sha256: null,
        byteSize: null,
        reason: fetchable.reason,
      });
      continue;
    }

    if (
      options.changedOnly &&
      known !== null &&
      known.etag === null &&
      known.lastModified === null
    ) {
      /*
       * Nothing to make a conditional request WITH, and the document is
       * already held. Re-downloading it to compare hashes would defeat the
       * point of the flag.
       */
      outcomes.push({
        url,
        state: 'already_present',
        sha256: known.sha256,
        byteSize: known.byteSize,
        reason: 'Held already, and the server offered no validator to check against.',
      });
      continue;
    }

    if (options.dryRun) {
      outcomes.push({
        url,
        state: known === null ? 'downloaded' : 'already_present',
        sha256: known?.sha256 ?? null,
        byteSize: known?.byteSize ?? null,
        reason: known === null ? 'Would download.' : 'Would check for changes.',
      });
      continue;
    }

    try {
      const fetched = await fetchDocument(
        url,
        { etag: known?.etag ?? null, lastModified: known?.lastModified ?? null },
        { ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) },
      );

      if (fetched.notModified && known !== null) {
        outcomes.push({
          url,
          state: 'already_present',
          sha256: known.sha256,
          byteSize: known.byteSize,
          reason: 'The server reports it unchanged.',
        });
        continue;
      }

      if (!looksLikePdf(fetched.bytes)) {
        outcomes.push({
          url,
          state: 'invalid_document',
          sha256: null,
          byteSize: fetched.bytes.byteLength,
          reason: 'The bytes do not begin with a PDF header.',
        });
        continue;
      }

      const sha256 = sha256Of(fetched.bytes);
      const stored = await store.put(fetched.bytes);
      const previous = history[url] ?? [];
      const changed = known !== null && known.sha256 !== sha256;
      if (previous[previous.length - 1] !== sha256) previous.push(sha256);
      history[url] = previous;

      const existing = bySha.get(sha256);
      /*
       * `duplicate` means ANOTHER URL already produced these bytes. The same
       * URL returning what it returned last time is `already_present` — a
       * second run of an unchanged source, which is the normal case and must
       * not read as a discovery (§9).
       */
      const seenUnderAnotherUrl = existing !== undefined && !existing.urls.includes(url);
      if (existing !== undefined) {
        /* Same bytes, another URL. One document, two source references (§6). */
        bySha.set(sha256, {
          ...existing,
          urls: existing.urls.includes(url) ? existing.urls : [...existing.urls, url],
          lastSeen: now(),
        });
      } else {
        bySha.set(sha256, {
          sha256,
          byteSize: stored.byteSize,
          mimeType: fetched.mimeType,
          urls: [url],
          firstSeen: now(),
          lastSeen: now(),
          etag: fetched.etag,
          lastModified: fetched.lastModified,
        });
      }

      outcomes.push({
        url,
        state: changed
          ? 'changed'
          : seenUnderAnotherUrl
            ? 'duplicate'
            : stored.alreadyPresent
              ? 'already_present'
              : 'downloaded',
        sha256,
        byteSize: stored.byteSize,
        reason: changed ? `Was ${known.sha256.slice(0, 12)}…, now ${sha256.slice(0, 12)}…` : null,
      });
    } catch (cause) {
      /* One bad URL does not end the run (§8). */
      outcomes.push({
        url,
        state: 'failed',
        sha256: null,
        byteSize: null,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }

    await sleep(options.delayMs);
  }

  return {
    outcomes,
    manifest: { version: 1, entries: [...bySha.values()], urlHistory: history },
  };
}
