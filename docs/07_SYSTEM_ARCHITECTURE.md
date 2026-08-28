# 07 — System Architecture

**Status:** Phase 1 draft
**Consistent with:** `06_TECH_STACK_AND_DEPENDENCIES.md` (React SPA + Express API + Postgres, modular monolith, long-running container)

---

## 7.1 Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BROWSER (untrusted)                                                      │
│  React SPA · Service Worker · IndexedDB (local-first profile & records)  │
│  academic-rules package runs here for instant feedback                   │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ HTTPS · JSON · httpOnly session cookie
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ CDN / static host  ── serves the SPA bundle only, no application logic    │
└──────────────────────────────────────────────────────────────────────────┘
                │
                ▼
╔══════════════════════════════════════════════════════════════════════════╗
║ API CONTAINER (trusted)                    ← trust boundary crossed here ║
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐  ║
║  │ HTTP layer: helmet · CORS · rate limit · cookie · Zod validation   │  ║
║  └───────────────────────────┬────────────────────────────────────────┘  ║
║                              ▼                                           ║
║  ┌────────────────────────────────────────────────────────────────────┐  ║
║  │ Route handlers  →  authorization guard  →  service modules         │  ║
║  └───────────────────────────┬────────────────────────────────────────┘  ║
║                              ▼                                           ║
║  ┌──────────┬──────────┬──────────┬───────────┬──────────┬───────────┐  ║
║  │ identity │ student  │ academic │ documents │ content  │  admin    │  ║
║  │          │  data    │  engine  │           │          │           │  ║
║  └──────────┴──────────┴────┬─────┴─────┬─────┴──────────┴───────────┘  ║
║                             │           │                               ║
║              ┌──────────────┘           └──────────────┐                ║
║              ▼                                          ▼                ║
║  ┌────────────────────────┐              ┌───────────────────────────┐  ║
║  │ academic-rules         │              │ ingestion subsystem       │  ║
║  │ (pure, no I/O, shared  │              │ fetch→parse→normalize→    │  ║
║  │  with the browser)     │              │ validate→publish          │  ║
║  └────────────────────────┘              └─────────┬─────────────────┘  ║
║                                                     │                    ║
║  ┌────────────────────────────────────────────────┐ │                    ║
║  │ Scheduler (node-cron) → jobs table → workers   │◄┘                    ║
║  │  • source polling  • PDF processing            │                      ║
║  │  • embedding       • notification fan-out      │                      ║
║  └────────────────────────────────────────────────┘                      ║
╚═══════════╤══════════════════╤═══════════════════╤═══════════════════════╝
            │                  │                   │
            ▼                  ▼                   ▼
   ┌────────────────┐  ┌──────────────┐   ┌──────────────────┐
   │ PostgreSQL 16  │  │ Object store │   │ External (hostile)│
   │ (managed)      │  │ (S3-compat)  │   │  • vtu.ac.in      │
   │ app data +     │  │ PDFs         │   │  • Web Push svc   │
   │ jobs + audit   │  │              │   │  • Email provider │
   └────────────────┘  └──────────────┘   │  • Sentry         │
                                          │  • Claude API (opt)│
                                          └──────────────────┘
