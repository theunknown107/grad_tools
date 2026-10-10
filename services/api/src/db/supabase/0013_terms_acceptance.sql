-- =============================================================================
-- 0013 — Terms & Conditions acceptance
-- =============================================================================
--
-- Records that an authenticated account accepted a specific Terms version, and
-- when. ADDITIVE and provider-agnostic: it keys on the same text subject every
-- student table uses since 0012 (`auth.jwt() ->> 'sub'`, which is `accounts.id`),
-- so it works identically under Clerk or legacy Supabase auth. It touches no
-- existing table and preserves all existing data.
--
-- APPEND-ONLY. One row per (account, version): accepting a NEW version adds a
-- row; the old acceptance stays. There is no UPDATE and no DELETE policy — an
-- acceptance is a historical fact, and the row is removed only when the account
-- itself is deleted (ON DELETE CASCADE).
--
-- OWNERSHIP IS IN THE DATABASE, not only the API. RLS lets an account read and
-- insert ONLY its own acceptance, and the owner column DEFAULTS to the verified
-- subject, so the client never supplies it and cannot forge it.
--
-- ATOMIC: one multi-statement query = one implicit transaction (postgres.js).
-- =============================================================================

CREATE TABLE terms_acceptances (
  auth_user_id text NOT NULL DEFAULT (auth.jwt() ->> 'sub') REFERENCES accounts (id) ON DELETE CASCADE,
  version      text NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_user_id, version),
  CONSTRAINT terms_acceptances_version_not_blank CHECK (btrim(version) <> ''),
  CONSTRAINT terms_acceptances_version_len CHECK (length(version) <= 40)
);

COMMENT ON TABLE terms_acceptances IS
  'One row per (account, Terms version): that this account accepted that version, '
  'and when. Append-only; keyed by the verified subject (accounts.id).';

ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms_acceptances FORCE ROW LEVEL SECURITY;

-- `(SELECT ...)` so the planner evaluates the subject once per statement.
CREATE POLICY terms_acceptances_select_own ON terms_acceptances
  FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.jwt() ->> 'sub'));
CREATE POLICY terms_acceptances_insert_own ON terms_acceptances
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = (SELECT auth.jwt() ->> 'sub'));

REVOKE ALL ON terms_acceptances FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT ON terms_acceptances TO authenticated;
