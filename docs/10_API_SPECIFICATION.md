# 10 — API Specification

**Status:** Phase 1 draft — contract design only, no implementation
**Base URL:** `https://api.gradtools.<domain>/api/v1`
**Format:** JSON, UTF-8. All timestamps ISO 8601 UTC.
**Consistent with:** `09_DATABASE_SCHEMA.md` (every resource maps to tables there) and `11_AUTH_IDENTITY_AND_ACCESS.md` (every auth rule below is defined there).

---

## 10.1 Design rules

1. **The API is not required for the core product.** Calculators, attendance and timetable work entirely client-side. The API exists for sync, content, ingestion output and admin. An API outage degrades but does not disable GradTools.
2. **Versioned in the path** (`/api/v1`). Breaking changes create `/v2`; `/v1` is supported for at least 6 months after.
3. **Zod schemas in `packages/shared` are the single contract.** Client and server import the same schema; a change that breaks the contract fails to compile on both sides.
4. **Resource IDs in paths are always verified against the session.** An ID present in a URL or body is never sufficient authorization.
5. **Server recomputes.** Any academic value sent by a client is recomputed server-side before persistence; the response returns the server's value.

## 10.2 Authentication

Session cookie, set at magic-link consumption:

```
Set-Cookie: gt_session=<opaque-32-byte-base64url>;
            HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```

- No bearer tokens, no JWTs, no API keys for students.
- `SameSite=Lax` plus an origin check on state-changing requests is the CSRF defence (§10.9).
- The cookie value is opaque; the server stores only its SHA-256.

**Auth levels used in the tables below:**

| Level | Meaning |
|---|---|
| `public` | No session required |
| `session` | Valid, non-revoked session |
| `owner` | Valid session **and** the target resource belongs to that student |
| `admin` | Session belongs to a student in the operator allowlist |

## 10.3 Standard error envelope

Every non-2xx response:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Attended cannot exceed conducted.",
    "details": [{ "field": "classes_attended", "issue": "gt_conducted" }],
    "reference": "err_8f2a1c9b"
  }
}
```

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Zod rejection, semantic violation |
| 401 | `NOT_AUTHENTICATED` | Missing/expired/revoked session |
| 403 | `NOT_AUTHORIZED` | Authenticated but not permitted |
| 404 | `NOT_FOUND` | Absent, **or present but not the caller's** (see below) |
| 409 | `CONFLICT` | Uniqueness violation, concurrent edit |
| 413 | `PAYLOAD_TOO_LARGE` | Body or upload over limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Non-PDF upload |
| 422 | `UNPROCESSABLE` | Well-formed but impossible (e.g. semester 9) |
| 429 | `RATE_LIMITED` | Over limit; includes `Retry-After` |
| 500 | `INTERNAL_ERROR` | Unexpected; `reference` correlates to the log |
| 503 | `DEPENDENCY_UNAVAILABLE` | Database or object store down |

**Deliberate choice:** requesting another student's resource returns **404, not 403**. A 403 confirms the resource exists, which is an enumeration oracle. Messages never reveal whether an email address is registered, for the same reason.

`message` is safe to display to a user. Internal detail — stack traces, SQL, upstream errors — never appears in a response; it is logged against `reference`.

## 10.4 Conventions

**Pagination** (cursor-based; offset pagination is not offered because it drifts under concurrent inserts):
```
GET /papers?limit=20&cursor=eyJpZCI6...
→ { "data": [...], "page": { "next_cursor": "...", "has_more": true } }
```
`limit` default 20, max 100.

**Filtering / sorting:** explicit allowlisted params per endpoint (`?year=2025&semester=3&sort=-exam_year`). Arbitrary field filtering is not supported — it becomes an injection and performance surface.

**Idempotency:** `POST` endpoints that create externally-visible effects accept `Idempotency-Key`. Replay within 24 h returns the original response. Required on uploads and notification test sends.

**Concurrency:** mutable resources return `ETag`; `PUT`/`PATCH` accept `If-Match` and return `409` on mismatch.

**Caching:** see `07` §7.8. Every student-scoped response carries `Cache-Control: private, no-store`.

## 10.5 Endpoints — Identity

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Request a magic link |
| POST | `/auth/verify` | public | Exchange a link token for a session |
| POST | `/auth/logout` | session | Revoke the current session |
| GET | `/auth/me` | session | Current student + preferences |
| GET | `/auth/sessions` | session | List active sessions |
| DELETE | `/auth/sessions/:id` | owner | Revoke another session |

```http
POST /auth/login
{ "email": "student@example.com" }

