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

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { assertSafeExposure, loadConfig } from '../src/config.js';
import { createClient } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';

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

/*
 * THE APP_ENV MATRIX (docs/25 §25.10, app-env audit 2026-11-27).
 *
 * APP_ENV is read in exactly two places: the exposure guard (staging and alpha
 * only) and the startup log line. `alpha` is the release environment; there is
 * no `production` value. Placeholder keys only.
 */
describe('APP_ENV', () => {
  const env = (extra: Record<string, string>) => ({ ...BASE, ...extra });
  const DEPLOYED = {
    WEB_ORIGIN: 'https://app.example.test,https://localhost',
    /* Placeholders shaped like a production instance's keys; not real keys. */
    CLERK_SECRET_KEY: 'sk_live_placeholder',
    CLERK_PUBLISHABLE_KEY: 'pk_live_placeholder',
    CLERK_AUTHORIZED_PARTIES: 'https://app.example.test,https://localhost',
  };
  const guard = (vars: Record<string, string>) => () => {
    assertSafeExposure(loadConfig(vars), vars);
  };

  it('defaults to local when unset outside production, and the guard stays off', () => {
    expect(loadConfig(BASE).APP_ENV).toBe('local');
    expect(guard(env({ WEB_ORIGIN: 'http://localhost:5173' }))).not.toThrow();
  });

  it('refuses a production build that does not say which environment it is', () => {
    expect(() => loadConfig(env({ NODE_ENV: 'production', ...DEPLOYED }))).toThrow(
      /NODE_ENV=production requires APP_ENV=alpha .* got local \(unset\)/,
    );
  });

  it.each(['local', 'test', 'experimental'])(
    'refuses a production build set to %s (e.g. copied from .env.example)',
    (value) => {
      expect(() =>
        loadConfig(env({ NODE_ENV: 'production', APP_ENV: value, ...DEPLOYED })),
      ).toThrow(new RegExp(`NODE_ENV=production requires APP_ENV=alpha .* got ${value}\\.`));
    },
  );

  it('alpha refuses Clerk development keys; staging accepts them', () => {
    const devKeys = {
      ...DEPLOYED,
      CLERK_SECRET_KEY: 'sk_test_placeholder',
      CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
    };
    expect(guard(env({ NODE_ENV: 'production', APP_ENV: 'alpha', ...devKeys }))).toThrow(
      /alpha must use a Clerk production instance/,
    );
    expect(guard(env({ NODE_ENV: 'production', APP_ENV: 'staging', ...devKeys }))).not.toThrow();
  });

  it.each(['production', 'prod', 'PRODUCTION', '', 'Alpha'])(
    'refuses the unsupported value %j at load',
    (value) => {
      expect(() => loadConfig(env({ APP_ENV: value }))).toThrow(/APP_ENV/);
    },
  );

  it.each(['local', 'test', 'experimental'])('%s does not run the deployed guard', (value) => {
    expect(guard(env({ APP_ENV: value, WEB_ORIGIN: 'http://localhost:5173' }))).not.toThrow();
  });

  it.each(['staging', 'alpha'])(
    '%s starts with a complete, https, pinned configuration',
    (value) => {
      expect(guard(env({ NODE_ENV: 'production', APP_ENV: value, ...DEPLOYED }))).not.toThrow();
    },
  );

  describe.each(['staging', 'alpha'])('%s refuses', (value) => {
    const base = { NODE_ENV: 'production', APP_ENV: value, ...DEPLOYED };

    it('a missing authorized-parties list', () => {
      const { CLERK_AUTHORIZED_PARTIES: _omit, ...vars } = base;
      expect(guard(env(vars))).toThrow(/CLERK_AUTHORIZED_PARTIES must list/);
    });

    it.each(['', ' , ,'])('an empty authorized-parties list (%j)', (parties) => {
      expect(guard(env({ ...base, CLERK_AUTHORIZED_PARTIES: parties }))).toThrow(
        /CLERK_AUTHORIZED_PARTIES must list/,
      );
    });

    it('a plain-http authorized party', () => {
      expect(
        guard(
          env({ ...base, CLERK_AUTHORIZED_PARTIES: 'https://app.example.test,http://evil.test' }),
        ),
      ).toThrow(/CLERK_AUTHORIZED_PARTIES origin must use https:\/\/.*http:\/\/evil\.test/);
    });

    it('a plain-http web origin', () => {
      expect(guard(env({ ...base, WEB_ORIGIN: 'http://app.example.test' }))).toThrow(/https:\/\//);
    });

    it('document AI without zero data retention', () => {
      expect(guard(env({ ...base, DOCUMENT_AI_REQUIRE_ZDR: 'false' }))).toThrow(/ZDR/);
    });
  });

  it('refuses half a Clerk configuration in any environment, production included', () => {
    expect(() =>
      loadConfig(
        env({ NODE_ENV: 'production', APP_ENV: 'alpha', CLERK_SECRET_KEY: 'sk_test_placeholder' }),
      ),
    ).toThrow(/CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY must be set together/);
  });

  it('alpha changes nothing but the guard: the parsed config is otherwise the same as staging', () => {
    const alpha = loadConfig(env({ NODE_ENV: 'production', APP_ENV: 'alpha', ...DEPLOYED }));
    const staging = loadConfig(env({ NODE_ENV: 'production', APP_ENV: 'staging', ...DEPLOYED }));
    expect({ ...alpha, APP_ENV: 'x' }).toEqual({ ...staging, APP_ENV: 'x' });
  });
});

describe('CORS in a deployed configuration', () => {
  const config = loadConfig({
    ...BASE,
    NODE_ENV: 'test',
    APP_ENV: 'alpha',
    WEB_ORIGIN: 'https://app.example.test,https://localhost',
  });
  /* A lazy client: a preflight never reaches the database. */
  const app = createApp(config, createClient(BASE.DATABASE_URL), createLogger('silent', false));

  it.each(['https://app.example.test', 'https://localhost'])('allows %s', async (origin) => {
    const res = await request(app)
      .options('/api/v1/universities')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it.each(['https://evil.test', 'http://app.example.test', 'https://app.example.test.evil.test'])(
    'gives %s no CORS grant',
    async (origin) => {
      const res = await request(app)
        .options('/api/v1/universities')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    },
  );
});
