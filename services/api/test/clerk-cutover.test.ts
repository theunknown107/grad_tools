/**
 * CUTOVER PROOF: the whole Clerk → Postgres path, with NOTHING mocked.
 *
 *   Clerk session token (RS256, signed here with a throwaway key pair)
 *   → the real `clerkMiddleware()` (verifies it offline via CLERK_JWT_KEY)
 *   → `getAuth(req).userId` (clerkAuthenticator)
 *   → withUser: SET LOCAL role authenticated, request.jwt.claims = {"sub": …}
 *   → `auth.jwt() ->> 'sub'` in every RLS policy (Supabase 0012)
 *
 * The app is built by `createApp` FROM CONFIGURATION, exactly as production
 * builds it, so the authority selection itself is under test: with both Clerk
 * keys set, a valid legacy Supabase token is refused; without them, the same
 * token is accepted and a Clerk token is refused. There is no dual-auth state.
 *
 * The legacy Supabase token is real too: a local JWKS endpoint stands in for
 * the project's, so the legacy verifier runs unmodified.
 *
 * SYNTHETIC KEYS AND SUBJECTS ONLY. No network beyond 127.0.0.1.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Sql } from '../src/db/client.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb =
  DATABASE_URL === undefined || CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined
    ? describe.skip
    : describe;

const A = 'user_2synthCutoverStudentA';
const B = 'user_2synthCutoverStudentB';
const LEGACY = 'aaaaaaaa-7777-4000-8000-00000000000a';
const WEB = 'http://localhost:5173';
const PUBLISHABLE = `pk_test_${Buffer.from('synthetic.clerk.accounts.dev$').toString('base64')}`;

/* Clerk's key pair. The PUBLIC half becomes CLERK_JWT_KEY before Clerk's SDK reads the env. */
const clerkKeys = await generateKeyPair('RS256', { extractable: true });
process.env.CLERK_JWT_KEY = await exportSPKI(clerkKeys.publicKey);
const strangerKeys = await generateKeyPair('RS256');

const { createApp } = await import('../src/http/app.js');
const { loadConfig } = await import('../src/config.js');
const { createLogger } = await import('../src/observability/logger.js');

async function clerkToken(
  sub: string,
  {
    azp = WEB,
    key = clerkKeys.privateKey,
    expiresIn = '5m',
  }: { azp?: string; key?: CryptoKey; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({ azp, sid: `sess_${sub}` })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'ins_synthetic' })
    .setSubject(sub)
    .setIssuer('https://synthetic.clerk.accounts.dev')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 5)
    .setNotBefore(Math.floor(Date.now() / 1000) - 5)
    .setExpirationTime(expiresIn)
    .sign(key);
}

