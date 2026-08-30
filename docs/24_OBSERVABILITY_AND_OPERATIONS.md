# 24 — Observability and Operations

**Status:** Phase 1 draft
**Operating reality:** one part-time operator, no on-call rotation. Every choice below is shaped by that. Observability that requires constant attention will be ignored within a month, and ignored observability is worse than none because it creates false confidence.

---

## 24.1 Objectives

1. **When something breaks, know within minutes and know why within one screen.**
2. **Never page for something that can wait until morning.**
3. **Never log personal data.**
4. **Prefer a few high-signal alerts over comprehensive dashboards nobody opens.**

## 24.2 Logging

Structured JSON via `pino`, one line per event.

```json
{
  "level": "info",
  "time": "2026-08-23T14:32:11.412Z",
  "req_id": "01J8...",
  "route": "PUT /api/v1/results/:semester",
  "status": 201,
  "duration_ms": 47,
  "student_ref": "s_8f2a",
  "msg": "result saved"
}
```

| Field | Note |
|---|---|
| `req_id` | Correlates every log line for a request and matches the client-facing error `reference` |
| `student_ref` | A short **hash prefix**, not the student ID — enough to correlate a support report, not enough to identify |
| `duration_ms` | On every request |

### Redaction (NFR-011, binding)

Never logged, at any level, in any environment:

```
cookies · session tokens · login tokens · email addresses · USN
names · marks · grades · attendance figures · request bodies of student-data endpoints
```

Enforced by `pino`'s redaction configuration **and** by a test asserting these strings never appear in generated log output (`22` §5). A redaction policy that is only a configuration file rots the first time someone adds a `logger.info(req.body)`.

#### As built in M5a

The redaction list is implemented in `services/api/src/observability/logger.ts`
and covers `authorization`, `cookie`, `set-cookie`, `password`, `token`,
`sessionToken`, `email`, `usn`, `displayName` and `name`, each also as a wildcard
(`*.email`) and under `req.body.*`, because a leak is usually an object logged
wholesale rather than a field logged deliberately. `config` and `DATABASE_URL`
have serialisers that censor them outright, so logging the whole config object
cannot expose the connection string.

The test drives the **shipped** `createLogger` factory through a capture stream
(`ED-29`) and asserts the secrets do not survive into the written output.

There is no student data on the server in M5a, so nothing can leak today. The
policy is enforced now so it is already true on the day the first student-scoped
route is written, rather than being retrofitted across log calls that have
already shipped.

`student_ref` is **not implemented** — there is no student to reference.
`req_id` is implemented, is returned to the client as `X-Request-Id`, and is the
same value the error envelope carries as `reference`.

#### OCR job logging (M5A.3)

One structured line per transition, each carrying `jobId`, `documentId` and
`durationMs`:

| Event | Level |
|---|---|
| `ocr job claimed` | info |
| `ocr started` | info |
| `ocr completed` | info — with format, languages, PSM, pages, chars, sections, `needsReview` |
| `ocr retried` | warn — with the attempt number |
| `ocr failed` | error — terminal, after attempts are exhausted |
| `requeued stalled ocr jobs` | warn |
| `ocr worker started` | info — worker id and intervals |
| `ocr worker stopped` | info — processed, idle ticks, recoveries, iterations |
| `shutting down after the current job` | info |
| `worker loop error` | error — an unexpected failure outside a job; the loop continues |

**Document CONTENT is never logged**, at any level. The completion line carries
counts and configuration — how much text, in which language, at which settings —
and never the text itself. Extracted question text is exactly the sort of
material that would be unrecoverable once it reached a log aggregator.

Filesystem paths are not logged either: a storage key is content-addressed hex
and a temp directory reveals the host layout, neither of which helps diagnosis
enough to justify emitting them.

### Levels

| Level | Use | Retention |
|---|---|---|
| `error` | Unhandled exceptions, failed jobs after final retry, source failures | 30 days |
| `warn` | Handled failures, retries, validation anomalies, rate-limit hits | 30 days |
| `info` | Request completion, job lifecycle, ingestion outcomes | 30 days |
| `debug` | Local development only, never enabled in Alpha | — |

## 24.3 Metrics

