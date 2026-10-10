# Snyk exception justifications (REVIEW ONLY)

Prepared 2026-10-09 for review. **No Snyk ignore has been created and no scanner
setting changed.** This records the evidence for two low-severity code-security
categories so a human can decide whether to file an exception. Each item
separates **verified evidence** from **assumption**. An item is a candidate
exception because of the security boundary shown below — **not** merely because it
lives in a test.

> Snyk finding IDs are not reproduced here: a Snyk rescan could not be run in this
> environment (no Snyk login/org access). Locations are exact; capture the matching
> Snyk issue IDs from the Snyk UI before filing any exception.

---

## A. Hardcoded test credentials

**Snyk category:** Use of Hardcoded Credentials / Password (Low).

### A1. `services/api/test/api.test.ts` — logger redaction test

**Verified evidence:**
- Lines (current tree): `1069` `token: 'secret-token-value'`, `1071`
  `password: 'hunter2'`, inside a `createLogger(...).info({...})` call.
- Lines `1084` `expect(output).not.toContain(secret)` for each of
  `['1XX22CS001','student@example.org','secret-token-value','A Student','hunter2']`,
  and `1086` `expect(output).toContain('[redacted]')`.
- The test's purpose is to prove the logger **redacts** secret-like fields. The
  fake values are the test's *input*; the assertions fail if they appear in output.

**Why these cannot authenticate anywhere (verified):** `hunter2` is a well-known
joke placeholder; `secret-token-value` is a literal description string. Neither is
a real token format, and nothing in the repo uses them as live credentials.

**Why removing them would weaken security:** deleting or blanking them removes the
only assertion that the logger scrubs `password`/`token` fields — a genuine
redaction regression would then pass silently.

**Assumption (flagged):** that no production system coincidentally accepts the
literal string `hunter2`. This is standard for placeholder fixtures but is an
assumption, not a proof.

**Proposed exception justification:** deliberate non-functional fixtures that are
the required input to a redaction test; keeping them is necessary to preserve the
security assertion. Scope any ignore to these exact lines.

### A2. `apps/web/test/clerk-adapter.test.ts` — synthetic passwords

**Verified evidence:** `56` `password: 'pw-synthetic'`, `156`
`password: 'new-pw-synthetic'`, used to drive the Clerk adapter's password/sign-up
paths against a **mocked** adapter (no network).

**Why fake (verified):** the strings are self-labelled `-synthetic`; the test
injects a fake adapter, so no real auth endpoint is contacted.

**Proposed exception justification:** synthetic inputs to exercise auth-adapter
code paths; they authenticate against nothing. Preserve the tests.

---

## B. Cleartext HTTP in QA scripts

**Snyk category:** Cleartext Transmission of Sensitive Information / HTTP (Low).

**Flagged files (22):** `tests/*.mjs` —
accent-qa, app-qa, auth-qa, empty-qa, figma-delta-qa, import-route-qa,
import-workflow-qa, interaction-qa, m96b-qa, navigation-qa, ocr-qa,
profile-programme-qa, real-academic-chain-qa, real-document-qa, real-timetable-qa,
result-import-qa, results-qa, subject-identity-qa, theme-qa, ux-fix-pass-qa,
visual-qa-seeded, visual-qa.

**Verified evidence:**
- Every `http(s)://` literal in `tests/*.mjs` targets **loopback only**: 68×
  `http://localhost`, 4× `http://localhost:3001`, 1× `http://127.0.0.1`. A grep for
  any non-loopback `http(s)://` in these files returns **nothing**.
- These are Playwright/QA harnesses that drive a **locally-started Vite dev/preview
  server** (loopback), then screenshot/assert. They are not part of the shipped
  app and do not run in production.

**Network boundary (verified):** traffic never leaves the host loopback interface.
TLS is not applicable to `http://localhost` / `127.0.0.1`; a dev server offers no
certificate, and loopback is not observable on the network.

**Credentials / sensitive payload (verified):** the URLs carry no auth tokens or
credentials in the path/query; the requests drive UI routes with synthetic test
data.

**When this must be reconsidered (conditions):**
- If any QA target is changed to a **non-loopback** host (a remote/staging/prod
  URL) → it must use HTTPS and the exception no longer applies.
- If a script begins sending **real credentials or personal data** in requests.
- If these scripts are ever run against a deployed environment rather than a local
  server.

**Proposed exception justification:** loopback-only developer QA traffic with no
credentials and no sensitive payload, where TLS is inapplicable; scope any ignore
to `tests/*.mjs` and re-review if a target host or payload changes.

---

## Status

Both categories are **proposed justified exceptions**, documented for review. No
ignore created, no scanner config changed. The underlying tests and QA scripts are
unchanged and must be preserved.
