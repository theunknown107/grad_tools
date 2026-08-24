-- 0005_gate_hardening.sql
--
-- Authority: docs/14 §14.3 · docs/17 §17.3, §17.11 · M5.1 §1, §2
--
-- Forward-only. 0001–0004 are not edited.
--
-- Two gates in 0004 were correct in intent and too permissive in expression.
-- Neither has ever let anything through — no source is enabled and no document
-- exists — but both allowed a state that the design forbids, which is the kind
-- of gap that is only ever found before it matters or long after.

-- ---------------------------------------------------------------------------
-- 1. Only an http_fetch source may be enabled
-- ---------------------------------------------------------------------------
--
-- 0004 required `access_method <> 'none'`, which reads as "reachable somehow"
-- and is not the question. `enabled` means "GradTools may reach out to this
-- source on a schedule", and that is only ever true of `http_fetch`.
--
-- `manual_upload` and `manual_entry` describe material arriving from a HUMAN —
-- a student uploading their own paper, an operator transcribing a scheme. Those
-- sources should be recorded, and they should never be polled. Under the old
-- constraint, setting `enabled = true` on one was permitted, and
-- `checkSourcePermission` would then have allowed a fetch against a source that
-- exists precisely because nobody fetches it.
--
-- The enum keeps all four values: the distinction between "arrived by upload"
-- and "typed in by an operator" is real provenance and worth recording. What
-- changes is that only one of them is fetchable.

ALTER TABLE sources DROP CONSTRAINT source_enable_requires_all_gates;

ALTER TABLE sources ADD CONSTRAINT source_enable_requires_all_gates CHECK (
  enabled = false
  OR (
    robots_status = 'allowed' AND robots_checked_at IS NOT NULL
    AND terms_status = 'permitted' AND terms_reviewed_at IS NOT NULL
    AND verification = 'verified' AND verified_at IS NOT NULL
    -- Narrowed from `<> 'none'`. Only automated HTTP fetching is a thing that
    -- can be "enabled"; the other methods are descriptions of how humans
    -- deliver material (M5.1 §1).
    AND access_method = 'http_fetch'
  )
);

COMMENT ON COLUMN sources.access_method IS
  'How material arrives. Only http_fetch is automatable; manual_upload and manual_entry describe human delivery and can never be enabled. See migration 0005.';

-- ---------------------------------------------------------------------------
-- 2. Quarantine must hold for publication too
-- ---------------------------------------------------------------------------
--
-- The document lifecycle is quarantine-first: nothing is trusted until it has
-- been validated. But 0004 constrained only the RIGHTS side of publication, and
-- the public query filtered `state <> 'rejected'` — which admits a
-- `quarantined` document, i.e. one whose bytes have not yet been checked.
--
-- Rights and validation are independent preconditions and both are required.
-- Having permission to show a document says nothing about whether it is safe to
-- show, and the query alone is the wrong place to enforce it: a second caller,
-- or an admin tool, would have to remember. So it becomes a constraint.

ALTER TABLE documents ADD CONSTRAINT document_public_requires_validation CHECK (
  presentation IN ('private', 'blocked')
  OR state IN ('validated', 'extracted')
);

COMMENT ON CONSTRAINT document_public_requires_validation ON documents IS
  'Quarantine-first: a document may only be host or link once it has passed validation. Rights permit showing it; validation makes it safe to show. Both are required.';