Counters and histograms exposed at an operator-only endpoint. Deliberately few.

| Metric | Type | Purpose |
|---|---|---|
| `http_requests_total{route,status}` | counter | Traffic and error rate |
| `http_duration_ms{route}` | histogram | Latency percentiles |
| `db_query_duration_ms` | histogram | Slow-query detection |
| `db_connections_active` | gauge | Pool saturation |
| `jobs_pending`, `jobs_failed_total` | gauge/counter | Queue health |
| `job_oldest_pending_seconds` | gauge | Stuck-worker detection |
| `ingestion_runs_total{source,status}` | counter | Source reliability |
| `ingestion_duration_ms{source}` | histogram | Source degradation |
| `sources_unhealthy` | gauge | Data-quality signal |
| `documents_pending_review` | gauge | Operator backlog |
| `notifications_sent_total{status}` | counter | Delivery health |
| `records_missing_provenance` | gauge | **Should always be 0** |
| `active_rulesets_unverified` | gauge | **Should always be 0** |

The last two are invariant monitors, not performance metrics. A non-zero value means a policy has been violated and something is wrong with the system's integrity, not its speed.

**No per-student metrics, no user-behaviour metrics.** Feature usage is tracked as daily aggregate counters only (`12` §7).

## 24.4 Tracing

**Not adopted.** A single monolith with structured logs and a request ID provides the same diagnostic value at a fraction of the setup and cost. Reconsider only if the worker is extracted into a separate service and cross-service latency becomes ambiguous.

## 24.5 Health endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | public | Liveness. Returns `{"status":"ok"}` with **no dependency checks** |
| `GET /health/ready` | public | Readiness. Checks database and object store |
| `GET /health/sources` | admin | Per-source health detail |

`/health` deliberately checks nothing. A liveness probe that fails when a non-essential dependency is down causes the platform to restart a container that is working perfectly — a self-inflicted outage that is a common production mistake.

## 24.6 Error reporting

Sentry, configured for privacy first:

| Setting | Value |
|---|---|
| `sendDefaultPii` | `false` |
| `beforeSend` | Strips request bodies, cookies, headers, query strings, and any field matching the redaction list |
| Sampling | 100% of errors, 0% of performance traces (cost) |
| Retention | 90 days |
| Source maps | Uploaded privately, not served publicly |

The `beforeSend` scrubber is verified by a test that sends a synthetic error containing a fake USN and email address and asserts they do not survive.

**Client errors** are captured with the same scrubbing. React error boundaries at the route level ensure one broken screen never blanks the whole application.

## 24.7 Alerting

Ruthlessly minimal. Every alert must be **actionable** and **worth interrupting someone for**.

| Alert | Threshold | Channel | Urgency |
|---|---|---|---|
| API down | `/health` fails 3× over 3 min | Push + email | **Immediate** |
| Error rate high | > 5% over 5 min | Push | **Immediate** |
| Database unreachable | Readiness fails | Push + email | **Immediate** |
| Latency degraded | p95 > 1 s over 10 min | Email | Same day |
| Job queue stuck | Oldest pending > 1 h | Email | Same day |
| Source unhealthy | > 24 h | Email | Same day |
| Review backlog | > 50 items | Email | Weekly digest |
| Disk/storage | > 80% | Email | Same day |
| Backup failed | Any failure | Email | Same day |
| Provenance invariant broken | `records_missing_provenance > 0` | Push | **Immediate** |

Only five alerts page immediately. Everything else waits, because a solo operator who is woken for a review backlog will mute the channel and then miss the outage.

## 24.8 Backup and restore

| Aspect | Detail |
|---|---|
| Database | Provider PITR (30 days) **plus** a nightly `pg_dump` to separate object storage |
| Encryption | At rest, with the key held outside the backup location |
| Objects (PDFs) | Provider versioning and lifecycle rules |
| Configuration | Environment variables documented in a secret store; `.env.example` in the repository with no values |
| Retention | 30 days rolling |
| **Restore rehearsal** | **Quarterly, and mandatory before Alpha** — restore into a scratch database, run the data-quality checks, record the elapsed time |

**A backup that has never been restored is a hypothesis, not a backup.** The rehearsal is a release gate (`22` §14), not a good intention.

