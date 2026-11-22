/**
 * Free-only OpenRouter reading: what decides whether a document is sent.
 *
 * OpenRouter is replaced by a scripted `fetch` that records every call, so the
 * tests pin what GradTools controls — a model not verified $0 for every item
 * at request time is never called, privacy routing is required by default,
 * nothing falls back to anything unverified, and provider trouble becomes a
 * controlled failure. Metadata and replies below are SYNTHETIC.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertSafeExposure, loadConfig } from '../src/config.js';
import { EXTRACTION_INSTRUCTION } from '../src/documents/instruction.js';
import {
  assessModel,
  createOpenRouterReader,
  isFree,
  type ModelEndpoints,
} from '../src/documents/openrouter.js';
import { readDocument } from '../src/documents/read.js';

const CARD_PNG = readFileSync(
  join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'documents', 'result-card.png'),
);
const PNG = { bytes: CARD_PNG, mimeType: 'image/png' as const };

const endpoint = (over: Partial<ModelEndpoints['endpoints'][number]> = {}) => ({
  tag: 'host/fp8',
  pricing: { prompt: '0', completion: '0', discount: 0 },
  supported_parameters: ['response_format', 'structured_outputs'],
  status: 0,
  ...over,
});
const model = (id: string, over: Partial<ModelEndpoints> = {}): ModelEndpoints => ({
  id,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  endpoints: [endpoint()],
  ...over,
});
const ZDR = new Set(['host/fp8']);

describe('the $0 rule', () => {
  it('accepts only a price list where every metered item is present and zero', () => {
    expect(isFree({ prompt: '0', completion: '0', discount: 0 })).toBe(true);
    expect(isFree({ prompt: '0', completion: '0.000001' })).toBe(false);
    expect(isFree({ prompt: '0', completion: '0', image: '0.0001' })).toBe(false);
    expect(isFree({ prompt: '0', completion: '0', request: '0.01' })).toBe(false);
  });

  it('treats a missing or unreadable price as not free', () => {
    expect(isFree({ prompt: '0' })).toBe(false);
    expect(isFree({ completion: '0' })).toBe(false);
    expect(isFree({ prompt: '', completion: '0' })).toBe(false);
    expect(isFree({ prompt: null, completion: '0' })).toBe(false);
    expect(isFree({ prompt: 'free', completion: '0' })).toBe(false);
  });

  it('does not trust a ":free" name when the endpoints are priced', () => {
    const paid = model('vendor/model:free', {
      endpoints: [endpoint({ pricing: { prompt: '0.0000002', completion: '0' } })],
    });
    expect(assessModel(paid, null)).toMatchObject({ eligible: false, freeEndpoints: 0 });
  });
});

describe('the capability and privacy filter', () => {
  it('requires image input and text-only output', () => {
    const textOnly = model('a/text', {
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    });
    const audio = model('a/music', {
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text', 'audio'] },
    });
    expect(assessModel(textOnly, null).reasons).toContain('no image input');
    expect(assessModel(audio, null).eligible).toBe(false);
  });

  it('refuses OpenRouter’s automatic routers outright', () => {
    expect(assessModel(model('openrouter/free'), null).eligible).toBe(false);
  });

  it('requires structured output, preferring an enforced schema', () => {
    const none = model('a/b', { endpoints: [endpoint({ supported_parameters: ['max_tokens'] })] });
    const jsonMode = model('a/b', {
      endpoints: [endpoint({ supported_parameters: ['response_format'] })],
    });
    expect(assessModel(none, null).eligible).toBe(false);
    expect(assessModel(jsonMode, null).output).toBe('json_object');
    expect(assessModel(model('a/b'), null).output).toBe('json_schema');
  });

  it('requires a zero-data-retention endpoint when privacy is required', () => {
    expect(assessModel(model('a/b'), new Set()).reasons).toContain(
      'no free endpoint offers zero data retention',
    );
    expect(assessModel(model('a/b'), ZDR).eligible).toBe(true);
  });

  it('ignores an endpoint that is down', () => {
    expect(
      assessModel(model('a/b', { endpoints: [endpoint({ status: -5 })] }), null).eligible,
    ).toBe(false);
  });
});

/* -- The reader, against a scripted OpenRouter ------------------------------ */

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