200 { "status": "sent" }
```

**Always returns 200 with the same body and comparable timing**, whether or not the email exists. Rate limited to 3 per email per hour and 10 per IP per hour.

```http
POST /auth/verify
{ "token": "<from the emailed link>" }

200 + Set-Cookie
{ "student": { "id": "...", "email": "...", "display_name": null,
               "college_id": null, "scheme_id": null, "branch_id": null,
               "current_semester": null },
  "is_new": true }
```

Token rules: single-use (`consumed_at` set inside the same transaction that creates the session), 15-minute expiry, compared by hash in constant time.

## 10.6 Endpoints — Student data

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/profile` | session | Profile |
| PATCH | `/profile` | session | Update profile |
| DELETE | `/profile` | session | **Delete account and all data** |
| GET | `/profile/export` | session | Full data export (JSON) |
| GET | `/results` | session | All semester records |
| GET | `/results/:semester` | owner | One semester with subjects |
| PUT | `/results/:semester` | owner | Create/replace a semester result |
| DELETE | `/results/:semester` | owner | Delete a semester |
| POST | `/results/parse` | session | Parse pasted grade-card text → **preview only, saves nothing** |
| GET | `/attendance` | session | All attendance records |
| PUT | `/attendance/:subjectCode` | owner | Upsert attendance for a course |
| DELETE | `/attendance/:subjectCode` | owner | Remove |
| GET | `/backlogs` | session | Derived backlogs |
| GET | `/timetable` | session | Slots |
| PUT | `/timetable` | session | Replace the whole timetable |
| GET | `/preferences` | session | Preferences |
| PATCH | `/preferences` | session | Update |

```http
PUT /results/3
{
  "scheme_id": "vtu-2022",
  "sgpa_asserted": 8.5,
  "subjects": [
    { "subject_code": "BCS301", "subject_title": "Mathematics III",
      "credits": 4, "cie_marks": 42, "see_marks": 71, "grade_letter": "A" }
  ]
}

201
{
  "semester": 3,
  "sgpa_computed": 8.43,
  "sgpa_asserted": 8.50,
  "discrepancy": {
    "present": true,
    "message": "Your entered SGPA differs from the value computed from these subjects.",
    "difference": 0.07
  },
  "total_credits": 22, "earned_credits": 22,
  "rule_set": { "id": "...", "version": 1, "scheme": "vtu-2022" },
  "subjects": [ { "...": "...", "grade_letter": "A", "grade_points": 8,
                  "grade_source": "derived", "result_status": "pass" } ]
}
```

Three behaviours in that response are contractual:
- `grade_letter` is **recomputed** from marks via the active rule set; a client-supplied grade that disagrees is replaced and `grade_source` records whether the student explicitly overrode it.
- `discrepancy` surfaces disagreement rather than resolving it silently (`08` §SemesterRecord).
- `rule_set` is echoed so the client can show which rules produced the number.

```http
POST /results/parse
{ "text": "<pasted grade card>" }

200
{ "confidence": 0.82,
  "warnings": ["Credits missing for 2 subjects"],
  "subjects": [ ... ],
  "notice": "Parsed from your text. Nothing has been saved. Check every value before saving." }
```

Never writes. The client shows an editable review table (`03/UF-08`), then calls `PUT /results/:semester`.

```http
DELETE /profile
{ "confirm": "DELETE" }

200 { "deleted_at": "2026-08-23T10:00:00Z",
      "hard_deleted": ["results","attendance","backlogs","timetable",
                       "preferences","sessions","subscriptions"],
      "personal_fields_erased": true,
      "backups_age_out_by": "2026-09-22T00:00:00Z" }
```

Executes in one transaction, invalidates all sessions, and returns exactly what happened — the response is the evidence for FR-104.

