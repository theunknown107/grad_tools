/**
 * Rate limiting (F1): baseline `/api/v1` limiter and the stricter document
 * limiter, exercised through a minimal Express app with the real error handler.
 *
 * No timers are faked and no wall-clock waiting is needed: every assertion is
 * about counting within a single window, which is deterministic.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiLimiter, createDocumentLimiter } from '../src/http/rate-limit.js';
import { errorHandler } from '../src/http/errors.js';

/** A tiny app that mounts a limiter on /api/v1 and a dummy route behind it. */
function appWith(limit: number) {
  const app = express();
  app.set('trust proxy', 1); // mirror production so X-Forwarded-For sets req.ip
  app.use('/api/v1', createApiLimiter({ limit }));
  app.get('/api/v1/universities', (_req, res) => res.json({ data: [] }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' })); // not under /api/v1
  app.use(errorHandler);
  return app;
}

const ip = (app: express.Express, addr: string) =>
  request(app).get('/api/v1/universities').set('X-Forwarded-For', addr);

describe('baseline /api/v1 limiter', () => {
  it('allows requests under the limit', async () => {
    const app = appWith(3);
    for (let i = 0; i < 3; i++) {
      const res = await ip(app, '203.0.113.1');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 with code RATE_LIMITED once the limit is exceeded', async () => {
    const app = appWith(2);
    await ip(app, '203.0.113.2');
    await ip(app, '203.0.113.2');
    const res = await ip(app, '203.0.113.2');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(typeof res.body.error.reference).toBe('string'); // shared error shape
  });

  it('sets Retry-After on a 429', async () => {
    const app = appWith(1);
    await ip(app, '203.0.113.3');
    const res = await ip(app, '203.0.113.3');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keys per IP: independent clients do not share a bucket', async () => {
    const app = appWith(1);
    expect((await ip(app, '198.51.100.1')).status).toBe(200); // client A uses its one
    expect((await ip(app, '198.51.100.1')).status).toBe(429); // A exhausted
    expect((await ip(app, '198.51.100.2')).status).toBe(200); // B unaffected
  });

  it('never throttles /health', async () => {
    const app = appWith(1);
    await request(app).get('/health'); // would exceed a limit of 1 if counted
    await request(app).get('/health');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('does not echo credentials, bodies, or tokens in the 429 response', async () => {
    const app = appWith(1);
    await ip(app, '203.0.113.9');
    const res = await request(app)
      .get('/api/v1/universities')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('Authorization', 'Bearer super-secret-token-value')
      .set('Cookie', 'session=secret');
    expect(res.status).toBe(429);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toMatch(/super-secret-token-value|Bearer|session=secret/);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('document-AI limiter is materially stricter', () => {
  it('trips at its own lower limit, independently of the baseline', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use('/api/v1', createApiLimiter({ limit: 100 }));
    app.post('/api/v1/me/documents/extract', createDocumentLimiter({ limit: 2 }), (_req, res) =>
      res.json({ ok: true }),
    );
    app.use(errorHandler);
    const hit = () =>
      request(app).post('/api/v1/me/documents/extract').set('X-Forwarded-For', '203.0.113.20');
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const third = await hit();
    expect(third.status).toBe(429); // stricter doc limit trips long before the 100 baseline
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});
