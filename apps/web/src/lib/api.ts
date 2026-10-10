/**
 * The authenticated fetch used for every `/api/v1/me/*` call.
 *
 * One place that attaches the bearer token and the safe correlation headers
 * (platform, app version), so the server can tie an error to a build without
 * the client ever sending anything sensitive. Returns null when there is no
 * session, so callers degrade to local-only rather than calling unauthenticated.
 */

import type { AuthAdapter } from '../repositories/cloud/supabase.js';
import { apiBaseUrl } from '../repositories/reference.js';
import { clientHeaders } from './client-info.js';

export async function authorizedFetch(
  adapter: AuthAdapter | null,
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (adapter === null) return null;
  const token = await adapter.accessToken();
  if (token === null) return null;
  return fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...clientHeaders(),
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  });
}