```

## 7.2 Trust boundaries

| # | Boundary | Rule |
|---|---|---|
| **TB-1** | Browser → API | Nothing from the client is trusted. Every payload is Zod-validated. **Every academic value the client computed is recomputed server-side before persistence.** The client's number is UX; the server's number is truth. |
| **TB-2** | API → Database | Parameterised queries only (enforced by Drizzle). The application DB role has no DDL rights; migrations run under a separate role. |
| **TB-3** | External source → Ingestion | Fetched bytes are hostile. Size-capped, type-checked, parsed in a constrained context, validated before any publication. |
| **TB-4** | Uploaded file → Processing | Quarantined, magic-byte verified, bomb-guarded, extracted in a sandboxed child process with CPU/memory/time limits. |
| **TB-5** | Extracted text → AI | Document text may contain prompt-injection payloads. It is passed as data with a fixed instruction envelope, and AI output is never executed, never used for authorization, never used for calculation. |
| **TB-6** | Student → Admin | Separate authorization plane. Admin membership is an operator allowlist, not a self-serve role. Every admin action is audited. |
| **TB-7** | API → Third parties | Outbound calls go only to an allowlist of hosts, defeating SSRF via user-supplied URLs. |

## 7.3 Module responsibilities

The monolith is internally partitioned. A module may call another module's public service interface but never another module's tables directly — the discipline that makes later extraction possible without making it necessary now.

| Module | Owns | Must not |
|---|---|---|
| **identity** | Accounts, magic-link tokens, sessions, admin allowlist | Touch academic data |
| **student-data** | Profile, results, attendance, timetable, backlogs, preferences | Compute academic values itself (delegates to academic-rules) |
| **academic-engine** | Orchestrates rules-engine calls, versioned rule-set selection | Contain arithmetic (it lives in the pure package) |
| **content** | Syllabus, subjects, schemes, papers metadata | Perform ingestion |
| **documents** | Upload intake, validation, extraction, question records | Publish unvalidated output |
| **ingestion** | Source registry, adapters, scheduling, change detection, provenance | Write directly to student data |
| **notifications** | Subscriptions, fan-out, delivery, preferences, quiet hours | Originate claims about results |
| **admin** | Source health, job monitoring, review queue, corrections, audit | Bypass validation on write |

### The Result Provider boundary

Results enter the system through a provider interface rather than directly from a route handler (`15` §15.5.1):

```
ResultProvider (manual-entry | paste-parse | future authorized integration)
        │  fetch → parse → normalize → validate
        ▼
student-data module → academic-engine (recompute) → transaction → records
```

Every provider produces the same normalized shape and records its `authority` (`student_asserted` or `official`) and `parserVersion` on the stored result. Today two providers exist, both `user_supplied`. The interface exists now because manual entry and paste-parsing would otherwise be two divergent paths, and because it is what keeps a future authorized integration an implementation rather than a rewrite.

**The interface is not permission to scrape.** Every prohibition in `14` §7 applies to providers identically.

### The repository boundary (Stage 1 storage)

Implemented in M3. The web app reaches storage only through repository interfaces:

```
Stage 1:  React -> RepositoryBundle -> LocalRepository -> IndexedDB
Later:    React -> RepositoryBundle -> ApiRepository   -> Express -> PostgreSQL
```

`RepositoryBundle` is supplied through React context, so the entire storage layer is swapped in one place. Tests already exercise this by injecting an in-memory bundle, which is what demonstrates the seam is real rather than decorative.

The interfaces are **async** even though Stage 1 never makes a network call. A synchronous localStorage API would be simpler today and would force every caller to be rewritten when an API-backed repository arrives. There are no fake network calls and no simulated latency: the application is genuinely local-first, and only the shape of the boundary anticipates the change.

**Repositories persist and retrieve. They never calculate.** Every academic value comes from `@gradtools/academic-rules` at the point of display, so local and future server modes cannot drift apart.

#### As built in M5a — the boundary splits by data ownership

M5a proves the second row of the diagram above, but only for **reference data**.
The split is the point, not an accident of implementation order:

```
Reference data (public)   React -> ReferenceRepository -> fetch -> Express -> PostgreSQL
Student data   (private)  React -> RepositoryBundle    -> IndexedDB, and nowhere else
```

`apps/web/src/repositories/reference.ts` makes real `fetch` calls to Express —
nothing is faked and no latency is simulated — and parses every response through
the shared Zod contract, so a server that drifts from the contract fails at the
boundary with a clear error rather than rendering something wrong further down.
Two web tests assert the other half: recording attendance and editing the profile
send **nothing** to the server.

The one deviation from the diagram: reference reads do not go through
`RepositoryBundle`. Reference data is not student storage, has no local
implementation to swap to, and its failure modes (network, server, contract) are
ones the student-data path cannot have. Folding it into the bundle would make one
interface answer to two different sets of rules.

### The rules-engine boundary

`packages/academic-rules` is pure and shared. This produces the central architectural property of GradTools:

```
Browser: rules(input) → 8.24 shown instantly (no network)
Server:  rules(input) → 8.24 recomputed, then persisted
         mismatch → server value wins, discrepancy logged as a defect signal
