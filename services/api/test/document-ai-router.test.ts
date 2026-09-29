/**
 * The document-AI provider router: candidate ordering, capability filtering,
 * bounded fallback, failure classification, and the per-provider circuit
 * breaker — all with mocked readers, no live providers.
 *
 * The two seam refinements are pinned explicitly: an invalid schema reply from
 * one provider falls through to the next (the router validates via the shared
 * validator), and a 429's reset time is honoured across requests.
 */
import { describe, expect, it, vi } from 'vitest';
import { DocumentReaderError, type DocumentReader } from '../src/documents/gemini.js';
import { createProviderRouter, type Provider } from '../src/documents/router.js';

const DOC = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/png' as const };
const signal = () => new AbortController().signal;

/* A schema-valid AiExtraction and some unusable replies. */
const VALID = JSON.stringify({
  documentType: 'OTHER',
  headerText: null,
  resultCard: null,
  timetable: null,
});
const SCHEMA_INVALID = JSON.stringify({ documentType: 'NOPE', extra: 1 });
const NON_JSON = 'Sure! here you go';

const ok = (reply: string): DocumentReader => vi.fn(async () => reply);
const fail = (failure: DocumentReaderError['failure'], retryAt?: number): DocumentReader =>
  vi.fn(async () => {
    throw new DocumentReaderError(failure, retryAt);
  });

let seq = 0;
const provider = (over: Partial<Provider> & Pick<Provider, 'reader'>): Provider => ({
  id: `p${(seq += 1)}`,
  model: 'm',
  capabilities: { image: true, structuredOutput: true },
  policy: { zeroCost: 'verified-per-read', enabled: true },
  priority: seq,
  ...over,
});

