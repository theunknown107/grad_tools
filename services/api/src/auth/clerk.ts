/**
 * Clerk as the API's authentication authority.
 *
 * `clerkMiddleware()` verifies the request — the `Authorization: Bearer` session
 * token the web app sends — and `getAuth(req)` reads the result. Nothing here
 * decodes a JWT by hand, and the only identity read is the verified `userId`
 * (the token's `sub`), which becomes the RLS subject (db/cloud.ts, Supabase
 * 0012). A user id in a request body, query or path is never consulted.
 *
 * `authorizedParties` pins which web origins a session token may have been
 * minted for (its `azp`), so a token issued to another site using the same
 * Clerk instance cannot be replayed here.
 */

import { clerkMiddleware, createClerkClient, getAuth } from '@clerk/express';
import type { RequestHandler } from 'express';
import type { RequestAuthenticator } from './session.js';

export interface ClerkConfig {
  readonly secretKey: string;
  readonly publishableKey: string;
  /** Origins whose session tokens are accepted (`azp`). Empty: Clerk's default. */
  readonly authorizedParties: readonly string[];
}

export function createClerkMiddleware(config: ClerkConfig): RequestHandler {
  return clerkMiddleware({
    secretKey: config.secretKey,
    publishableKey: config.publishableKey,
    ...(config.authorizedParties.length > 0
      ? { authorizedParties: [...config.authorizedParties] }
      : {}),
  });
}

/** The verified Clerk user of a request that passed `clerkMiddleware()`, or null. */
export const clerkAuthenticator: RequestAuthenticator = {
  async fromRequest(req) {
    const auth = getAuth(req);
    if (!auth.isAuthenticated || typeof auth.userId !== 'string' || auth.userId === '') return null;
    return { userId: auth.userId, token: '', claims: { sub: auth.userId } };
  },
};

/**
 * Deletes the Clerk user, server-side, through Clerk's backend API. A user who
 * is already gone (404) is the state the student asked for, so a retry after a
 * partial failure completes instead of erroring.
 */
export function createClerkIdentityDeleter(
  secretKey: string,
  client: { users: { deleteUser: (userId: string) => Promise<unknown> } } = createClerkClient({
    secretKey,
  }),
): (userId: string) => Promise<void> {
  return async function deleteIdentity(userId: string): Promise<void> {
    try {
      await client.users.deleteUser(userId);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return;
      throw error;
    }
  };
}