```

A persistent mismatch means the packages have diverged and is treated as a Sev-2 bug, not a rounding curiosity.

## 7.4 Ingestion subsystem

Scraping is an isolated subsystem behind an adapter interface, never the architecture's centre. Full detail in `14_SCRAPING_AND_DATA_INGESTION.md`.

```
  SourceRegistry (DB rows: url, schedule, parser version, enabled, health)
        │
        ▼
  Scheduler ──creates──► jobs row ──claimed by──► Ingestion worker
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
   ┌─────────┐   ┌────────┐   ┌────────────┐   ┌───────────┐   ┌──────────┐
   │ Fetcher │──►│ Parser │──►│ Normalizer │──►│ Validator │──►│ Publisher│
   └─────────┘   └────────┘   └────────────┘   └───────────┘   └──────────┘
    timeout       adapter-      canonical         schema +        writes
    retry         specific      shapes            sanity          published
    backoff       HTML→struct                     checks          records +
    rate limit                                                    change_event
    robots check                                     │
    conditional GET                                  └── FAIL ──► source marked
    raw snapshot stored                                           unhealthy,
                                                                  publishing
                                                                  BLOCKED,
                                                                  response saved
                                                                  as a fixture
```

**Properties enforced for every adapter:** timeout, retry with exponential backoff and jitter, per-source rate limit, conditional GET (ETag/Last-Modified), content hash for change detection, raw snapshot retention, parser version stamped on every record, fixture-based tests, and an explicit failure state.

**A failing parser never degrades into publishing guesses.** It stops publishing and raises an operator-visible failure. Last-known-good data continues to be served with its original timestamp and a staleness indicator.

## 7.5 Document processing pipeline

```
Upload / operator import
   └─► quarantine (object store, not yet public)
         └─► validation: magic bytes · MIME · size · page count · bomb guard
               │                                       · embedded JS/launch rejection
               ▼
         extraction (sandboxed child process: CPU, memory, wall-clock limits)
               │  pdftotext -layout  →  text layer present?
               │        yes ──────────────────────► structured text
               │        no  ──► OCR JOB QUEUED ──► worker ──► text + review state
               ▼
         segmentation → questions (VTU SEE structure: 10 questions, 2 per module,
                                    5 modules, 20 marks each — see `17`)
               ▼
         normalization → dedup → module mapping (embeddings) → confidence score
               ▼
         confidence ≥ threshold ──► published
         confidence <  threshold ──► review queue (human decides)
```

Failure at any stage leaves the document in quarantine with a diagnosable state. Nothing partially-processed is published.

## 7.6 Request lifecycle (worked example)

`POST /api/v1/results` — a student saves a semester result.

```
1  CDN/edge          → not cached (mutation), forwarded
2  helmet            → security headers set
3  CORS              → origin checked against allowlist
4  rate limit        → per-account and per-IP token bucket (Postgres-backed)
5  cookie/session    → session token hashed, looked up, expiry checked
6  authorization     → the target student_id must equal the session's student_id
                       (IDOR defence — the ID is never taken from the body alone)
7  Zod validation    → body shape, ranges, enum membership
8  service           → student-data.saveResult()
9  rules recompute   → academic-rules recomputes grade/SGPA server-side (TB-1)
10 transaction       → upsert result + result_subjects + derived SGPA
                       + backlog rows, all-or-nothing
