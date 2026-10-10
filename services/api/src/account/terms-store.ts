/**
 * Reading and recording Terms & Conditions acceptance (TERMS-AND-ONBOARDING).
 *
 * Runs inside `withUser`, so every statement is RLS-scoped to the verified
 * subject: a caller can only ever read or write its OWN acceptance. The owner
 * column is a database DEFAULT (`auth.jwt() ->> 'sub'`), so the subject is never
 * taken from the request and cannot be forged.
 */

import type { Sql } from '../db/client.js';
import type { TermsAcceptance } from '@gradtools/shared-types';

/** The caller's acceptance of a specific version, or null if they have not accepted it. */
export async function readAcceptance(sql: Sql, version: string): Promise<TermsAcceptance | null> {
  const rows = await sql<{ accepted_at: Date }[]>`
    SELECT accepted_at FROM terms_acceptances
    WHERE auth_user_id = (SELECT auth.jwt() ->> 'sub') AND version = ${version}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { version, acceptedAt: row.accepted_at.toISOString() } : null;
}

/**
 * Records acceptance of `version`, idempotently. A second acceptance of the same
 * version does not duplicate the row (composite primary key) and returns the
 * original timestamp — so a retried or concurrent request is safe.
 */
export async function acceptTerms(sql: Sql, version: string): Promise<TermsAcceptance> {
  const inserted = await sql<{ accepted_at: Date }[]>`
    INSERT INTO terms_acceptances (version) VALUES (${version})
    ON CONFLICT (auth_user_id, version) DO NOTHING
    RETURNING accepted_at
  `;
  const row = inserted[0];
  if (row) return { version, acceptedAt: row.accepted_at.toISOString() };
  // Already accepted (or a concurrent insert won): read the existing record back.
  const existing = await readAcceptance(sql, version);
  if (existing === null) throw new Error('terms acceptance could not be recorded');
  return existing;
}