describeDb('Clerk cutover: session → API → Postgres RLS, unmocked', () => {
  let sql: Sql;
  let admin: Sql;
  let jwks: Server;
  let supabaseUrl: string;
  let supabaseKey: CryptoKey;
  let clerkApp: Express;
  let legacyApp: Express;
  const clients: Sql[] = [];

  const supabaseToken = (sub: string) =>
    new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'synthetic-supabase' })
      .setSubject(sub)
      .setIssuer(`${supabaseUrl}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(supabaseKey);

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    supabaseKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'synthetic-supabase', alg: 'ES256' };
    jwks = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    supabaseUrl = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}`;

    sql = postgres(DATABASE_URL as string, { max: 2 }) as unknown as Sql;
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;

    const base = {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      DATABASE_URL: DATABASE_URL as string,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_DB_URL: CLOUD_URL as string,
    };
    const build = (env: NodeJS.ProcessEnv) => {
      const app = createApp(loadConfig(env), sql, createLogger('silent', false));
      clients.push(app.locals.cloudSql as Sql);
      return app;
    };
    clerkApp = build({
      ...base,
      CLERK_SECRET_KEY: 'sk_test_synthetic',
      CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
      CLERK_AUTHORIZED_PARTIES: WEB,
    });
    legacyApp = build(base);
  }, 60_000);

  afterAll(async () => {
    await admin`DELETE FROM accounts WHERE id IN (${A}, ${B}, ${LEGACY})`;
    await Promise.all([sql.end(), admin.end(), ...clients.map((client) => client.end())]);
    await new Promise((resolve) => jwks.close(resolve));
  });

  beforeEach(async () => {
    await admin`DELETE FROM accounts WHERE id IN (${A}, ${B}, ${LEGACY})`;
  });

  const as = async (sub: string) => `Bearer ${await clerkToken(sub)}`;
  const putProfile = async (sub: string, body: object) =>
    request(clerkApp)
      .put('/api/v1/me/profile')
      .set('Authorization', await as(sub))
      .send({ schemeId: 'vtu-2022', ...body });

  describe('identity reaches Postgres as the verified Clerk subject', () => {
    it('a request becomes the database subject `auth.jwt() ->> sub`', async () => {
      const res = await putProfile(A, { displayName: 'Synthetic A', currentSemester: 5 });
      expect(res.status).toBe(200);
      const [row] = await admin<{ auth_user_id: string }[]>`
        SELECT auth_user_id FROM student_profiles WHERE auth_user_id = ${A}`;
      expect(row?.auth_user_id).toBe(A);
      const [account] = await admin<{ id: string }[]>`SELECT id FROM accounts WHERE id = ${A}`;
      expect(account?.id).toBe(A);
    });

    it('A sees A, B sees B, and neither sees the other', async () => {
      await putProfile(A, { displayName: 'Synthetic A' });
      await putProfile(B, { displayName: 'Synthetic B' });

      const a = await request(clerkApp)
        .get('/api/v1/me')
        .set('Authorization', await as(A));
      const b = await request(clerkApp)
        .get('/api/v1/me')
        .set('Authorization', await as(B));
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.body.identity.userId).toBe(A);
      expect(a.body.profile.displayName).toBe('Synthetic A');
      expect(b.body.identity.userId).toBe(B);
      expect(b.body.profile.displayName).toBe('Synthetic B');

      const aExport = await request(clerkApp)
        .get('/api/v1/me/export')
        .set('Authorization', await as(A));
      expect(JSON.stringify(aExport.body)).not.toContain('Synthetic B');
      const bExport = await request(clerkApp)
        .get('/api/v1/me/export')
        .set('Authorization', await as(B));
      expect(JSON.stringify(bExport.body)).not.toContain('Synthetic A');
    });

    it('a userId in the body changes nothing: the row is the caller’s', async () => {
      await putProfile(B, { displayName: 'Synthetic B' });
      const res = await putProfile(A, {
        displayName: 'Synthetic A',
        userId: B,
        auth_user_id: B,
        sub: B,
      });
      expect(res.status).toBe(200);
      const owners = await admin<{ auth_user_id: string; display_name: string }[]>`
        SELECT auth_user_id, display_name FROM student_profiles
         WHERE auth_user_id IN (${A}, ${B}) ORDER BY auth_user_id`;
      expect(owners).toEqual([
        { auth_user_id: A, display_name: 'Synthetic A' },
        { auth_user_id: B, display_name: 'Synthetic B' },
      ]);
    });
  });

  describe('what Clerk verification refuses (401, and nothing reaches the database)', () => {
    it.each([
      ['no token', async () => undefined],
      [
        'a token signed by another key',
        async () => clerkToken(A, { key: strangerKeys.privateKey }),
      ],
      [
        'a token minted for another site',
        async () => clerkToken(A, { azp: 'https://evil.example' }),
      ],
      ['an expired token', async () => clerkToken(A, { expiresIn: '-1m' })],
      ['garbage', async () => 'not-a-jwt'],
    ])('%s', async (_label, token) => {
      const value = await token();
      const req = request(clerkApp).get('/api/v1/me');
      const res = await (value === undefined ? req : req.set('Authorization', `Bearer ${value}`));
      expect(res.status).toBe(401);
      expect(await admin`SELECT id FROM accounts WHERE id = ${A}`).toEqual([]);
    });
  });

  describe('exactly one authority per deployment', () => {
    it('the legacy build accepts a valid Supabase session (the token is genuinely valid)', async () => {
      const res = await request(legacyApp)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${await supabaseToken(LEGACY)}`);
      expect(res.status).toBe(200);
      expect(res.body.identity.userId).toBe(LEGACY);
    });

    it('with both Clerk keys set, that same Supabase session is refused', async () => {
      const res = await request(clerkApp)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${await supabaseToken(LEGACY)}`);
      expect(res.status).toBe(401);
    });

    it('and the legacy build refuses a Clerk session', async () => {
      const res = await request(legacyApp)
        .get('/api/v1/me')
        .set('Authorization', await as(A));
      expect(res.status).toBe(401);
    });
  });
});
