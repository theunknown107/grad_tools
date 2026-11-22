/**
 * Support ID and Incident ID (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * SUPPORT ID — `GT-XXXXXXXX`. A stable, non-sensitive handle for an application
 * account, safe to show a student. Derived deterministically from the verified
 * auth subject so it is stable for that account's lifetime and needs no column
 * or lookup. The derivation is one-way (a truncated SHA-256), so the Support ID
 * never exposes the Clerk user id, the Supabase uuid, the email, name or USN.
 *
 * The mechanism does NOT branch on the auth provider — a Supabase subject and a
 * Clerk subject are hashed identically. (It cannot, however, make the same
 * person's Supabase and Clerk accounts share an ID: those are different
 * `accounts` rows in this system, with different subjects. Cross-provider
 * continuity is a property the migration's data-reconciliation step owns, not
 * this function.)
 *
 * INCIDENT ID — `GT-ERR-XXXXXX`. One problem/report/error. Random and
 * non-sequential, derived from nothing sensitive.
 *
 * Both use Crockford base32 (no I, L, O, U), so a student can read one aloud
 * without ambiguity.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Crockford base32: unambiguous when spoken or typed. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Encodes the first `chars * 5` bits of a buffer as Crockford base32. */
function encode(buffer: Buffer, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
    if (out.length >= chars) break;
  }
  return out;
}

/**
 * The Support ID for a verified auth subject. Pure and deterministic: the same
 * subject always yields the same ID, and no value from the request influences
 * it beyond the subject the server itself verified.
 */
export function supportIdFor(subject: string): string {
  const digest = createHash('sha256').update(subject).digest();
  return `GT-${encode(digest, 8)}`;
}

/** A fresh, random, non-sequential Incident ID. */
export function newIncidentId(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte & 31];
  return `GT-ERR-${out}`;
}
