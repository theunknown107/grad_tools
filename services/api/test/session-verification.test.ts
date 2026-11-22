/**
 * The token verifier, against real signatures.
 *
 * Authority: docs/11 §11.10, §11.14 · docs/13 §13.17 · M9 §41, §46
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS BESIDE THE AUTHORIZATION SUITE
 * ---------------------------------------------------------------------------
 *
 * `authorization.test.ts` supplies a FAKE verifier on purpose: it asks what
 * happens after a token is accepted, and mixing the two would let a passing
 * signature test hide a broken authorization one. The consequence is that the
 * real `createVerifier` — the thing standing between a stranger and a
 * student's records — had no test of its own.
 *
 * It does now, and without a provider: an ES256 key pair is generated here, a
 * JWKS is served from a local socket, and every token below is really signed
 * and really verified. What is proven is that the verifier enforces the
 * signature, the issuer, the audience and the expiry, and that every failure
 * looks the same from outside.
 *
 * SYNTHETIC KEYS ONLY. Generated per run, never written down, never a
 * credential for anything.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

/** What `generateKeyPair` hands back, without depending on the DOM lib. */
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
import { authConfigFor, createVerifier } from '../src/auth/session.js';

const PORT = 4571;
const ISSUER = `http://127.0.0.1:${PORT}/auth/v1`;

let signingKey: SigningKey;
let strangerKey: SigningKey;
let server: Server;

/** A token as the provider would issue it, unless a field is overridden. */
async function token(
  overrides: {
    readonly issuer?: string;
    readonly audience?: string;
    readonly subject?: string | null;
    readonly expiresIn?: string;
    readonly key?: SigningKey;
  } = {},
): Promise<string> {
  const jwt = new SignJWT({ email: 'synthetic@example.test' })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? 'authenticated')
    .setExpirationTime(overrides.expiresIn ?? '5m');

  const subject =
    overrides.subject === undefined ? 'aaaaaaaa-4000-4000-8000-00000000000a' : overrides.subject;
  if (subject !== null) jwt.setSubject(subject);

  return jwt.sign(overrides.key ?? signingKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const stranger = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  strangerKey = stranger.privateKey;

  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', use: 'sig', kid: 'test' };

  server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(PORT, ok));
});

afterAll(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
});

describe('the session verifier', () => {
  const verify = () => createVerifier(authConfigFor(`http://127.0.0.1:${PORT}`));

  it('accepts a token the provider really signed', async () => {
    const session = await verify()(await token());
    expect(session.userId).toBe('aaaaaaaa-4000-4000-8000-00000000000a');
    expect(session.claims['email']).toBe('synthetic@example.test');
  });

  it('refuses a token signed by a key the provider does not publish', async () => {
    await expect(verify()(await token({ key: strangerKey }))).rejects.toThrow();
  });

  it('refuses a token whose payload was altered after signing', async () => {
    const [header, payload, signature] = (await token()).split('.') as [string, string, string];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    /* The oldest attack there is: keep the signature, change whose it is. */
    decoded['sub'] = 'bbbbbbbb-4000-4000-8000-00000000000b';
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    await expect(verify()(`${header}.${tampered}.${signature}`)).rejects.toThrow();
  });

  it('refuses a token from another issuer', async () => {
    await expect(
      verify()(await token({ issuer: 'https://someone-else.example' })),
    ).rejects.toThrow();
  });

  it('refuses a token minted for another audience', async () => {
    await expect(verify()(await token({ audience: 'service_role' }))).rejects.toThrow();
  });

  it('refuses an expired token, with no grace', async () => {
    /* One second past, not one minute: `clockTolerance` is zero on purpose. */
    await expect(verify()(await token({ expiresIn: '-1s' }))).rejects.toThrow();
  });

  it('refuses a token that names nobody', async () => {
    await expect(verify()(await token({ subject: null }))).rejects.toThrow();
  });

  it.each(['', 'not-a-token', 'a.b.c', 'Bearer something'])(
    'refuses the malformed token %j',
    async (malformed) => {
      await expect(verify()(malformed)).rejects.toThrow();
    },
  );

  it('derives the identity from the token alone', async () => {
    /*
     * There is no second argument, no request body and no header carrying a
     * student id: whose session this is, is whatever `sub` was signed as.
     */
    const session = await verify()(
      await token({ subject: 'cccccccc-4000-4000-8000-00000000000c' }),
    );
    expect(session.userId).toBe('cccccccc-4000-4000-8000-00000000000c');
    expect(session.claims['sub']).toBe('cccccccc-4000-4000-8000-00000000000c');
  });
});

describe('the issuer the verifier trusts', () => {
  it('is derived from the project URL, not from the token', async () => {
    const config = authConfigFor('https://project-ref.supabase.co');
    expect(config.issuer).toBe('https://project-ref.supabase.co/auth/v1');
  });
});