## 10.7 Endpoints — Content

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/schemes` | public | Supported schemes |
| GET | `/schemes/:id/rules` | public | Active rule set (grade bands, thresholds, formulas, clause citations) |
| GET | `/colleges` | public | Supported colleges |
| GET | `/branches` | public | Branches |
| GET | `/subjects` | public | `?scheme=&branch=&semester=` |
| GET | `/subjects/:code` | public | Subject + modules |
| GET | `/subjects/:code/syllabus` | public | Modules and topics |
| GET | `/papers` | public | `?subject=&year=&type=` — **returns public-tier documents only** |
| GET | `/papers/:id` | public | Paper metadata + download URL. Private-tier documents return **404** to anyone but their uploader (`DEC-010`) |
| GET | `/papers/:id/questions` | public | Extracted questions, with confidence |
| POST | `/papers/upload` | session | Upload a paper (quarantined) |
| GET | `/subjects/:code/module-priority` | public | Frequency analysis **with evidence** |
| GET | `/announcements` | public | Recent announcements |
| GET | `/announcements/:id` | public | Detail + provenance |

`GET /schemes/:id/rules` deserves emphasis: it publishes the rule set, its clause citations and its source URL. The product's central trust claim is machine-readable, which is what allows the client-side calculator explainers to cite sources without hard-coding them.

```http
GET /subjects/BCS304/module-priority

200
{
  "subject_code": "BCS304",
  "paper_count": 8,
  "years_covered": [2019, 2026],
  "sufficient_data": true,
  "method_version": "freq-v1",
  "modules": [
    { "module_number": 3, "title": "Normalization",
      "appearance_count": 8, "total_papers": 8,
      "question_count": 16, "average_marks": 20,
      "score": 0.94,
      "evidence": { "years_appeared": [2019,2020,...],
                    "question_ids": ["...", "..."] } }
  ],
  "disclaimer": "Historical frequency across 8 past papers. Not a prediction of the next paper."
}
```

When `paper_count < 4`, the response is `{"sufficient_data": false, "paper_count": 2, "modules": []}` — the ranking is withheld entirely rather than shown with a caveat (`03/UF-15`, `18` §6).

```http
POST /papers/upload         (multipart/form-data, Idempotency-Key required)
  file: <pdf, ≤ 20 MB>
  subject_code, exam_year, exam_session

202
{ "document_id": "...", "status": "quarantined",
  "message": "Received. It will be reviewed before appearing in the library." }
