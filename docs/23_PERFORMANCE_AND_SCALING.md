# 23 — Performance and Scaling

**Status:** Phase 1 draft
**Philosophy:** keep it simple until measurement proves complexity is necessary. The realistic Alpha scale is hundreds of users, not millions, and designing for the latter would guarantee never reaching the former.

---

## 23.1 The performance that actually matters

Persona A opens GradTools on a mid-range Android phone on patchy 4G, between classes, to answer one question. The binding constraints are **first load** and **perceived responsiveness**, not backend throughput.

| Priority | Target | Why |
|---|---|---|
| 1 | First contentful paint < 2.0 s on 4G | Below this, the student closes the tab |
| 2 | Calculator response < 50 ms | It must feel like a local tool, because it is one |
| 3 | Initial JS < 200 KB gzipped | Every 100 KB is roughly a second on a slow connection |
| 4 | API p95 < 300 ms | Only affects sync and content, not daily use |
| 5 | Throughput | Irrelevant at current scale |

**The architectural decision that dominates all of these:** the calculators, attendance and timetable run entirely client-side from local data (`07` §7.7). The most-used features have no network dependency at all, so their performance is unaffected by connectivity, server load or geography.

## 23.2 Frontend budget

| Resource | Budget | Enforcement |
|---|---|---|
| Initial JS (gzip) | 200 KB | CI fails on > 10% regression |
| Initial CSS | 30 KB | CI |
| Fonts | 2 files, ~60 KB, subset Latin | Review |
| Largest Contentful Paint | < 2.0 s (4G, mid-range) | Lighthouse CI |
| Cumulative Layout Shift | < 0.1 | Lighthouse CI |
| Interaction to Next Paint | < 200 ms | Lighthouse CI |
| Total transfer, first visit | < 400 KB | Review |

**Techniques applied:**
- Route-level code splitting; the dashboard and calculators are in the initial bundle, papers/syllabus/admin are lazy.
- Charts (`recharts`, the largest UI dependency) load only on screens that render one.
- Fonts self-hosted, subset, preloaded for the body weight, `font-display: swap`.
- Skeletons dimensioned to match final content, protecting CLS.
- Service worker caches the app shell, so repeat visits load from disk.
- No third-party scripts at all — no analytics, no tag manager, no embeds. This is worth more than most optimisations combined, and it is a privacy decision (`12` §7) paying a performance dividend.

**Explicitly not done:** server-side rendering, streaming, islands, prefetch-everything. The app is behind-the-fold utility with no SEO requirement; SSR would add a rendering tier for no measured user benefit.

## 23.3 Backend budget

| Operation | p50 | p95 |
|---|---|---|
| `GET /auth/me` | 20 ms | 60 ms |
| `GET /results` | 30 ms | 100 ms |
| `PUT /results/:semester` | 60 ms | 200 ms |
| `GET /papers` (paginated) | 40 ms | 150 ms |
| `GET /subjects/:code/module-priority` | 30 ms | 120 ms (precomputed) |
| `GET /announcements` | 20 ms | 80 ms (cached) |
| `POST /papers/upload` (accept only) | 200 ms | 800 ms |

Module priority is precomputed by a background job (`18` §11), never on request. Upload returns as soon as the file is stored; processing is asynchronous.

### 23.3.1 Measured in M5a — reference endpoints

Observed, not projected. Local Chromium-free measurement: Express on Node against
PostgreSQL 18 on loopback, 10 sequential requests per endpoint after one warm-up,
median reported. A loopback measurement excludes network latency and TLS, so
treat these as a **floor**, not a production forecast.