function openRouter(catalog: Record<string, ModelEndpoints>, replies: Reply[]) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ url: href, ...(body === undefined ? {} : { body }) });
    if (href.endsWith('/endpoints/zdr')) {
      const data = Object.values(catalog).flatMap((meta) =>
        meta.endpoints
          .filter((e) => ZDR.has(e.tag))
          .map((e) => ({ model_id: meta.id, tag: e.tag })),
      );
      return new Response(JSON.stringify({ data }));
    }
    const listed = /\/models\/(.+)\/endpoints$/.exec(href);
    if (listed !== null) {
      const meta = catalog[listed[1] ?? ''];
      return meta === undefined
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ data: meta }));
    }
    const reply = replies.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers ?? {},
    });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    chats: () => calls.filter((c) => c.url.endsWith('/chat/completions')),
  };
}

const ok = (content: string, cost = 0): Reply => ({
  status: 200,
  body: { model: 'x', usage: { cost }, choices: [{ message: { content } }] },
});
const signal = () => new AbortController().signal;

function reader(
  catalog: Record<string, ModelEndpoints>,
  replies: Reply[],
  models = ['free/one:free'],
  requireZdr = true,
  now = () => 1_000,
) {
  const or = openRouter(catalog, replies);
  const events: Record<string, unknown>[] = [];
  const read = createOpenRouterReader({
    apiKey: 'or-test-key-not-real',
    models,
    requireZdr,
    fetch: or.fetchImpl,
    log: (event) => events.push(event),
    now,
  });
  return { read, ...or, events };
}

describe('before a document is sent', () => {
  it('never calls a paid model, and fails closed', async () => {
    const paid = model('paid/one', {
      endpoints: [endpoint({ pricing: { prompt: '0.000003', completion: '0.000015' } })],
    });
    const { read, chats, events } = reader({ 'paid/one': paid }, [ok('{}')], ['paid/one']);
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'model_unavailable' });
    expect(chats()).toHaveLength(0);
    expect(events[0]).toMatchObject({ event: 'document_ai_model_refused', model: 'paid/one' });
  });

  it('checks the price again on every read, so a model that turned paid is refused', async () => {
    const catalog = { 'free/one:free': model('free/one:free') };
    const { read, chats } = reader(catalog, [ok('{}'), ok('{}')]);
    await read(PNG, signal());
    catalog['free/one:free'] = model('free/one:free', {
      endpoints: [endpoint({ pricing: { prompt: '0.0000001', completion: '0' } })],
    });
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'model_unavailable' });
    expect(chats()).toHaveLength(1);
  });

  it('refuses a model with no private endpoint when privacy is required', async () => {
    const shared = model('free/one:free', { endpoints: [endpoint({ tag: 'shared/host' })] });
    const { read, chats } = reader({ 'free/one:free': shared }, [ok('{}')]);
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'model_unavailable' });
    expect(chats()).toHaveLength(0);
  });

  it('never sends a PDF: the device renders it to an image first', async () => {
    const { read, calls } = reader({ 'free/one:free': model('free/one:free') }, []);
    await expect(
      read({ bytes: CARD_PNG, mimeType: 'application/pdf' }, signal()),
    ).rejects.toMatchObject({ failure: 'unsupported_type' });
    expect(calls).toHaveLength(0);
  });
});

