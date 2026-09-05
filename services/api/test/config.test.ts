/**
 * Configuration, and the exposure guard.
 *
 * Authority: docs/13 §T-19 · docs/25 §25.4.1 · M5A §6
 *
 * No database. The guard is a pure function of config plus environment, which
 * is what lets every refusal path be tested without starting a server — and
 * this is a control that must be proven rather than assumed, because the cost
 * of it being wrong is an anonymous document service on the network.
 */

import { describe, expect, it } from 'vitest';
import { assertSafeExposure, loadConfig } from '../src/config.js';

const BASE = { DATABASE_URL: 'postgres://u@localhost:5432/db' };

describe('configuration', () => {
  it('defaults HOST to loopback', () => {
    expect(loadConfig(BASE).HOST).toBe('127.0.0.1');
  });

  it('refuses to start without a database url', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe('exposure guard', () => {
  const config = (host: string) => loadConfig({ ...BASE, HOST: host });

  it.each(['127.0.0.1', '127.0.0.53', 'localhost', '::1', '[::1]'])(
    'allows the loopback address %s',
    (host) => {
      expect(() => {
        assertSafeExposure(config(host), {});
      }).not.toThrow();
    },
  );

  /*
   * The case this guard exists for. Stage 1 private document routes are
   * unauthenticated by design, so a wildcard bind publishes an anonymous
   * read-and-write document service.
   */
  it.each(['0.0.0.0', '::', '192.168.1.50', '10.0.0.4'])(
    'refuses to start on the public address %s',
    (host) => {
      expect(() => {
        assertSafeExposure(config(host), {});
      }).toThrow(/unauthenticated private document routes/);
    },
  );

  it('explains what to do instead of only refusing', () => {
    try {
      assertSafeExposure(config('0.0.0.0'), {});
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('HOST=127.0.0.1');
      expect(message).toContain('ALLOW_PUBLIC_BIND');
      // Says why CORS is not the answer, because that is the assumption a
      // reader is most likely to arrive with.
      expect(message).toContain('CORS');
    }
  });

  it('allows a public bind only when it is opted into deliberately', () => {
    expect(() => {
      assertSafeExposure(config('0.0.0.0'), { ALLOW_PUBLIC_BIND: 'true' });
    }).not.toThrow();
  });

  it.each(['false', '1', 'yes', 'TRUE', ''])('does not accept %s as an opt-in', (value) => {
    expect(() => {
      assertSafeExposure(config('0.0.0.0'), { ALLOW_PUBLIC_BIND: value });
    }).toThrow();
  });
});