| Endpoint | Response bytes | p50 | slowest of 10 |
|---|---|---|---|
| `GET /health` | 15 | 2.3 ms | 23.4 ms |
| `GET /health/ready` | 45 | 2.6 ms | 3.1 ms |
| `GET /api/v1/universities` | 88 | 2.6 ms | 3.3 ms |
| `GET /api/v1/schemes` | 435 | 2.8 ms | 3.1 ms |
| `GET /api/v1/schemes/vtu-2022/rules` | 718 | 2.7 ms | 3.0 ms |
| `GET /api/v1/branches` | 98 | 3.3 ms | 4.3 ms |
| `GET /api/v1/colleges` | 11 | 3.6 ms | 4.7 ms |
| `GET /api/v1/subjects?scheme&branch&semester` | 5 049 | 4.3 ms | 108.9 ms |
| `GET /api/v1/subjects/BMATS101` | 501 | 3.4 ms | 5.1 ms |
| `GET /api/v1/subjects/BMATS101/syllabus` | 11 | 4.0 ms | 28.7 ms |

Database time for the heaviest query (10 subjects, filtered and sorted), from
`EXPLAIN (ANALYZE, BUFFERS)`:

```
Index Scan using subjects_scheme_id_branch_id_code_key on subjects
Planning Time: 6.821 ms
Execution Time: 0.075 ms
```

Three things this measurement settles:

1. **The query is an index scan, not a sequential scan**, which is what §23.4
   says the tests should target. Execution is 0.075 ms — the request time is
   almost entirely Node and serialisation, not the database.
2. **Nothing here needs pagination.** The largest response is 5 KB.
3. **Nothing here needs Redis.** Every endpoint is already an order of magnitude
   inside the §23.3 budget, and reference data is served with
   `Cache-Control: public, max-age=300, stale-while-revalidate=3600`, so repeat
   loads do not reach the origin at all. §23.10 rejects caching before
   measuring; this is the measurement, and it says no.

The occasional double-digit outlier is Node GC and connection scheduling on a
laptop, not query cost — the p50 and the 0.075 ms execution time are the honest
numbers. These figures are from a **single machine with 22 rows total**; they
say the architecture is not pathological, and nothing about scale.

### 23.3.2 Measured in M5A — document processing on real PDFs

Observed on the supplied corpus, through the shipped path (`pdftotext -layout
-enc UTF-8`). One machine, one sample; nothing extrapolated.

| Document | Pages | Bytes | Validation | Extraction | Chars | Sections |
|---|---|---|---|---|---|---|
| DBMS solutions | 36 | 1 139 328 | 1.05 ms | 202.5 ms | 33 847 | 476 |
| Biology for Engineers | 2 | 988 236 | 0.66 ms | 15.7 ms | 1 677 | 42 |
| Maths (`1BMATC101`) | 2 | 377 918 | 0.31 ms | 26.1 ms | 3 948 | 57 |
| Engineering science | 4 | 343 078 | 0.28 ms | 26.2 ms | 4 968 | 84 |
| Physics | 2 | 175 805 | 0.18 ms | 21.0 ms | 3 441 | 42 |
| Scan (`BCS403`) | 3 | 446 724 | 0.37 ms | 13.1 ms | 0 | 0 |
| Scan (`BUHK408`) | 4 | 1 698 916 | 1.09 ms | 16.1 ms | 0 | 0 |
| Scan (`BPWSK106`) | 6 | 2 182 138 | 1.41 ms | 12.6 ms | 0 | 0 |

Over HTTP end to end, including database writes: import 88–188 ms, process
67–138 ms.

**Validation is effectively free** — under 1.5 ms even for a 2 MB file, because
it never decompresses anything. **Extraction is dominated by process startup**:
a 2-page document costs ~16 ms and a 36-page document ~200 ms, so the marginal
cost per page is small against the fixed cost of spawning `pdftotext`.

**Conclusion: the synchronous path is right for experimental use.** The slowest
real document took ~200 ms, which is an acceptable request. §23.10 rejects
adding infrastructure before measuring, and this is the measurement: **no queue,
no worker pool, no BullMQ.** The trigger to revisit is a document type that
takes seconds — most plausibly OCR, which is not implemented and would be the
point at which asynchronous processing genuinely earns its place.