Recovery objectives, stated honestly for a single-operator project: **RPO 24 h** (worst case, losing a day of student-entered data — mitigated because student data also lives locally in their browser), **RTO 4 h** during waking hours, longer overnight.

The local-first architecture materially reduces backup risk: a total database loss does not destroy students' own attendance and results, because those exist on their devices.

## 24.9 Incident handling

| Severity | Definition | Response |
|---|---|---|
| **Sev-1** | Wrong academic data shown, data loss, or a security breach | Immediate. Take the affected feature offline if needed |
| **Sev-2** | Product unusable (API down, sign-in broken) | Immediate |
| **Sev-3** | A feature degraded (source unhealthy, uploads failing) | Same day |
| **Sev-4** | Cosmetic or minor | Next release |

**A wrong SGPA is Sev-1, above an outage.** An outage is visible and temporary; a wrong number is invisible and acted upon.

### Process
```
1  Detect       (alert, or a user report)
2  Assess       severity, blast radius, whether data is affected
3  Contain      disable the feature, roll back, or revoke sessions
4  Communicate  status page or in-app banner if user-visible
5  Fix          root cause, not symptom
6  Verify       with a test that reproduces the failure
7  Restore      and confirm
8  Post-mortem  for Sev-1 and Sev-2: what happened, why, what prevents recurrence
9  Regression   the reproducing test is committed permanently
```

Post-mortems are blameless and written even though the author is the only reader — the value is in forcing step 9 to actually happen.

### Sev-1 specific: wrong academic data
```
1  Stop the bleeding: disable the affected calculator if the defect is in the engine
2  Determine scope: which rule, which students, which time window
3  Fix and test against the regulation clause
4  Recompute affected stored records under the corrected rule set (new version)
5  NOTIFY AFFECTED STUDENTS with what was wrong, for how long, and what is now correct
6  Publish a correction note
```

Step 5 is non-negotiable. A student may have made an academic decision on the wrong number, and quietly fixing it is the option that destroys trust permanently if discovered.

## 24.10 Deployment operations

Detailed in `25`. The observability-relevant parts:

- Every deployment is logged with commit SHA, timestamp and migration list.
- Post-deploy: readiness check, smoke tests, error-rate watch for 15 minutes.
- Rollback: redeploy the previous image. Database migrations are forward-only, so rollback of code must always be safe against the current schema — which is exactly why expand/contract migrations are mandatory (`09` §10).

## 24.11 Routine operations

| Cadence | Task |
|---|---|
| Daily | Glance at the health page; clear the review queue if small |
| Weekly | Review error trends; check source health; review the data-quality report; merge dependency updates |
| Monthly | Review data-quality metrics; check costs; review open decisions in `32` |
| Quarterly | Restore rehearsal; dependency audit; access review; re-verify academic rules against the current regulation |

The quarterly re-verification of academic rules is easy to skip and important: VTU can revise regulations, and a stale rule set silently produces wrong numbers with full confidence.

## 24.12 Status communication

- A simple status page (static, hosted separately from the API so it survives an outage).
- In-app banner for known degradation, stating what is affected and what still works.
- **Honest uptime.** The product states it is an Alpha operated by one person and does not promise a 99.9% SLA it cannot meet. Overpromising availability is the easiest credibility to lose and the least necessary to claim.

---

## 24.13 Source and document observability (M5)

`sources` carries `health`, `consecutive_failures` and `last_checked_at`;
`documents` carries `state`, `extraction_status` and `rejection_reason`. Both
are columns rather than metrics because the state is the operational fact, and a
metric derived from a column can be added later without changing what is stored.

Nothing writes `health` yet: no scheduler exists and no source has been fetched,
so every row reads `unknown` — which is accurate rather than a gap.

**Rejections are recorded with a reason, and the reason never echoes file
content.** A test asserts a marker string embedded in a hostile fixture does not
appear in the rejection message, so a rejection reason cannot become an
exfiltration channel into the logs.

Extraction reports its own duration, which is what `23` §23.12 was measured
from.

## 24.14 Announcement observability (M7)

### What is worth watching