11 audit             → written for privileged/corrective paths
12 response          → 201 + canonical server-computed values
13 client            → replaces its optimistic values with the server's
```

Steps 6, 9 and 10 are the ones that are commonly skipped and each corresponds to a real defect class (IDOR, client-trusted maths, partial writes).

## 7.7 Failure boundaries and degradation

| Failing component | Blast radius | Behaviour |
|---|---|---|
| External source | Announcements only | Serve last valid data with staleness label; mark source unhealthy; **no notification** |
| Object store | Paper viewing/upload | Metadata still browsable; downloads show a clear error |
| Email provider | New sign-ins only | Existing sessions unaffected; sign-in page states the delay |
| Push service | Notification delivery | Items still visible in-app; delivery retried with backoff, then dropped with a logged reason |
| Claude API (optional) | AI explanations only | Feature hidden entirely; deterministic evidence view is the fallback and is always sufficient |
| Embedding model | Similarity/mapping | Falls back to deterministic keyword and code matching, with lower confidence recorded |
| PostgreSQL | Server-side reads/writes | SPA remains usable for all local-first features; clear banner; no silent data loss |
| API container | Server features | SPA loads from CDN; calculators, attendance and timetable keep working offline |

**The design intent:** the features a student uses daily (calculators, attendance) have *no* server dependency, so the most common outage is nearly invisible to Persona A.

## 7.8 Caching strategy

| Layer | What | TTL | Invalidation |
|---|---|---|---|
| CDN | SPA static assets | 1 year, content-hashed filenames | New build |
| CDN | `index.html` | `no-cache` | Always revalidated |
| HTTP | Syllabus, subjects, papers metadata | `max-age=300, stale-while-revalidate=3600` | Content version bump |
| HTTP | Announcements | `max-age=60, stale-while-revalidate=600` | New change_event |
| HTTP | Anything student-specific | `private, no-store` | — |
| In-process LRU | Source registry, scheme rule sets, subject tables | 5 min | Admin write |
| Client (TanStack Query) | API reads | 60 s stale time | Mutation invalidation |
| Client (IndexedDB) | Profile, attendance, results | Indefinite | User action |

**As built in M5a:** the HTTP row for subjects and syllabus is implemented exactly
as specified (`public, max-age=300, stale-while-revalidate=3600`). The in-process
LRU is **not implemented** — measured query time is 0.075 ms (`23` §23.3.1), so a
cache would add invalidation bugs to solve nothing, which §23.10 explicitly
rejects. TanStack Query is **not used**; the reference hooks are a ~60-line
`useAsync` with `AbortController` cancellation and retry, and no library was
warranted for six read-only queries with no mutations to invalidate.

**Result-day spike strategy (`23`):** absorbed by CDN and stale-while-revalidate on the announcements endpoint, never by increasing the polling rate against the external source. Under load the source polling interval is *lengthened*, not shortened.

### 7.8.1 The first background worker (M5A.3)

Everything in GradTools answered inside the request until OCR. OCR is ~1.07 s
per page measured, so it cannot, and it is the first — and so far only —
workload that has earned a queue.

```
API                          worker
 │  POST /documents/:id/ocr    │
 ├─ enqueue (idempotent) ──────┤
 └─ 202, immediately           ├─ claim   FOR UPDATE SKIP LOCKED
                               ├─ rasterize, detect format, tesseract
                               ├─ persist sections + metadata
                               └─ complete