### 23.3.3 Measured in M5A.1 — OCR cost

10 scan-like documents, 33 pages, both engines local. Full method in docs/17
§17.11b.

| Stage | Tesseract | Windows OCR |
|---|---|---|
| Rasterize @300 DPI | 1 901 ms/page | (shared) |
| OCR | 1 111 ms/page | 588 ms/page |
| **Total** | **~3.0 s/page** | ~2.5 s/page |
| Peak memory | 126 MB | 197 MB |

At 150 DPI rasterization is ~3× faster and OCR ~1.5× faster, at comparable
quality — the source scans are low-resolution and upsampling adds noise.
Tuned, roughly **1.5–2 s/page**.

**This does not fit the synchronous path.** M5A measured real documents at
12–202 ms; a 4-page scan would take 6–12 s. OCR is precisely the trigger
`ED-41` named for revisiting background processing — and the first thing in this
project that genuinely justifies a queue, rather than one added because the
architecture mentions one.


| Practice | Detail |
|---|---|
| Indexes | Only for known query paths (`09` §9.8); partial indexes where the interesting rows are a small fraction |
| N+1 prevention | Joins or batched loads; a test asserts query counts on the heaviest endpoints |
| Connection pool | 10 connections, well under managed-tier limits |
| Slow query log | > 100 ms logged and reviewed |
| Pagination | Cursor-based; no `OFFSET` on large tables |
| JSONB | Only for provenance, evidence and preferences — never for anything queried by predicate |
| Data volume | Alpha: hundreds of students × 8 semesters × ~8 subjects ≈ tens of thousands of rows. **Trivially small.** |

At Alpha volume, Postgres will serve nearly everything from memory. The realistic risks are a missing index on a new query and an accidental N+1, not data volume — so those are what the tests target.

### 23.3.4 Measured in M5A.2 — OCR at the tuned configuration

20 scan-like documents, 65 pages, Tesseract 5.5.3, 150 DPI, format-appropriate
page-segmentation mode. Fully local.

| Stage | ms/page |
|---|---|
| Rasterize (`pdftoppm`, 150 DPI) | 444 |
| OCR (`tesseract`) | 630 |
| **End to end** | **1 074** |

Roughly **2.8× faster than the 300 DPI configuration** measured in M5A.1
(~3.0 s/page), at comparable or better quality — these scans are low-resolution
and upsampling adds interpolation noise, not information.

`eng+kan` costs more than `eng` alone: ~1.08 s/page against ~0.6 s/page on the
same paper. Language selection is therefore a per-document decision with a real
price, not a global setting.

**Still far outside the synchronous path.** A 4-page paper is ~4.3 s and a
6-page paper ~6.5 s, against the 12–202 ms that native text extraction costs.
OCR remains the trigger for background processing that `ED-41` named, and the
first thing in this project that genuinely earns a queue.

### 23.3.5 OCR as a background job (M5A.3)

Measured through the shipped pipeline, real scans, including database writes:
**3 documents, 13 pages, 18.6 s** — roughly 1.4 s/page end to end, consistent
with the 1.07 s/page engine measurement plus the format probe and persistence.

| Document | Pages | OCR ms | Sections |
|---|---|---|---|
| `BCS403` (poor scan) | 3 | 6 255 | 110 |
| `BKSKK107` (Kannada, `eng+kan`) | 6 | 8 290 | 56 |
| `BMATS101` (maths) | 4 | 4 007 | 8 |

`eng+kan` is visibly more expensive per page, which is why it is selected per
document rather than globally.

**This is why OCR is not in the request path.** A 6-page scan is ~8 s against
the 12–202 ms that native text extraction costs. `ED-41` named OCR as the
trigger for background processing before it existed; it now is one, and it
remains the *only* thing in this project that has earned a queue.

Throughput was measured on one machine with three documents and is not a
production figure.