| Signal | Why |
|---|---|
| Count of `draft` announcements | Work waiting for a human. A growing number means verification has stalled and students are seeing an increasingly stale feed |
| Announcements whose verification was **withdrawn** by an update | A source rewriting notices after approval. A rising count is a source-quality signal, not a bug |
| `last_seen_at` age per source | A source that stopped being reachable looks exactly like a source with nothing new. The timestamp distinguishes them |
| Normalisation refusals (bad URL, empty title) | A source whose structure changed |
| Feed p50 / p95 | Baselined in §23.13 |

### What is deliberately not logged

**Nothing about who read what.** There is no request-level student identity to
log, because the feed endpoint receives none (§12.12). Read state never reaches
the server, so there are no engagement metrics, and adding them would require
changing the API contract — visibly.

### Operational reality in Stage 1

There is no dashboard and no alerting for announcements. The counts above are
SQL queries an operator runs. Building an admin surface for them is deferred
until there is a source producing enough volume to need one.

## 24.15 Library observability (M8)

### What is worth watching

| Signal | Why |
|---|---|
| Papers by `presentation` | `link` and `private` growing while `host` stays flat is the expected shape while `OQ-008` is open. `host` growing is a signal to check why |
| Papers with `document_kind = 'unknown'` | Documents nobody has classified. They are invisible to students, so a rising count means work queued, not a fault |
| Papers with a null `exam_year` or null subject | Findable, but not by the filters students actually use. A quality backlog, not an error |
| Papers with no extraction run | The library shows them with no structure panel, which is correct and also means the pipeline has not reached them |
| File-route 404 rate | A student following a stale link, or someone probing ids. Worth distinguishing by volume |

### What is deliberately not logged

**Search terms.** The request logger redacts the `search` parameter's value
(§12.13); the parameter's presence survives, the text does not. There is no
per-student request identity to log, so there are no engagement metrics for
which papers a given person opened — and adding them would require changing the
API contract, visibly.

### Operational reality in Stage 1

The counts above are SQL an operator runs. There is no dashboard and no
alerting for the library, and building one is deferred until there is enough
volume to need it.

## 24.16 Operating an authenticated service (M9)

### What is worth watching

| Signal | Why |
|---|---|
| 401 rate | A rise is either an expiry storm after a key rotation, or somebody probing |
| 409 (conflict) rate on sync | Students genuinely using two devices. A spike suggests a sync bug, not user behaviour |
| `rejected` outcomes per push | A client sending records the database refuses — a validation drift between app and schema |
| Failed JWKS fetches | The verifier cannot reach the provider; every request will 401 until it can |
| Cloud connection errors | Distinguish "Supabase unreachable" from "student's token bad": one is an outage, the other is not |

### What is never logged

**No token, no header, no request body.** The logger records method, request id
and a URL with the `search` parameter redacted (§12.13). There is no
student-identifying field in any log line: the `sub` claim is used to open a
database transaction and is not written to a log.

Consequences accepted deliberately: there are **no per-student engagement
metrics**, and a support request cannot be traced to a person's records from
logs alone. Adding either would require a change visible in this document.

### The startup assertion

The API refuses to boot if its student-cloud connection can bypass RLS
(docs/13 §13.17). A crash loop with that message means the connection string
names the wrong role — which is the failure that would otherwise be invisible.

### Health

`/health` and `/health/ready` are unchanged and report nothing about
authentication. A readiness probe that failed when the identity provider blipped
would restart a container that is serving the public surface perfectly well.

## 24.17 The log review, performed (M9.2)

§24.16 said what must never be logged. M9.2 generated real authentication
traffic — sign-ins, authorized requests, a rejected forged token, an account
deletion — and inspected the output.

**Absent from every line:** any JWT, the `Authorization` header, a bearer token,
a refresh token, an access token, the word password, the publishable key, a
service-role key, a test credential, a test email address, **any auth user id**,
and any OAuth code.

What a request line does contain: a correlation id, the method, and a URL with
the `search` parameter redacted.

```
"req":{"id":"13f42491-…","method":"POST","url":"/api/v1/me/sync"}
```

The consequence, accepted deliberately: **a support request cannot be traced to
a person's records from logs alone.** There is no student identifier in them,
because the `sub` claim is used to open a database transaction and is never
written out.
