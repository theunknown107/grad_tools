/** Small helpers with no domain meaning. */

/**
 * Identifier for locally-created records.
 *
 * crypto.randomUUID is available in every browser this product targets and in
 * jsdom, so no dependency is needed. These ids are local record keys, never
 * identity keys (see domain/identity.ts).
 */
export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