```

**The queue is a PostgreSQL table.** `FOR UPDATE SKIP LOCKED` gives atomic claim
and the table gives durable state, which are the two hard parts; a broker would
add an operational dependency and a second source of truth for no gain at this
scale (§7.11, docs/23 §23.10). Redis, BullMQ and friends remain rejected.

The API and the worker share the ingestion and OCR modules but neither imports
the other. Nothing in a request path can reach the worker, and the worker holds
no HTTP surface.

**Two processes, one image, one configuration:**

```
pnpm --filter @gradtools/api start    # API   — binds 127.0.0.1, serves HTTP
pnpm --filter @gradtools/api worker   # worker — binds nothing, serves nothing
```

Scale by running more workers. They coordinate through PostgreSQL alone, so
there is no leader election, no broker and nothing to configure between them —
which is the practical benefit of having put the queue in the database.

## 7.9 Scaling path

| Stage | Deployment |
|---|---|
| Experimental | 1 container (512 MB), managed Postgres free tier, CDN static |
| Stage 2 (10–30 users) | Same; measure rather than scale |
| Alpha (100–500) | 1 container (1 GB), paid Postgres with PITR, R2 for PDFs |
| Pilot (500–2000) | 2 API instances behind a load balancer — this is the point where the deferred Redis and the extracted worker become necessary (`06` §6.3), plus a read replica if measurement justifies it |

Scaling triggers are measurements, not projections. No horizontal scaling work happens before the single instance is demonstrably saturated.

## 7.10 Configuration and secrets

All configuration comes from environment variables, validated by a Zod schema at boot — the process **refuses to start** on a missing or malformed variable rather than failing at first use. Secrets live in the host's secret store, never in the repository, never in the client bundle, never in logs. See `25` §Environment variables.

## 7.11 Architectural constraints (binding)

1. No AI in any deterministic path: calculations, authorization, rate limiting, validation.
2. External integrations are always behind an adapter interface with at least one fixture-based test.
3. The rules engine has no I/O and no dependencies.
4. Client-computed values are never persisted without server recomputation.
5. Every externally-sourced record carries provenance; records without provenance are not published.
6. Publishing is blocked while a source is unhealthy.
7. Admin is a separate authorization plane with full audit.
8. No student PII in logs, metrics, error reports or analytics.

---

## 7.12 The shared source layer (M5)

Both content subsystems sit on one source model rather than each inventing its
own:

```
                 +--------------------------------------+
                 |  sources                             |
                 |  provenance . rights . robots gate   |
                 |  terms gate . verification . health  |
                 +----------------+---------------------+
                                  |
                 +----------------+---------------+
                 v                                v
        documents                        source_changes
        (M5A: papers, files)             (M5B: announcements)
                 |
                 v
        document_sections
```

**Why shared.** A document and an announcement ask the same two questions:
where is this from, and may we show it. Two separate answers drift, and rights
end up duplicated on every table that holds material, at which point one of them
is eventually wrong.

**The distinction the layer exists to preserve:** provenance is not rights.
Where something came from and whether we may redistribute it are independent
facts, kept in separate fields so attribution can never stand in for permission.

**Two independent gates guard access.** `robots_status` is a machine-readable
crawl policy; `terms_status` is a human judgement about reuse. Both must pass,
and passing one says nothing about the other. VTU demonstrates this precisely
(`14` section 14.3.1).

Fetching is deliberately not part of the adapter interface. `parse`, `normalize`
and `validate` are pure and fixture-testable; `fetch` is a gated capability that
re-reads the source row and refuses private destinations. Nothing in M5 calls
it, so the gate exists before the capability does.

### 7.12.1 Narrowed in M5.1

Two gates in the shared layer were correct in intent and too permissive in
expression, and both are now stated exactly:

- **`enabled` means automated outbound access.** It therefore requires
  `access_method = 'http_fetch'`, not merely "some access method". A
  `manual_upload` or `manual_entry` source describes a human handing us
  material; it is recorded so its provenance exists, and it is never polled.
- **Rights and validation are independent preconditions for visibility.**
  Permission to show a document says nothing about whether it is safe to show.
  Only `validated` or `extracted` documents can be `host` or `link`.

Both are database constraints, and both are mirrored in the application with a
specific refusal reason so a caller gets an explanation rather than a database
error. Where the two ever disagree the database wins: it is the one that cannot
be bypassed.

## 7.13 The student academic core (M6)

M6 makes the eight-semester degree the product, and it does so **without adding
a server**.

```
React ─► RepositoryBundle ─► LocalRepository ─► IndexedDB      (student data)
      └► reference API ────────────────────► Express ─► Postgres (reference data)
