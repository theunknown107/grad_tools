/**
 * The document-AI provider router — a TINY, GradTools-specific fallback layer.
 *
 * It composes the existing provider readers (`createOpenRouterReader`,
 * `createGeminiReader`) into one `DocumentReader`. Per request it tries the
 * approved providers in a fixed priority order, skipping any on cooldown, and
 * returns the first reply that satisfies the strict schema. If a provider is
 * rate-limited, times out, fails, breaches the zero-cost policy, or returns an
 * invalid reply, it moves to the next approved provider — up to a hard cap.
 *
 * WHAT THE ROUTER DOES NOT DO, ON PURPOSE:
 *   - It does not choose models or relax any provider's own policy. Each reader
 *     still enforces free-only / ZDR / max_price=0 / no-paid-fallback / non-zero
 *     cost rejection / server-only credentials. The router cannot disable any of
 *     that; a fallback is only ever "try the next equally-constrained provider".
 *   - It does not see the client's wishes. Provider order is server config; the
 *     document's contents never influence selection.
 *   - It does not validate the schema itself — it calls the ONE shared validator
 *     (`validateAiReply`) so `read.ts` and the router agree exactly on "valid".
 *   - It does not decide document type or academic facts — `recognize()` and the
 *     deterministic engine remain authoritative, downstream in `read.ts`.
 *
 * A new provider is added by appending a `Provider` entry, not by touching the
 * extraction pipeline.
 */

import { DocumentReaderError, type DocumentReader } from './gemini.js';
import { DocumentReadError, validateAiReply } from './read.js';

/** What a provider can do. Advisory: the reader stays authoritative for safety. */
export interface ProviderCapabilities {
  readonly image: boolean;
  readonly structuredOutput: boolean;
}

/** Config-time eligibility. Privacy/ZDR is enforced inside the reader itself. */
export interface ProviderPolicy {
  /**
   * How the provider's $0 cost is established. ONLY `verified-per-read` is
   * eligible for routing: the reader proves $0 against the provider's own live
   * pricing on every call (OpenRouter). `deployment-approved` is what a mere
   * boolean flag would assert — an operator's word, not a mechanical guarantee —
   * and the router treats it as INELIGIBLE. Unknown/unprovable cost never routes
   * (docs/13 §13.31). A provider (e.g. Gemini) that cannot prove $0 per request
   * therefore cannot be selected, no matter what any flag says.
   */
  readonly zeroCost: 'verified-per-read' | 'deployment-approved';
  readonly enabled: boolean;
}

export interface Provider {
  readonly id: string;
  readonly model: string;
  readonly reader: DocumentReader;
  readonly capabilities: ProviderCapabilities;
  readonly policy: ProviderPolicy;
  /** Lower is tried first. */
  readonly priority: number;
}

/** In-process, per-provider health. No document, student data, key or reply. */
interface ProviderHealth {
  openUntil: number;
  consecutiveFailures: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  lastClass: DocumentReaderError['failure'] | 'invalid_reply' | null;
}

/** A failure this document would hit on every provider — do not fall back. */
const STOP: ReadonlySet<string> = new Set(['unsupported_type']);

const MAX_ATTEMPTS = 3;
const TRANSIENT_BASE_MS = 5_000;
const TRANSIENT_CAP_MS = 60_000;
const QUARANTINE_MS = 24 * 60 * 60 * 1000; // a cost breach: out for the day
const MISCONFIGURED_MS = 5 * 60 * 1000; // a fixed config recovers without a restart

export interface RouterOptions {
  /** Diagnostics only: provider id, model, class, attempt, cooldown. Never content. */
  readonly log?: (event: Record<string, unknown>) => void;
  readonly now?: () => number;
}

/** How long a provider is out after a given failure. */
function cooldownFor(
  failure: DocumentReaderError['failure'] | 'invalid_reply',
  health: ProviderHealth,
  now: number,
  retryAt: number | undefined,
): number {
  switch (failure) {
    case 'rate_limited':
      return retryAt !== undefined && retryAt > now ? retryAt : now + 60_000;
    case 'non_zero_cost':
      return now + QUARANTINE_MS;
    case 'not_configured':
      return now + MISCONFIGURED_MS;
    default: {
      // timeout / service / model_unavailable / invalid_reply: exponential, capped.
      const step = Math.min(TRANSIENT_BASE_MS * 2 ** health.consecutiveFailures, TRANSIENT_CAP_MS);
      return now + step;
    }
  }
}

export function createProviderRouter(
  providers: readonly Provider[],
  options: RouterOptions = {},
): DocumentReader {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? Date.now;
  const health = new Map<string, ProviderHealth>();
  const healthOf = (id: string): ProviderHealth => {
    let row = health.get(id);
    if (row === undefined) {
      row = {
        openUntil: 0,
        consecutiveFailures: 0,
        lastSuccess: null,
        lastFailure: null,
        lastClass: null,
      };
      health.set(id, row);
    }
    return row;
  };

  // Eligibility is fail-closed: a provider must be enabled, take an image and
  // produce structured output, AND prove $0 per read. A provider whose cost is
  // only flag-asserted (`deployment-approved`) is never selected — a boolean can
  // never establish zero-cost (docs/13 §13.31).
  const candidates = providers
    .filter(
      (p) =>
        p.policy.enabled &&
        p.policy.zeroCost === 'verified-per-read' &&
        p.capabilities.image &&
        p.capabilities.structuredOutput,
    )
    .sort((a, b) => a.priority - b.priority);

  return async (document, signal) => {
    let attempts = 0;
    let last: DocumentReaderError = new DocumentReaderError('service');

    for (const provider of candidates) {
      if (attempts >= MAX_ATTEMPTS) break;
      const h = healthOf(provider.id);
      if (now() < h.openUntil) {
        log({ event: 'document_ai_router_skip', provider: provider.id, reason: 'cooldown' });
        continue;
      }
      if (signal.aborted) throw new DocumentReaderError('timeout');
      attempts += 1;

      try {
        const reply = await provider.reader(document, signal);
        validateAiReply(reply); // throws DocumentReadError('invalid_reply') if unusable
        h.openUntil = 0;
        h.consecutiveFailures = 0;
        h.lastSuccess = now();
        h.lastClass = null;
        log({
          event: 'document_ai_router_ok',
          provider: provider.id,
          model: provider.model,
          attempt: attempts,
        });
        return reply;
      } catch (error) {
        if (signal.aborted) throw new DocumentReaderError('timeout');

        const failure: DocumentReaderError['failure'] | 'invalid_reply' =
          error instanceof DocumentReaderError
            ? error.failure
            : error instanceof DocumentReadError && error.failure === 'invalid_reply'
              ? 'invalid_reply'
              : 'service';

        // A document-level failure would repeat on every provider: stop now.
        if (STOP.has(failure))
          throw new DocumentReaderError(failure as DocumentReaderError['failure']);

        const retryAt = error instanceof DocumentReaderError ? error.retryAt : undefined;
        h.consecutiveFailures += 1;
        h.lastFailure = now();
        h.lastClass = failure;
        h.openUntil = cooldownFor(failure, h, now(), retryAt);
        last =
          failure === 'invalid_reply'
            ? new DocumentReaderError('service')
            : (error as DocumentReaderError);
        log({
          event: 'document_ai_router_fail',
          provider: provider.id,
          model: provider.model,
          attempt: attempts,
          failure,
          cooldownMs: h.openUntil - now(),
        });
      }
    }

    // No approved provider produced a usable reply → the caller's offline path.
    throw last;
  };
}