**Concurrency, measured.** Two worker processes against one database drained 4
real OCR jobs, split 2/2, with `attempts = 1` on every job — no double
processing. Throughput scales by running more worker processes; they coordinate
through `SKIP LOCKED` with no broker and nothing to configure between them.

The idle loop costs one indexed query every 3 s per worker, and stalled recovery
one indexed UPDATE every 5 minutes. Neither is traffic worth economising on.

### 23.3.6 Positional extraction (M5A.4)

| Stage | Cost |
|---|---|
| `pdftotext -tsv` (4-page native paper) | 32 ms |
| `tesseract tsv` (one page) | 759 ms |
| TSV parse (1 042 tokens) | 2.4 ms |
| Line grouping (130 lines) | 2.1 ms |
| Format detection | 0.6 ms |
| Structural parser | 1.9 ms |

**The positional layer itself costs ~7 ms** — parse, group, detect and parse
structure together. A native 4-page paper is fully structured in **39 ms**, well
inside a request; a scan is dominated entirely by OCR and stays a background job.

TSV and hOCR cost the same to generate (759 vs 779 ms); hOCR is 2.1× the bytes
and needs an XML parser. Nothing in this layer needs optimising.

## 23.5 Caching

Full table in `07` §7.8. The performance-relevant points:

- Static assets are content-hashed and cached for a year.
- Reference content (syllabus, subjects, papers metadata) uses `max-age=300, stale-while-revalidate=3600` — near-instant repeat loads with bounded staleness.
- Announcements use `max-age=60, stale-while-revalidate=600`.
- Student-scoped responses are `private, no-store`; caching them would be a privacy defect for a marginal gain.
- In-process LRU holds the source registry, rule sets and subject tables — small, hot, rarely changing.
- The client caches API reads for 60 s via TanStack Query.

## 23.6 Result-day spike

The one predictable load event. Expected shape: 10–50× normal read traffic, concentrated on announcements, over a few hours.

| Mechanism | Effect |
|---|---|
| CDN + `stale-while-revalidate` | Most requests never reach the API |
| Precomputed, cached announcements | The API serves from cache |
| Read path independent of upstream | **User demand cannot increase source load** |
| Calculators client-side | Students computing SGPA generate zero traffic |
| Polling interval unchanged | Never shortened under load; lengthened if the source degrades |

**The invariant, restated because it is the one that matters:** a user request never triggers an upstream fetch. Only the scheduler does. This is verified by a load test (`22` §9) that asserts upstream request count stays flat while user traffic multiplies.

## 23.7 Document processing

The only genuinely expensive workload.

| Stage | Cost |
|---|---|
| Validation | < 1 s |
| Text extraction (text layer) | 1–5 s |
| OCR (scanned) | 30–120 s |
| Segmentation | < 1 s |
| Embeddings (~50 questions) | 2–10 s |
| Clustering per subject | < 5 s |

Handling: queued, never synchronous; concurrency of 1–2 so it cannot starve the API; per-job CPU, memory and wall-clock limits; bulk imports run off-peak. The user-visible operation is the upload accept, which is fast; everything after is asynchronous.

## 23.8 Scaling triggers

Nothing is scaled preemptively. Each row states the measurement that triggers the change.

| Trigger (measured) | Action |
|---|---|
| API p95 > 500 ms sustained | Profile; index or cache before adding capacity |
| Container memory > 80% sustained | Increase to 1 GB |
| PDF processing degrades API latency | Extract the worker to its own process (`06` §6.3) |
| Job throughput > 1/s sustained | Adopt Redis + BullMQ |
| Question corpus > 50k, or similarity p95 > 200 ms | Adopt pgvector |
| Database CPU > 70% sustained | Review queries, then upgrade the tier |
| Single instance saturated | Add a second instance behind a load balancer — this is the point at which session storage, rate-limit counters and job claiming must already be shared, which they are by design |
| Read-heavy load persists after caching | Read replica |

