/**
 * DELETE /api/v1/me — the account-deletion route (F4).
 *
 * Isolated unit coverage with a mocked verifier and a mocked `deleteAccount`;
 * neither branch touches the cloud connection, so no database is needed. The
 * live end-to-end deletion against the deployed API is proven separately.
 *
 * What is pinned here:
 *   - with no admin connection (deleteAccount absent) the route refuses with
 *     503 DEPENDENCY_UNAVAILABLE and deletes nothing (failure path is safe);
 *   - identity comes from the verified JWT: deleteAccount is called with the
 *     session's userId, never anything from the request;
 *   - the happy path reports deleted:true, distinguishing existed true/false;
 *   - an unauthenticated DELETE is refused with 401 before any deletion.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createStudentRouter } from '../src/routes/me.js';
import { errorHandler } from '../src/http/errors.js';
import type { Sql } from '../src/db/client.js';
import type { Session } from '../src/auth/session.js';

/** A verifier that accepts any token and resolves to a fixed synthetic identity. */
const SESSION_USER = '11111111-1111-4111-8111-111111111111';
const verify = async (token: string): Promise<Session> => ({
  userId: SESSION_USER,
  token,
  claims: { sub: SESSION_USER },
});

/** The DELETE branches never read the cloud connection; make that explicit. */
const cloudMustNotBeUsed = new Proxy(
  {},
  {
    get() {
      throw new Error('account deletion route must not touch the cloud connection');
    },
  },
) as unknown as Sql;

function appWith(deleteAccount?: (userId: string) => Promise<boolean>) {
  const app = express();
  app.use(
    createStudentRouter(
      deleteAccount === undefined
        ? { cloud: cloudMustNotBeUsed, verify }
        : { cloud: cloudMustNotBeUsed, verify, deleteAccount },
    ),
  );
  app.use(errorHandler);
  return app;
}

const auth = { Authorization: 'Bearer any-synthetic-token' };

describe('DELETE /api/v1/me', () => {
  it('returns 503 DEPENDENCY_UNAVAILABLE when no admin connection is configured, deleting nothing', async () => {
    const res = await request(appWith()).delete('/api/v1/me').set(auth);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('derives the user to delete from the verified JWT, not from the request', async () => {
    const deleteAccount = vi.fn(async () => true);
    const res = await request(appWith(deleteAccount))
      .delete('/api/v1/me')
      .set(auth)
      // a hostile body/param must be ignored — identity is the token's sub only
      .send({ userId: 'victim-user-id' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, existed: true });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(deleteAccount).toHaveBeenCalledWith(SESSION_USER);
  });

  it('reports existed:false when the account was already gone', async () => {
    const res = await request(appWith(vi.fn(async () => false))).delete('/api/v1/me').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, existed: false });
  });

  it('refuses an unauthenticated DELETE with 401 before any deletion', async () => {
    const deleteAccount = vi.fn(async () => true);
    const res = await request(appWith(deleteAccount)).delete('/api/v1/me');
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
