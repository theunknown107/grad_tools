/**
 * Configuration, and the exposure guard.
 *
 * Authority: docs/13 §T-19 · docs/25 §25.4.1 · docs/48
 *
 * No database. The guard is a pure function of config plus environment, so
 * every refusal path is tested without starting a server.
 *
 * The guard used to refuse any public bind, because the announcement operator
 * writes were unauthenticated and the bind address was their only protection.
 * They now require OPERATOR_TOKEN (see announcements.test.ts), so a public
 * bind is allowed; what a deployed environment must get right instead is its
 * browser origin list.
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

  it('has no operator token unless one is configured', () => {
    expect(loadConfig(BASE).OPERATOR_TOKEN).toBeUndefined();
  });

  it('refuses an operator token too short to be generated', () => {
    expect(() => loadConfig({ ...BASE, OPERATOR_TOKEN: 'hunter2' })).toThrow(/OPERATOR_TOKEN/);
    expect(loadConfig({ ...BASE, OPERATOR_TOKEN: 'x'.repeat(32) }).OPERATOR_TOKEN).toHaveLength(32);
  });
});

describe('exposure guard', () => {
  const env = (extra: Record<string, string>) => ({ ...BASE, ...extra });

  /* Nothing unauthenticated remains, so the bind address is not the control. */
  it.each(['127.0.0.1', '0.0.0.0', '::', '10.0.0.4'])('allows binding %s', (host) => {
    const vars = env({ HOST: host });
    expect(() => {
      assertSafeExposure(loadConfig(vars), vars);
    }).not.toThrow();
  });

  it('leaves local development on its http default', () => {
    expect(() => {
      assertSafeExposure(loadConfig(BASE), BASE);
    }).not.toThrow();
  });

  it.each(['staging', 'alpha'])('requires %s to set WEB_ORIGIN explicitly', (appEnv) => {
    const vars = env({ APP_ENV: appEnv });
    expect(() => {
      assertSafeExposure(loadConfig(vars), vars);
    }).toThrow(/WEB_ORIGIN must be set explicitly/);
  });

  it('refuses a plain-http origin in a deployed environment', () => {
    const vars = env({
      APP_ENV: 'staging',
      WEB_ORIGIN: 'https://staging.example.test,http://x.test',
    });
    expect(() => {
      assertSafeExposure(loadConfig(vars), vars);
    }).toThrow(/https:\/\/.*http:\/\/x\.test/s);
  });

  it('accepts HTTPS origins, including the Android app at https://localhost', () => {
    const vars = env({
      APP_ENV: 'staging',
      HOST: '0.0.0.0',
      WEB_ORIGIN: 'https://staging.example.test,https://localhost',
    });
    expect(() => {
      assertSafeExposure(loadConfig(vars), vars);
    }).not.toThrow();
  });

  /*
   * With Clerk as the authority, authorizedParties must be set so the token's
   * `azp` is pinned (auth/clerk.ts); otherwise a token minted for another origin
   * on the same Clerk instance could be replayed. Placeholder keys only.
   */
  const CLERK = {
    CLERK_SECRET_KEY: 'sk_test_placeholder',
    CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
  };

  it('refuses a deployed Clerk env that does not pin its authorized parties', () => {
    const vars = env({ APP_ENV: 'staging', WEB_ORIGIN: 'https://staging.example.test', ...CLERK });
    expect(() => {
      assertSafeExposure(loadConfig(vars), vars);
    }).toThrow(/CLERK_AUTHORIZED_PARTIES/);
  });

  it('accepts a deployed Clerk env that pins its authorized parties', () => {
    const vars = env({
      APP_ENV: 'staging',
      WEB_ORIGIN: 'https://staging.example.test',
      ...CLERK,
      CLERK_AUTHORIZED_PARTIES: 'https://staging.example.test',
    });
    expect(() => {
      assertSafeExposure(loadConfig(vars), vars);
    }).not.toThrow();
  });

  it('does not require authorized parties when Clerk is not the authority', () => {
    const vars = env({ APP_ENV: 'staging', WEB_ORIGIN: 'https://staging.example.test' });
    expect(() => {
      assertSafeExposure(loadConfig(vars), vars);
    }).not.toThrow();
  });
});