```

Three repositories were added to the existing bundle — `semesters`,
`semesterSubjects`, `backlogs` — following the shape the other four already
have. **No server-side student table was introduced**, and none was needed: a
student's degree is theirs, lives on their device, and the boundary that will
one day let them sign in is the bundle, not a schema (M6 §21).

The one genuinely new module is `apps/web/src/domain/academics.ts`. It is pure:
no React, no I/O, no clock. It ORGANISES results across semesters and computes
nothing — every SGPA, CGPA and percentage comes from
`@gradtools/academic-rules`, because a second implementation living in the web
app is precisely the drift the repository boundary exists to prevent.

## 7.14 Announcements and notifications (M7)

M7 adds an information layer with a deliberate split down the middle: **content
is server-side, relevance is client-side.**

```
  a source adapter          an operator
  (none enabled yet)        (loopback only)
          \                      /
           \                    /
        normalize.ts  — plain text, URL allowlist, content hash
                  |
            announcements  (Postgres)
              verification gate: unpublished until verified
                  |
        GET /api/v1/announcements   ← identical for every visitor
                  |
        ─────────── the device boundary ───────────
                  |
        domain/announcements.ts   relevance, deadline, priority
        domain/notifications.ts   read / unread / dismissed
                  |
            IndexedDB (notificationState, notificationPreferences)
```

**The server never learns who is asking.** The feed endpoint takes no branch, no
semester, no profile — not even an optional hint. Everything personal happens
after the response arrives, from data that never leaves IndexedDB. This is not a
privacy policy; it is a shape. A service that cannot receive student context
cannot profile from it, whatever it later decides it wants (§12.12).

**Notification state is not an entity on the server.** There is no student table
in Stage 1 (§7.13), so there is nowhere for a per-student read flag to live. It
lives on the device, which also means it does not synchronise across devices —
stated plainly to the student rather than quietly assumed.

### What was deliberately not built

| Not built | Why |
|---|---|
| A VTU source adapter | The source gate is closed pending terms review (`OQ-026`, `OQ-006`). No adapter, no scraper, no env switch |
| `GET /notifications`, `/unread-count` | Would require a server-side student identity that Stage 1 does not have |
| Web Push (VAPID, service worker) | Needs a server, a subscription store and an identity. The opt-in Notification API works only while the app is open, and the UI says so |
| A public write endpoint | Announcement creation is loopback-only and cannot publish (§10.14) |

## 7.15 The question-paper library (M8)

M8 adds no new subsystem. It adds a **view**.

```
        documents            ← the record that already existed (§7.12)
      + document_kind        ← is this a question paper at all
      + taxonomy columns     ← which subject, which sitting
            |
     GET /api/v1/question-papers      list, filter, search, page
     GET /api/v1/question-papers/:id  one paper
     GET /api/v1/question-papers/:id/file   host only, opaque id
            |
     ─────── the device boundary ───────
            |
     domain/papers.ts   actions, semester hint, display facts
            |
     the browser's own PDF viewer, in an iframe
```

**There is no second document model** (M8 §4). A question paper is a document;
its rights, its presentation mode, its validation state, its page count and its
extraction all already lived on `documents` and `extracted_papers`. Duplicating
any of it would have created two answers to the same question and a synchronisation
job to keep them agreeing.

**There is no second visibility rule.** The library reuses the M5.1 condition —
`presentation IN ('host','link') AND state IN ('validated','extracted')` — and
adds only the kind. A second rule is a second thing to get wrong, and the two
would drift the first time one of them was corrected.

### What was genuinely missing, and is what M8 added

Taxonomy. Nothing in the schema recorded which subject a paper belonged to or
which sitting it came from, so no interface could have let a student find a
paper by subject and year however it was written. Migration `0010` closes that
gap and closes nothing else (§9.17).

### The privacy shape is the same as M7's

The listing endpoint accepts filters and a search term and **no student
context** — no branch, no semester, no profile (§12.13). Which papers matter to
this student is decided in the browser, from a profile that never leaves it.

### What M8 deliberately did not build

| Not built | Why |
|---|---|
| A PDF renderer | The browser has one, and it is better than anything worth writing here (M8 §35) |
| A fetch or proxy for `link` papers | GradTools does not have those files, and pulling them through the server would make it a proxy for material whose rights nobody established (M8 §15) |
| Any authentication | Stage 1 is local-first; `private` is enforced by excluding it from every public query, not by a login (M8 §16, §44) |
| Semantic search, similarity, recommendations | M8 is a deterministic library. The intelligence milestone is separate and unstarted (M8 §3, §46) |