describe('the request itself', () => {
  it('asks the router for $0 on every item, private routing, and no fallbacks or tools', async () => {
    const { read, chats } = reader({ 'free/one:free': model('free/one:free') }, [ok('{}')]);
    await read(PNG, signal());
    const body = chats()[0]?.body ?? {};
    expect(body.model).toBe('free/one:free');
    expect(body.provider).toEqual({
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      require_parameters: true,
      allow_fallbacks: false,
      zdr: true,
      data_collection: 'deny',
    });
    for (const capability of [
      'tools',
      'tool_choice',
      'plugins',
      'models',
      'route',
      'web_search_options',
    ]) {
      expect(body[capability]).toBeUndefined();
    }
    expect((body.response_format as { type: string }).type).toBe('json_schema');
  });

  it('keeps the document out of the trusted instruction: it travels only as an image', async () => {
    const { read, chats } = reader({ 'free/one:free': model('free/one:free') }, [ok('{}')]);
    await read(PNG, signal());
    const [system, user] = chats()[0]?.body?.messages as {
      role: string;
      content: unknown;
    }[];
    expect(system).toEqual({ role: 'system', content: EXTRACTION_INSTRUCTION });
    const parts = user?.content as { type: string; image_url?: { url: string } }[];
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(parts[1]?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('fallback', () => {
  it('goes to the secondary only when it too is verified free', async () => {
    const catalog = {
      'free/one:free': model('free/one:free', { endpoints: [endpoint({ status: -5 })] }),
      'free/two:free': model('free/two:free'),
    };
    const { read, chats } = reader(
      catalog,
      [ok('{"from":"two"}')],
      ['free/one:free', 'free/two:free'],
    );
    await expect(read(PNG, signal())).resolves.toBe('{"from":"two"}');
    expect(chats().map((c) => c.body?.model)).toEqual(['free/two:free']);
  });

  it('never falls back to a paid secondary', async () => {
    const catalog = {
      'free/one:free': model('free/one:free'),
      'paid/two': model('paid/two', {
        endpoints: [endpoint({ pricing: { prompt: '0.000001', completion: '0.000002' } })],
      }),
    };
    const { read, chats } = reader(
      catalog,
      [{ status: 503, body: { error: { message: 'down' } } }],
      ['free/one:free', 'paid/two'],
    );
    await expect(read(PNG, signal())).rejects.toThrow(/Document reading failed/);
    expect(chats().map((c) => c.body?.model)).toEqual(['free/one:free']);
  });
});

describe('provider trouble', () => {
  it('turns an unknown model into "unavailable" without sending the document', async () => {
    const { read, chats } = reader({}, []);
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'model_unavailable' });
    expect(chats()).toHaveLength(0);
  });

  it('reports a 503 as a service failure', async () => {
    const { read } = reader({ 'free/one:free': model('free/one:free') }, [
      { status: 503, body: { error: { message: 'Provider returned error' } } },
    ]);
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'service' });
  });

  it('stops at a 429 — no other model, and nothing sent again before the reset', async () => {
    let now = 1_000;
    const catalog = {
      'free/one:free': model('free/one:free'),
      'free/two:free': model('free/two:free'),
    };
    const { read, chats } = reader(
      catalog,
      [
        {
          status: 429,
          body: { error: { message: 'rate-limited upstream' } },
          headers: { 'x-ratelimit-reset': '61000' },
        },
        ok('{}'),
      ],
      ['free/one:free', 'free/two:free'],
      true,
      () => now,
    );
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'rate_limited' });
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'rate_limited' });
    expect(chats()).toHaveLength(1);
    now = 61_001;
    await expect(read(PNG, signal())).resolves.toBe('{}');
  });

  it('refuses a reply that reports any cost', async () => {
    const { read, events } = reader({ 'free/one:free': model('free/one:free') }, [
      ok('{}', 0.0001),
    ]);
    await expect(read(PNG, signal())).rejects.toMatchObject({ failure: 'non_zero_cost' });
    expect(events).toContainEqual(expect.objectContaining({ event: 'document_ai_nonzero_cost' }));
  });

  it('rejects malformed model output rather than repairing it', async () => {
    const { read } = reader({ 'free/one:free': model('free/one:free') }, [
      ok('Sure! Here is the JSON: {"documentType": "RESULT_CARD"'),
    ]);
    await expect(readDocument(CARD_PNG, read, 'free/one:free')).rejects.toMatchObject({
      failure: 'invalid_reply',
    });
  });

  it('keeps the key and the document out of diagnostic events', async () => {
    const { read, events } = reader({ 'free/one:free': model('free/one:free') }, [
      { status: 503, body: { error: { message: 'down' } } },
    ]);
    await read(PNG, signal()).catch(() => undefined);
    const logged = JSON.stringify(events);
    expect(logged).not.toContain('or-test-key-not-real');
    expect(logged).not.toContain(CARD_PNG.toString('base64').slice(0, 40));
  });
});

describe('configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
    NODE_ENV: 'test',
    OPENROUTER_API_KEY: 'or-test-key-not-real',
  };

  it('requires private routing unless told otherwise', () => {
    expect(loadConfig({ ...base, APP_ENV: 'test' }).DOCUMENT_AI_REQUIRE_ZDR).toBe(true);
  });

  it('refuses to start a deployed environment without private routing', () => {
    const env = {
      ...base,
      APP_ENV: 'staging',
      WEB_ORIGIN: 'https://app.example.test',
      DOCUMENT_AI_REQUIRE_ZDR: 'false',
    };
    expect(() => {
      assertSafeExposure(loadConfig(env), env);
    }).toThrow(/DOCUMENT_AI_REQUIRE_ZDR=false/);
  });
});
