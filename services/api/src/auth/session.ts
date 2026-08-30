/**
 * Who is making this request.
 *
 * Authority: docs/11 §11.13 · docs/13 §13.17 · M9 §41, §42, §46
 *
 * ---------------------------------------------------------------------------
 * IDENTITY COMES FROM THE TOKEN, NEVER FROM THE REQUEST
 * ---------------------------------------------------------------------------
 *
 * There is no route in this codebase that accepts a user id, a profile id or a
 * student id as a parameter and treats it as proof of anything (M9 §41). The
 * only answer to "whose data is this" comes from a signature this server
 * verified, and every student route resolves `me` from that.
 *
 * The consequence is worth stating: **there is no `GET /student/:id`**, so
 * there is no id to tamper with, and the commonest shape of IDOR is absent
 * rather than defended against.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS VERIFIED, AND WHAT IS DELIBERATELY NOT TRUSTED
 * ---------------------------------------------------------------------------
 *
 * Supabase signs its JWTs with an asymmetric key — ES256 on the project this
 * was verified against — and publishes the public half at the project's JWKS
 * endpoint. The algorithm is deliberately NOT pinned here: `jose` takes it from
 * the key the JWKS advertises, so a provider rotating from ES256 to RS256 does
 * not silently start failing every request. What IS checked is the signature,
 * the issuer, the audience and the expiry; the only claim read from the result
 * is `sub`.
 *
 * Everything else in the token — email, provider, user metadata — is IGNORED
 * for authorization. Email in particular: a provider's email can change, can
 * be a private relay (Apple), and can be shared between providers. `sub` is
 * the durable identity and the only one anything joins on (M9 §7, §8).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../http/errors.js';

/** The verified identity of a request. Nothing here came from the client. */
export interface Session {
  /** `auth_user_id`. The only identity key in the system (docs/11 §11.10a). */
  readonly userId: string;
  /** The raw token, forwarded to PostgreSQL so RLS can see the same claims. */
  readonly token: string;
  /** The verified claims, forwarded verbatim as `request.jwt.claims`. */
  readonly claims: JWTPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

export interface AuthConfig {
  /** e.g. https://<ref>.supabase.co */
  readonly supabaseUrl: string;
  /** The `iss` a token must carry. Derived, never taken from the token. */
  readonly issuer: string;
}

export function authConfigFor(supabaseUrl: string): AuthConfig {
  const trimmed = supabaseUrl.replace(/\/+$/, '');
  return { supabaseUrl: trimmed, issuer: `${trimmed}/auth/v1` };
}

/**
 * The verifier.
 *
 * `createRemoteJWKSet` caches the keys and refetches on an unknown `kid`, so a
 * key rotation does not require a restart and does not turn into a fetch per
 * request. It is created ONCE per process; creating one per request would make
 * every call an outbound HTTP request and a trivial amplification vector.
 */
export function createVerifier(config: AuthConfig) {
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`));

  return async function verify(token: string): Promise<Session> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: 'authenticated',
      // A token is valid until it expires and not one second longer. `jose`
      // enforces `exp` by default; the tolerance is set to zero explicitly so
      // nobody later assumes there is slack here.
      clockTolerance: 0,
    });

    const userId = payload.sub;
    if (typeof userId !== 'string' || userId === '') {
      throw new ApiError('UNAUTHENTICATED', 'That session is not valid. Sign in again.');
    }

    return { userId, token, claims: payload };
  };
}

/** Reads a bearer token, or returns null. Never throws on a missing header. */
function bearerFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

export type Verifier = ReturnType<typeof createVerifier>;

/**
 * Requires a valid session, or refuses the request.
 *
 * THE ERROR SAYS WHAT TO DO, NOT WHAT WENT WRONG (M9 §46). A student reading
 * "Your session has expired. Sign in again." can act on it; "JWT verification
 * failed: signature mismatch" tells them nothing and tells an attacker which
 * of their guesses was closer.
 *
 * Every failure — absent, malformed, expired, wrong issuer, wrong audience,
 * bad signature — produces the SAME message and the same status, so the
 * endpoint cannot be used as an oracle.
 */
export function requireSession(verify: Verifier) {
  return async function middleware(req: Request, _res: Response, next: NextFunction) {
    const token = bearerFrom(req);
    if (token === null) {
      next(new ApiError('UNAUTHENTICATED', 'Sign in to see this.'));
      return;
    }

    try {
      req.session = await verify(token);
      next();
    } catch {
      next(new ApiError('UNAUTHENTICATED', 'Your session has expired. Sign in again.'));
    }
  };
}

/**
 * The session on a request that passed `requireSession`.
 *
 * Throws rather than returning null: reaching this without a session means a
 * route was mounted without the guard, which is a programming error that must
 * fail loudly rather than fall through to a query with no owner.
 */
export function sessionOf(req: Request): Session {
  const session = req.session;
  if (session === undefined) {
    throw new Error('A student route was reached without an authenticated session.');
  }
  return session;
}