describe('candidate selection', () => {
  it('uses the healthy primary and does not touch the secondary', async () => {
    const b = provider({ reader: ok(VALID), priority: 2 });
    const a = provider({ reader: ok(VALID), priority: 1 });
    const route = createProviderRouter([b, a]);
    expect(await route(DOC, signal())).toBe(VALID);
    expect(a.reader).toHaveBeenCalledTimes(1);
    expect(b.reader).not.toHaveBeenCalled();
  });

  it('never selects a text-only (no-image) provider', async () => {
    const textOnly = provider({
      reader: ok(VALID),
      priority: 1,
      capabilities: { image: false, structuredOutput: true },
    });
    const img = provider({ reader: ok(VALID), priority: 2 });
    await createProviderRouter([textOnly, img])(DOC, signal());
    expect(textOnly.reader).not.toHaveBeenCalled();
    expect(img.reader).toHaveBeenCalledTimes(1);
  });

  it('skips a disabled provider', async () => {
    const off = provider({
      reader: ok(VALID),
      priority: 1,
      policy: { zeroCost: 'verified-per-read', enabled: false },
    });
    const on = provider({ reader: ok(VALID), priority: 2 });
    await createProviderRouter([off, on])(DOC, signal());
    expect(off.reader).not.toHaveBeenCalled();
    expect(on.reader).toHaveBeenCalledTimes(1);
  });

  it('caps at three provider attempts', async () => {
    const ps = [1, 2, 3, 4].map((p) => provider({ reader: fail('service'), priority: p }));
    await expect(createProviderRouter(ps)(DOC, signal())).rejects.toBeInstanceOf(
      DocumentReaderError,
    );
    const called = ps.filter((p) => (p.reader as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(called).toHaveLength(3);
  });
});

describe('fallback and failure classification', () => {
  it('falls through a schema-invalid reply to the next provider (refinement 1)', async () => {
    const a = provider({ reader: ok(SCHEMA_INVALID), priority: 1 });
    const b = provider({ reader: ok(VALID), priority: 2 });
    expect(await createProviderRouter([a, b])(DOC, signal())).toBe(VALID);
    expect(a.reader).toHaveBeenCalledTimes(1);
    expect(b.reader).toHaveBeenCalledTimes(1);
  });

  it('falls through a malformed (non-JSON) reply (refinement 3)', async () => {
    const a = provider({ reader: ok(NON_JSON), priority: 1 });
    const b = provider({ reader: ok(VALID), priority: 2 });
    expect(await createProviderRouter([a, b])(DOC, signal())).toBe(VALID);
  });

  it('quarantines a non-zero-cost provider and does not retry it in the same request (refinement 4)', async () => {
    const a = provider({ reader: fail('non_zero_cost'), priority: 1 });
    const b = provider({ reader: ok(VALID), priority: 2 });
    let clock = 1_000;
    const route = createProviderRouter([a, b], { now: () => clock });
    expect(await route(DOC, signal())).toBe(VALID);
    expect(a.reader).toHaveBeenCalledTimes(1);
    // Still quarantined a day later.
    clock += 60 * 60 * 1000;
    await route(DOC, signal());
    expect(a.reader).toHaveBeenCalledTimes(1); // never retried
  });

  it('stops on an unsupported document — no fallback (refinement 5)', async () => {
    const a = provider({ reader: fail('unsupported_type'), priority: 1 });
    const b = provider({ reader: ok(VALID), priority: 2 });
    await expect(createProviderRouter([a, b])(DOC, signal())).rejects.toMatchObject({
      failure: 'unsupported_type',
    });
    expect(b.reader).not.toHaveBeenCalled();
  });

  it('throws when every approved provider fails, for the offline fallback (refinement 6)', async () => {
    const a = provider({ reader: fail('service'), priority: 1 });
    const b = provider({ reader: fail('timeout'), priority: 2 });
    await expect(createProviderRouter([a, b])(DOC, signal())).rejects.toBeInstanceOf(
      DocumentReaderError,
    );
  });
});

describe('rate-limit cooldown (refinement 2)', () => {
  it('honours the reset time and skips the provider on the next request', async () => {
    let clock = 1_000;
    const a = provider({ reader: fail('rate_limited', 50_000), priority: 1 });
    const b = provider({ reader: ok(VALID), priority: 2 });
    const route = createProviderRouter([a, b], { now: () => clock });

    expect(await route(DOC, signal())).toBe(VALID); // A 429 -> B
    expect(a.reader).toHaveBeenCalledTimes(1);

    // Still before the reset: A is skipped entirely, B serves again.
    clock = 40_000;
    expect(await route(DOC, signal())).toBe(VALID);
    expect(a.reader).toHaveBeenCalledTimes(1); // not retried during cooldown

    // After the reset: A is tried again.
    clock = 60_000;
    expect(await route(DOC, signal())).toBe(VALID);
    expect(a.reader).toHaveBeenCalledTimes(2);
  });
});

describe('cancellation and safe diagnostics', () => {
  it('stops the fallback chain when the request is aborted', async () => {
    const controller = new AbortController();
    const a = provider({
      reader: vi.fn(async () => {
        controller.abort();
        throw new DocumentReaderError('service');
      }),
      priority: 1,
    });
    const b = provider({ reader: ok(VALID), priority: 2 });
    await expect(createProviderRouter([a, b])(DOC, controller.signal)).rejects.toMatchObject({
      failure: 'timeout',
    });
    expect(b.reader).not.toHaveBeenCalled();
  });

  it('never puts credentials or document content in diagnostics (refinement 7)', async () => {
    const events: Record<string, unknown>[] = [];
    const a = provider({ reader: fail('rate_limited', 9_999), priority: 1 });
    const b = provider({ reader: ok(VALID), priority: 2 });
    await createProviderRouter([a, b], { log: (e) => events.push(e) })(DOC, signal());
    const dump = JSON.stringify(events);
    expect(dump).not.toMatch(/bytes|apiKey|authorization|password|prompt|ÿØ/i);
    // Only these safe keys ever appear.
    const keys = new Set(events.flatMap((e) => Object.keys(e)));
    for (const k of keys) {
      expect([
        'event',
        'provider',
        'model',
        'attempt',
        'failure',
        'cooldownMs',
        'reason',
      ]).toContain(k);
    }
  });
});

describe('zero-cost eligibility (Gemini hardening)', () => {
  it('never selects a flag-asserted (deployment-approved) provider, even alone', async () => {
    // What a boolean GEMINI_ZERO_COST_APPROVED flag would have produced.
    const gemini = provider({
      reader: ok(VALID),
      priority: 1,
      policy: { zeroCost: 'deployment-approved', enabled: true },
    });
    await expect(createProviderRouter([gemini])(DOC, signal())).rejects.toBeInstanceOf(
      DocumentReaderError,
    );
    expect(gemini.reader).not.toHaveBeenCalled(); // filtered out before any call → offline
  });

  it('prefers the $0-proven provider and ignores the flag-asserted one entirely', async () => {
    const gemini = provider({
      reader: ok(VALID),
      priority: 1, // higher priority, but ineligible
      policy: { zeroCost: 'deployment-approved', enabled: true },
    });
    const openrouter = provider({ reader: ok(VALID), priority: 2 }); // verified-per-read
    expect(await createProviderRouter([gemini, openrouter])(DOC, signal())).toBe(VALID);
    expect(gemini.reader).not.toHaveBeenCalled();
    expect(openrouter.reader).toHaveBeenCalledTimes(1);
  });

  it('routes only $0-proven (verified-per-read) providers', async () => {
    const verified = provider({ reader: ok(VALID) });
    expect(await createProviderRouter([verified])(DOC, signal())).toBe(VALID);
    expect(verified.reader).toHaveBeenCalledTimes(1);
  });
});

describe('no environment flag grants Gemini zero-cost', () => {
  it('loadConfig exposes no GEMINI_ZERO_COST_APPROVED flag', async () => {
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig({
      DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
      NODE_ENV: 'test',
      APP_ENV: 'test',
      GEMINI_API_KEY: 'test-key-not-real',
      GEMINI_ZERO_COST_APPROVED: 'true', // ignored: no such setting exists
    });
    expect((config as Record<string, unknown>).GEMINI_ZERO_COST_APPROVED).toBeUndefined();
  });
});
