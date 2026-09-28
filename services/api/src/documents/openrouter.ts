/**
 * Document reading through OpenRouter — FREE MODELS ONLY, and fail closed.
 *
 * THE ZERO-COST RULE. Before every read, each configured model is resolved
 * against OpenRouter's live endpoint metadata (a metadata call, never an
 * inference). A model is used only if at least one of its endpoints prices
 * EVERY metered item at exactly zero — prompt, completion, request, image and
 * anything else listed. A missing or unparseable price is not zero. The model
 * name (":free") is never trusted. The request then repeats the rule to the
 * router itself: `max_price` of zero on every item, so no paid endpoint can be
 * chosen even if the metadata changed in between; no fallback to other models
 * (`models`/`route` are never sent), no `openrouter/*` auto-router, no plugins.
 *
 * PRIVACY. With `requireZdr` (the default, and the only setting allowed in a
 * deployed environment) the request is routed only to zero-data-retention
 * endpoints that deny data collection — `provider.zdr` and
 * `provider.data_collection: "deny"` — and a model with no such endpoint is
 * refused before the document is sent. Without it (local development against
 * SYNTHETIC documents only) the price rule still applies in full.
 *
 * WHAT THE MODEL GETS: a fixed system instruction, one fixed text turn and the
 * document as an inline image. No tools, no functions, no web plugin, no files
 * API. Its reply is text, returned unparsed and untrusted to `readDocument`.
 */

import type { AiDocumentMimeType } from '@gradtools/shared-types';
import { DocumentReaderError, type DocumentReader } from './gemini.js';
import { DOCUMENT_TURN, EXTRACTION_INSTRUCTION, GEMINI_RESPONSE_SCHEMA } from './instruction.js';

const API = 'https://openrouter.ai/api/v1';

/** The slice of OpenRouter's `/models/{id}/endpoints` reply this module reads. */
export interface ModelEndpoints {
  readonly id: string;
  readonly architecture: {
    readonly input_modalities: readonly string[];
    readonly output_modalities: readonly string[];
  };
  readonly endpoints: readonly {
    readonly tag: string;
    readonly pricing: Readonly<Record<string, unknown>>;
    readonly supported_parameters: readonly string[];
    readonly status: number;
  }[];
}

export interface Assessment {
  readonly model: string;
  readonly eligible: boolean;
  /** Why not, in words for a developer; empty when eligible. */
  readonly reasons: readonly string[];
  /** `json_schema` when every usable endpoint enforces a schema, else `json_object`. */
  readonly output: 'json_schema' | 'json_object' | null;
  readonly freeEndpoints: number;
  readonly privateEndpoints: number;
}

/** Every metered price is present-and-zero. `discount` is a ratio, not a price. */
export function isFree(pricing: Readonly<Record<string, unknown>>): boolean {
  if (!('prompt' in pricing) || !('completion' in pricing)) return false;
  return Object.entries(pricing).every(
    ([item, value]) =>
      item === 'discount' ||
      ((typeof value === 'string' || typeof value === 'number') &&
        String(value).trim() !== '' &&
        Number(value) === 0),
  );
}

/**
 * Whether a model may read documents, from metadata alone.
 *
 * `zdrTags` is the set of endpoint tags OpenRouter lists as zero-data-retention
 * for this model; `null` means privacy is not being required (synthetic use).
 */
export function assessModel(meta: ModelEndpoints, zdrTags: ReadonlySet<string> | null): Assessment {
  const reasons: string[] = [];
  if (meta.id.startsWith('openrouter/')) reasons.push('an automatic router, not a model');
  if (!meta.architecture.input_modalities.includes('image')) reasons.push('no image input');
  const out = meta.architecture.output_modalities;
  if (out.length !== 1 || out[0] !== 'text') reasons.push(`output is ${out.join('+')}, not text`);

  const free = meta.endpoints.filter((endpoint) => isFree(endpoint.pricing));
  const up = free.filter((endpoint) => endpoint.status === 0);
  const json = up.filter(
    (endpoint) =>
      endpoint.supported_parameters.includes('structured_outputs') ||
      endpoint.supported_parameters.includes('response_format'),
  );
  const usable = zdrTags === null ? json : json.filter((endpoint) => zdrTags.has(endpoint.tag));

  if (free.length === 0) reasons.push('no endpoint priced $0 for every item');
  else if (up.length === 0) reasons.push('no free endpoint is currently up');
  else if (json.length === 0) reasons.push('no free endpoint supports structured (JSON) output');
  else if (usable.length === 0) reasons.push('no free endpoint offers zero data retention');

  const eligible = reasons.length === 0 && usable.length > 0;
  return {
    model: meta.id,
    eligible,
    reasons,
    output: !eligible
      ? null
      : usable.every((endpoint) => endpoint.supported_parameters.includes('structured_outputs'))
        ? 'json_schema'
        : 'json_object',
    freeEndpoints: free.length,
    privateEndpoints: zdrTags === null ? 0 : free.filter((e) => zdrTags.has(e.tag)).length,
  };
}

type Fetch = typeof fetch;

/** The provider's own error words, for the diagnostic log. Never document content. */
async function providerDetail(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: unknown; metadata?: { raw?: unknown; provider_name?: unknown } };
  } | null;
  const error = body?.error;
  return [error?.metadata?.provider_name, error?.message, error?.metadata?.raw]
    .filter((part) => typeof part === 'string')
    .join(' | ')
    .slice(0, 300);
}

