/**
 * Clerk as the API's authority — with Clerk MOCKED. No secret, no network.
 *
 * What is proven here: the API's identity comes only from Clerk's verified
 * auth state (`getAuth(req)` after `clerkMiddleware()`); an unauthenticated
 * request is refused; a `userId` in a body cannot impersonate anybody; the
 * Clerk user is deleted server-side and a retry is idempotent; the middleware
 * pins authorized parties; and a half-configured deployment refuses to start.
 * The RLS half of the chain runs against real PostgreSQL in clerk-identity.test.ts.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from '../src/db/client.js';

const clerk = vi.hoisted(() => ({
  getAuth: vi.fn(),
  clerkMiddleware: vi.fn(),
  createClerkClient: vi.fn(),
}));
vi.mock('@clerk/express', () => clerk);

const { clerkAuthenticator, createClerkIdentityDeleter, createClerkMiddleware } =
  await import('../src/auth/clerk.js');
const { createStudentRouter } = await import('../src/routes/me.js');
const { errorHandler } = await import('../src/http/errors.js');
const { loadConfig } = await import('../src/config.js');

const A = 'user_2synthClerkStudentA';
const B = 'user_2synthClerkStudentB';

const cloudMustNotBeUsed = new Proxy(
  {},
  {
    get() {
      throw new Error('this route must not touch the cloud connection in this test');
    },
  },
) as unknown as Sql;

function appWith(deleteAccount?: (userId: string) => Promise<boolean>) {
  const app = express();
  app.use(express.json());
  app.use(
    createStudentRouter({
      cloud: cloudMustNotBeUsed,
      verify: clerkAuthenticator,
      ...(deleteAccount === undefined ? {} : { deleteAccount }),
    }),
  );
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  clerk.getAuth.mockReset();
  clerk.clerkMiddleware.mockReset();
  clerk.createClerkClient.mockReset();
});

describe('the identity of a request', () => {
  it('is nobody when Clerk says the request is not authenticated', async () => {
    clerk.getAuth.mockReturnValue({ isAuthenticated: false, userId: null });
    expect(await clerkAuthenticator.fromRequest({} as never)).toBeNull();
  });

  it('is the verified Clerk user id, and nothing else', async () => {
    clerk.getAuth.mockReturnValue({
      isAuthenticated: true,
      userId: A,
      sessionClaims: { email: 'x' },
    });
    expect(await clerkAuthenticator.fromRequest({} as never)).toEqual({
      userId: A,
      token: '',
      claims: { sub: A },
    });
  });

  it('refuses a protected route without a Clerk session (401)', async () => {
    clerk.getAuth.mockReturnValue({ isAuthenticated: false, userId: null });
    const res = await request(appWith(async () => true)).delete('/api/v1/me');
    expect(res.status).toBe(401);
  });

  it('treats a verification failure as unauthenticated, not as an error page', async () => {
    clerk.getAuth.mockImplementation(() => {
      throw new Error('clerkMiddleware not mounted');
    });
    const res = await request(appWith(async () => true)).delete('/api/v1/me');
    expect(res.status).toBe(401);
  });

  it('never lets a userId in the body choose whose account is deleted', async () => {
    clerk.getAuth.mockReturnValue({ isAuthenticated: true, userId: A });
    const deleteAccount = vi.fn(async () => true);
    const res = await request(appWith(deleteAccount))
      .delete('/api/v1/me')
      .send({ userId: B, user_id: B, sub: B });
    expect(res.status).toBe(200);
    expect(deleteAccount).toHaveBeenCalledExactlyOnceWith(A);
  });
});

describe('deleting the Clerk user', () => {
  it('calls Clerk’s backend with the verified id', async () => {
    const deleteUser = vi.fn(async () => ({}));
    await createClerkIdentityDeleter('sk_test_synthetic', { users: { deleteUser } })(A);
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith(A);
  });

  it('treats an already-deleted user as done, so a retry completes', async () => {
    const gone = Object.assign(new Error('not found'), { status: 404 });
    const deleteUser = vi.fn(async () => {
      throw gone;
    });
    await expect(
      createClerkIdentityDeleter('sk_test_synthetic', { users: { deleteUser } })(A),
    ).resolves.toBeUndefined();
  });

  it('surfaces any other failure, so the student is told it did not finish', async () => {
    const down = Object.assign(new Error('unavailable'), { status: 503 });
    const deleteUser = vi.fn(async () => {
      throw down;
    });
    await expect(
      createClerkIdentityDeleter('sk_test_synthetic', { users: { deleteUser } })(A),
    ).rejects.toThrow('unavailable');
  });
});

describe('the middleware', () => {
  it('pins the authorized parties a session token may have been issued for', () => {
    clerk.clerkMiddleware.mockReturnValue(() => undefined);
    createClerkMiddleware({
      secretKey: 'sk_test_synthetic',
      publishableKey: 'pk_test_synthetic',
      authorizedParties: ['https://grad-tools.vercel.app', 'http://localhost:5173'],
    });
    expect(clerk.clerkMiddleware).toHaveBeenCalledWith({
      secretKey: 'sk_test_synthetic',
      publishableKey: 'pk_test_synthetic',
      authorizedParties: ['https://grad-tools.vercel.app', 'http://localhost:5173'],
    });
  });
});

describe('configuration', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://synthetic@127.0.0.1:5432/x' };

  it('refuses half a Clerk configuration rather than falling back', () => {
    expect(() => loadConfig({ ...base, CLERK_SECRET_KEY: 'sk_test_synthetic' })).toThrow(
      /must be set together/,
    );
    expect(() => loadConfig({ ...base, CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic' })).toThrow(
      /must be set together/,
    );
  });

  it('refuses a publishable key where the secret belongs', () => {
    expect(() =>
      loadConfig({
        ...base,
        CLERK_SECRET_KEY: 'pk_test_synthetic',
        CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic',
      }),
    ).toThrow(/CLERK_SECRET_KEY/);
  });

  it('accepts a complete Clerk configuration', () => {
    const config = loadConfig({
      ...base,
      CLERK_SECRET_KEY: 'sk_test_synthetic',
      CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic',
    });
    expect(config.CLERK_PUBLISHABLE_KEY).toBe('pk_test_synthetic');
  });
});