```

`202`, never `201`: the resource is not yet published. Validation and review happen asynchronously (`17` §3).

### 10.7.1 As built in M5a — reference data

The reference subset of the table above is **implemented and served**. Everything
else in §10.7 (papers, questions, module priority, announcements) remains
specification only.

All paths carry the `/api/v1` prefix and are exported as constants from
`@gradtools/shared-types` (`API_ROUTES`), so the client cannot drift from the
server. A test asserts each constant resolves to a route that exists.

| Method | Path | Status |
|---|---|---|
| GET | `/health` | implemented — liveness, no dependency checks |
| GET | `/health/ready` | implemented — reports database reachability only |
| GET | `/api/v1/universities` | implemented |
| GET | `/api/v1/schemes` | implemented |
| GET | `/api/v1/schemes/:id` | implemented |
| GET | `/api/v1/schemes/:id/rules` | implemented — **metadata only**, never a computed value. Optional `?college=` |
| GET | `/api/v1/branches` | implemented |
| GET | `/api/v1/colleges` | implemented — returns `[]`; no college is verified yet |
| GET | `/api/v1/subjects` | implemented — `?scheme=&branch=&semester=` |
| GET | `/api/v1/subjects/:id` | implemented — **UUID**, not code |
| GET | `/api/v1/subjects/:id/syllabus` | implemented — returns `[]`; no module source is verified (`OQ-025`) |

`/api/v1/universities` was added beyond the original table: a scheme belongs to a
university, and the client could not resolve that reference without it.

Two behaviours are deliberate and tested:

- An **empty list is not a 404.** `/subjects?semester=5` and
  `/subjects/BMATS101/syllabus` both return `{"data": []}` with `200`. "This
  subject exists and its syllabus is not verified yet" is a different fact from
  "no such subject", and only the second is a 404.
- **Only published rows are served.** Every verified-reference query filters
  `publication = 'published'`, and every row is parsed through the shared Zod
  schema before it leaves the process. The database schema is not the contract.

  `/universities` and `/branches` are the two exceptions, and deliberately so:
  they serve **internal taxonomy**, which has no publication state. Their control
  is `active`, which both now apply — until M4.2, `/universities` applied no
  filter at all. See `08` §8.3.1 for why these two are classified differently.

Pagination is **not yet implemented**. Collection responses are already wrapped
as `{ "data": [...] }` so `page` can be added without a breaking change. The
largest current response is 5 KB (§23), so there is nothing to paginate.

#### Corrected in M4.1

**Subjects are addressed by UUID, not by code.** Database uniqueness is
`(scheme_id, branch_id, code)`, so a code identifies a *set*, not a row — the
same code recurs legitimately across branches and schemes. The code-addressed
route resolved that with `LIMIT 1`, silently returning one of several matches.
A code is now rejected with `400`, not guessed at; a caller holding a code
filters the collection:

```http
GET /api/v1/subjects?scheme=vtu-2022&branch=cse&semester=1
```

**Rule-set selection is deterministic.** `?college=<id>` is optional and the
precedence is explicit:

1. the requested college's active rule set, if one exists
2. otherwise the scheme-wide active rule set
3. otherwise `404`

The schema deliberately allows both to be active at once, so the previous
`... WHERE active LIMIT 1` with no `ORDER BY` was a coin toss that only looked
stable while exactly one rule set existed. A college rule set is never returned
to a caller who did not ask for one.

**`moduleCount` is nullable.** `null` means the syllabus structure is not
verified. It is not `0`, and clients must not render it as one.

#### OCR endpoints (M5A.3)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/documents/:id/ocr` | Queue OCR. Returns **202** with a job id, or **200** when a job is already active |
| GET | `/api/v1/documents/:id/status` | Progress: extraction status, paper format, review flag, section count, job state |

`POST /ocr` **is not a general job runner.** It accepts no job type, no
parameters and no URL — only the id of a document that already exists, has
passed validation, and actually needs OCR. Everything about the work is decided
server-side. A body containing `jobType`, `url` or `command` is ignored, which
is asserted by test.

It returns immediately. OCR is ~1.07 s/page measured (docs/23 §23.3.4), which is
not a request; the work happens in a worker and the client polls `/status`.

A second request is **not an error**: `enqueue` dedupes against the partial
unique index and reports `alreadyQueued`, so a repeat click is harmless.

Both responses are `private, no-store`.

No write endpoint exists. `POST`, `PUT`, `PATCH` and `DELETE` return `404` on
every path, which is asserted by test.

## 10.8 Endpoints — Notifications and admin

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/notifications/subscribe` | session | Register a push subscription |
| DELETE | `/notifications/subscribe` | session | Unsubscribe |
| GET | `/notifications/preferences` | session | Categories, quiet hours |
| PUT | `/notifications/preferences` | session | Update |
| POST | `/notifications/test` | session | Send a test push (rate limited 1/min) |
| GET | `/admin/sources` | admin | Source registry + health |
| PATCH | `/admin/sources/:id` | admin | Enable/disable, interval (subject to the robots constraint) |
| POST | `/admin/sources/:id/run` | admin | Trigger a run now |
| GET | `/admin/jobs` | admin | Job history |
| GET | `/admin/review-queue` | admin | Low-confidence items |
| POST | `/admin/review/:id/approve` | admin | Publish |
| POST | `/admin/review/:id/reject` | admin | Reject with reason |
| PATCH | `/admin/records/:type/:id` | admin | Correct a published record (audited, reason required) |
| GET | `/admin/audit` | admin | Audit log |
| GET | `/admin/health` | admin | System health detail |

`PATCH /admin/sources/:id` returns `422 UNPROCESSABLE` when asked to enable a source whose `robots_allows_path` is false or unchecked — the API surfaces the database constraint from `09` §9.7 as a clear error rather than a constraint-violation 500.

## 10.9 Security controls on every request

| Control | Implementation |
|---|---|
| TLS | Enforced; HSTS with preload |
| Headers | `helmet`: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` |
| CORS | Explicit origin allowlist; `credentials: true`; no wildcard |
| CSRF | `SameSite=Lax` + `Origin`/`Sec-Fetch-Site` check on all state-changing methods |
| Body limit | 1 MB JSON; 20 MB multipart on the upload endpoint only |
| Validation | Zod on body, query and params — no handler reads an unvalidated value |
| Authorization | Explicit guard per handler; a route without one fails a lint rule and a test |
| SQL | Parameterised via Drizzle; raw SQL requires review |
| Output | JSON only; no server-rendered HTML, removing a large XSS surface |
| Logging | `pino` with a redaction list covering cookies, tokens, email, USN, name |
| SSRF | Outbound requests restricted to an allowlist of hosts; user-supplied URLs are never fetched |

