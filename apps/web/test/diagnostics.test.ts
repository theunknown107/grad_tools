/**
 * The auth diagnostic's pure helpers (DIAGNOSTIC build only). These classify
 * configuration and sanitize probe results; they must never leak a whole key.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  analyzeApiUrl,
  classifyPublishableKey,
  classifyStatus,
  runProbe,
} from '../src/features/diagnostics/diagnostics.js';

/*
 * REGRESSION (the on-device "Unreachable" probes). The staging API answered
 * every request with a 401, but sent no Access-Control-Allow-Origin for the
 * Capacitor origin, so `fetch` rejected and the panel blamed the network. A
 * probe must tell a CORS refusal from a dead network from a timeout.
 */
describe('runProbe says why a probe failed', () => {
  const URL = 'https://api.example.test/api/v1/me';
  const reply = (status: number) => async () => new Response(null, { status });

  it.each([
    [200, 'ok'],
    [401, 'unauthorized'], // reachable; unauthenticated
    [403, 'forbidden'],
    [503, 'server-error'],
  ])('a readable %i is %s', async (status, kind) => {
    expect((await runProbe(reply(status), URL)).kind).toBe(kind);
  });

  it('no session token is no-token, not a network failure', async () => {
    expect((await runProbe(async () => null, URL)).kind).toBe('no-token');
  });

  it('a rejected fetch whose server still answers an opaque request is CORS', async () => {
    const opaque = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await runProbe(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      URL,
      opaque,
    );
    expect(result.kind).toBe('cors');
    expect(opaque).toHaveBeenCalledWith(URL, expect.objectContaining({ mode: 'no-cors' }));
  });

  it('a rejected fetch with no answer at all is a network failure', async () => {
    const result = await runProbe(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      URL,
      async () => {
        throw new TypeError('Failed to fetch');
      },
    );
    expect(result.kind).toBe('network');
  });

  it('a timeout is reported as a timeout', async () => {
    const result = await runProbe(async () => {
      throw new DOMException('signal timed out', 'TimeoutError');
    }, URL);
    expect(result.kind).toBe('timeout');
  });
});

describe('classifyPublishableKey', () => {
  it('reports an absent key', () => {
    const r = classifyPublishableKey(null);
    expect(r).toMatchObject({ present: false, validFormat: false, category: 'unknown' });
    expect(r.masked).toBe('—');
  });

  it('classifies a test key and never reveals the whole of it', () => {
    const key = 'pk_test_' + 'A'.repeat(40) + 'WXYZ';
    const r = classifyPublishableKey(key);
    expect(r).toMatchObject({ present: true, validFormat: true, category: 'test' });
    expect(r.masked).toBe('pk_test_…WXYZ');
    expect(r.masked).not.toContain('AAAA'); // the body is hidden
    expect(key).not.toBe(r.masked);
  });

  it('classifies a live key', () => {
    expect(classifyPublishableKey('pk_live_' + 'z'.repeat(30)).category).toBe('live');
  });

  it('flags a malformed key as present-but-invalid', () => {
    const r = classifyPublishableKey('not-a-key');
    expect(r).toMatchObject({ present: true, validFormat: false, category: 'unknown' });
  });
});

describe('analyzeApiUrl', () => {
  it('spots the localhost fallback (fatal on a phone)', () => {
    const r = analyzeApiUrl({
      effective: 'http://localhost:3001',
      configuredRaw: undefined,
      origin: 'https://localhost',
    });
    expect(r).toMatchObject({ configured: false, https: false, localhostFallback: true });
  });

  it('accepts a configured https API', () => {
    const r = analyzeApiUrl({
      effective: 'https://api.example.test',
      configuredRaw: 'https://api.example.test',
      origin: 'https://localhost',
    });
    expect(r).toMatchObject({ configured: true, https: true, localhostFallback: false });
  });

  it('treats an own-origin build as same-origin, https from the origin', () => {
    const r = analyzeApiUrl({
      effective: '',
      configuredRaw: undefined,
      origin: 'https://app.example',
    });
    expect(r).toMatchObject({ sameOrigin: true, https: true, localhostFallback: false });
    expect(r.effective).toContain('own origin');
  });
});

describe('classifyStatus', () => {
  it.each([
    [200, 'ok'],
    [204, 'ok'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'server-error'],
  ])('maps %i to %s', (status, kind) => {
    expect(classifyStatus(status).kind).toBe(kind);
  });
});