/** A GET of OpenRouter's public metadata (`/models`, `/endpoints/zdr`, …): its `data`. */
export async function openRouterMetadata<T>(
  path: string,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${API}${path}`, { signal });
  if (response.status === 404) throw new DocumentReaderError('model_unavailable');
  if (!response.ok) throw new DocumentReaderError('service');
  return ((await response.json()) as { data: T }).data;
}

/** Live metadata for one model, and the tags of its ZDR endpoints. */
export async function fetchAssessment(
  model: string,
  requireZdr: boolean,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<Assessment> {
  const meta = await openRouterMetadata<ModelEndpoints>(
    `/models/${model}/endpoints`,
    signal,
    fetchImpl,
  );
  let zdrTags: Set<string> | null = null;
  if (requireZdr) {
    const listed = await openRouterMetadata<{ model_id: string; tag: string }[]>(
      '/endpoints/zdr',
      signal,
      fetchImpl,
    );
    zdrTags = new Set(listed.filter((e) => e.model_id === model).map((e) => e.tag));
  }
  return assessModel(meta, zdrTags);
}

function imageUrl(document: { bytes: Uint8Array; mimeType: AiDocumentMimeType }): string {
  return `data:${document.mimeType};base64,${Buffer.from(document.bytes).toString('base64')}`;
}

/** The chat request. Built from constants and the image; nothing else. */
export function buildRequest(
  model: string,
  output: 'json_schema' | 'json_object',
  requireZdr: boolean,
  document: { bytes: Uint8Array; mimeType: AiDocumentMimeType },
): Record<string, unknown> {
  const schemaText = JSON.stringify(GEMINI_RESPONSE_SCHEMA);
  return {
    model,
    messages: [
      {
        role: 'system',
        content:
          output === 'json_schema'
            ? EXTRACTION_INSTRUCTION
            : `${EXTRACTION_INSTRUCTION}\n\nReply with ONE JSON object matching this JSON Schema, and nothing else:\n${schemaText}`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: DOCUMENT_TURN },
          { type: 'image_url', image_url: { url: imageUrl(document) } },
        ],
      },
    ],
    response_format:
      output === 'json_schema'
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'document_extraction',
              strict: true,
              schema: GEMINI_RESPONSE_SCHEMA,
            },
          }
        : { type: 'json_object' },
    provider: {
      /* The router enforces the same rule the metadata check did. */
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      require_parameters: true,
      allow_fallbacks: false,
      ...(requireZdr ? { zdr: true, data_collection: 'deny' } : {}),
    },
  };
}

export interface OpenRouterReaderOptions {
  readonly apiKey: string;
  /** Tried in order; the second only when the first is ineligible or unavailable. */
  readonly models: readonly string[];
  readonly requireZdr: boolean;
  readonly fetch?: Fetch;
  /** Diagnostics only: model ids, statuses, reasons. Never document content. */
  readonly log?: (event: Record<string, unknown>) => void;
  readonly now?: () => number;
}

export function createOpenRouterReader(options: OpenRouterReaderOptions): DocumentReader {
  const fetchImpl = options.fetch ?? fetch;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? Date.now;
  /* After a 429 nothing is sent until OpenRouter's reset time: no retry loop. */
  let blockedUntil = 0;

  return async (document, signal) => {
    /* Image-only models: a PDF is rendered to a page image on the device first. */
    if (document.mimeType === 'application/pdf') throw new DocumentReaderError('unsupported_type');
    if (now() < blockedUntil) throw new DocumentReaderError('rate_limited');
    let last: DocumentReaderError = new DocumentReaderError('model_unavailable');

    for (const model of options.models) {
      try {
        const assessment = await fetchAssessment(model, options.requireZdr, signal, fetchImpl);
        if (!assessment.eligible || assessment.output === null) {
          log({ event: 'document_ai_model_refused', model, reasons: assessment.reasons });
          last = new DocumentReaderError('model_unavailable');
          continue;
        }

        const response = await fetchImpl(`${API}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            buildRequest(model, assessment.output, options.requireZdr, document),
          ),
          signal,
        });

        if (response.status === 429) {
          const reset = Number(response.headers.get('x-ratelimit-reset'));
          blockedUntil = Number.isFinite(reset) && reset > now() ? reset : now() + 60_000;
          log({
            event: 'document_ai_rate_limited',
            model,
            until: blockedUntil,
            detail: await providerDetail(response),
          });
          throw new DocumentReaderError('rate_limited');
        }
        if (response.status === 401 || response.status === 402 || response.status === 403) {
          log({
            event: 'document_ai_refused',
            model,
            status: response.status,
            detail: await providerDetail(response),
          });
          throw new DocumentReaderError('not_configured');
        }
        if (!response.ok) {
          log({
            event: 'document_ai_unavailable',
            model,
            status: response.status,
            detail: await providerDetail(response),
          });
          last = new DocumentReaderError(response.status === 404 ? 'model_unavailable' : 'service');
          continue;
        }

        const body = (await response.json()) as {
          model?: string;
          usage?: { cost?: number };
          choices?: { message?: { content?: unknown } }[];
          error?: unknown;
        };
        /* A reply that says it cost money is refused, and said out loud. */
        if (typeof body.usage?.cost === 'number' && body.usage.cost > 0) {
          log({ event: 'document_ai_nonzero_cost', model, cost: body.usage.cost });
          throw new DocumentReaderError('service');
        }
        const content = body.choices?.[0]?.message?.content;
        if (body.error !== undefined || typeof content !== 'string') {
          log({ event: 'document_ai_empty_reply', model });
          last = new DocumentReaderError('service');
          continue;
        }
        return content;
      } catch (error) {
        if (error instanceof DocumentReaderError) {
          if (error.failure === 'rate_limited' || error.failure === 'not_configured') throw error;
          last = error;
          continue;
        }
        if (signal.aborted) throw new DocumentReaderError('timeout');
        log({ event: 'document_ai_network', model });
        last = new DocumentReaderError('service');
      }
    }
    throw last;
  };
}