## 10.10 Rate limits

Deterministic and enforced in application/infrastructure code. **No AI is involved in rate limiting** (master instruction §9).

| Scope | Limit | Window |
|---|---|---|
| Global per IP | 300 req | 5 min |
| `POST /auth/login` per email | 3 | 1 h |
| `POST /auth/login` per IP | 10 | 1 h |
| `POST /auth/verify` per IP | 20 | 1 h |
| Authenticated writes per account | 120 | 5 min |
| `POST /papers/upload` per account | 10 | 1 day |
| `POST /results/parse` per account | 30 | 1 h |
| `POST /notifications/test` per account | 1 | 1 min |
| Admin endpoints | 600 | 5 min |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; 429 includes `Retry-After`. Counters live in Postgres so limits hold across instances. Limits on the outbound side (against external sources) are separate and stricter — see `14` §5.

## 10.11 Health and operations

| Path | Auth | Returns |
|---|---|---|
| `GET /health` | public | `{"status":"ok"}` — liveness, no dependency checks |
| `GET /health/ready` | public | Database and object-store reachability |
| `GET /health/sources` | admin | Per-source health detail |

`/health` deliberately performs no dependency checks: a health endpoint that fails when a non-essential dependency is down causes the orchestrator to restart a perfectly serviceable container.

## 10.12 Contract testing

- Every endpoint has a request/response Zod schema in `packages/shared`.
- The API test suite asserts responses against those schemas, so a handler cannot drift from the contract without failing a test.
- Every documented error code has a test that provokes it.
- Authorization tests are table-driven: for each endpoint, calls as anonymous / wrong-owner / correct-owner / admin, asserting the expected status. This table is the defence against IDOR and is required to cover 100% of student-scoped endpoints (`22` §Security tests).

---

### 10.7.2 Sources and documents (M5)

| Method | Path | Status |
|---|---|---|
| GET | `/api/v1/sources` | implemented |
| GET | `/api/v1/sources/:id` | implemented |
| GET | `/api/v1/documents` | implemented — **metadata only** |
| GET | `/api/v1/documents/:id` | implemented — **metadata only** |

**The source registry is public on purpose.** Publishing what GradTools reads,
whether robots and terms permit it, and whether it is switched on turns a claim
into something a student or a college can check (`14` §14.7.1). Every seeded
source currently reports `enabled: false`, and this endpoint is how that is
verifiable from outside.

**No route serves a document file**, in this milestone or in this file. A
`link` document returns metadata and the original URL; a `private` document does
not appear in the listing at all. A test walks `/file`, `/download`, `/content`
and `/raw` and asserts 404 on each.

There is **no upload endpoint**. Document validation, storage and extraction are
implemented and tested as modules; exposing them over HTTP needs the rate
limiting, quarantine review and abuse handling of `17` §3, which is not this
milestone.

---

#### Corrected in M5.1

**Public document visibility now requires validation as well as rights.** The
condition is:

```sql
presentation IN ('host','link') AND state IN ('validated','extracted')
```

It previously read `state <> 'rejected'`, which admitted a `quarantined`
document into a public response. Quarantined, rejected, private and blocked
documents are all invisible.

The condition is defined **once** and shared by the list and the by-id paths, so
they cannot drift — the by-id path is exactly where such a filter gets
forgotten. The database enforces the same rule independently
(`document_public_requires_validation`).