**The design already anticipates horizontal scaling without requiring it now:** sessions live in Postgres (not memory), rate limits count in Postgres (not memory), jobs are claimed with `SKIP LOCKED`. Adding a second instance is a configuration change, not a rewrite — which is why deferring the extra infrastructure is safe rather than reckless.

## 23.9 Cost envelope

| Stage | Monthly (approximate) |
|---|---|
| Experimental | ~$0 — free tiers throughout |
| Stage 2 | $0–10 |
| Alpha | $20–40 (API container, Postgres with PITR, object storage, domain, email) |
| Pilot | $40–80 |

Cost matters because this is a self-funded student project, and a design that only works on a $200/month platform is a design that stops.

**Cost-driven decisions already taken:** local embeddings rather than a per-query API (`19` §9), no vector database, no APM subscription, no managed queue, the hosted LLM disabled by default.

## 23.10 Anti-patterns rejected

| Rejected | Why |
|---|---|
| Microservices | Nothing scales independently; would multiply latency and failure modes |
| Kubernetes | One container |
| Multi-region | Users are in one state |
| Aggressive prefetching | Wastes mobile data — a real cost for the target user |
| Infinite scroll | Breaks back navigation and accessibility; pagination is better here |
| Client-side heavy computation | The heaviest client computation is an SGPA over ~8 rows |
| Premature denormalisation | Data volume does not justify it |
| Caching before measuring | Adds invalidation bugs to solve a problem that may not exist |

## 23.11 Monitoring

Tracked continuously (`24`): Core Web Vitals from real users where measurable without third-party scripts, API latency percentiles per endpoint, error rate, database connections and slow queries, job queue depth and oldest pending age, ingestion duration and success rate, bundle size per build.

**Alert thresholds:** API p95 > 1 s for 5 minutes; error rate > 5%; oldest pending job > 1 hour; any source unhealthy for 24 hours; database connections > 80% of pool.

Thresholds are deliberately loose. A solo operator paged by a noisy alert twice a week stops reading alerts, at which point monitoring is worse than none.

---

## 23.12 Measured in M5 — documents and sources

Observed on the development machine against synthetic fixtures. Median of
repeated runs. Synthetic PDFs are small and simple, so **extraction on real
scanned papers will be substantially slower** — these figures bound the pipeline
overhead, not real-world document cost.

| Operation | Input | Median |
|---|---|---|
| Validation | 1-page PDF, 624 B | 0.007 ms |
| Validation | 12-page PDF, 3,989 B | 0.024 ms |
| Validation | 120-page PDF, 37,458 B | 0.160 ms |
| Extraction (`pdftotext`, child process) | 1 page | 28.6 ms |
| Extraction | 12 pages | 30.3 ms |
| Extraction | 120 pages | 48.7 ms |
| Adapter parse + normalize + validate | 3-item fixture | 0.020 ms |
| Change detection | 3 items | 0.0007 ms |

| Endpoint | Response bytes | p50 |
|---|---|---|
| `GET /api/v1/sources` | 1,857 | 3.4 ms |
| `GET /api/v1/sources/:id` | 936 | 3.0 ms |
| `GET /api/v1/documents` | 11 (empty) | 2.5 ms |

**What the numbers settle.**

1. **Validation is free.** Sub-millisecond even at 120 pages, because it never
   decompresses and never opens a parser. There is no case for moving it off the
   request path.
2. **Extraction is dominated by process startup**, not by page count — 1 page
   and 120 pages differ by 20 ms while the floor is ~28 ms. Batching would help
   far more than parallelism if extraction ever becomes hot.
3. **No queue is warranted yet.** §23.10 rejects infrastructure added before
   measurement. At ~30 ms per document there is nothing to defer, and adding
   BullMQ would buy retry semantics for a workload with no backlog. The trigger
   to revisit is real scanned papers with OCR, where per-document cost rises by
   orders of magnitude — that is when a queue earns its place (M5 §23).
4. **12 pages of extracted text is 627 characters across 12 sections**, so
   `document_sections` rows are small and per-document row counts are modest.
