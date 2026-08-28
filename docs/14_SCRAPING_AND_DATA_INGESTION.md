# 14 — Scraping and Data Ingestion

**Status:** Phase 1 draft
**Core principle:** ingestion is an **isolated, replaceable subsystem**, never the architecture's centre. GradTools must be fully useful with every external source disabled.

---

## 14.1 Position

The naive version of this product is "a VTU scraper with a UI." That design fails in three predictable ways: the source changes and the product breaks; the source disallows automated access and the product becomes indefensible; the source is unavailable on result day precisely when demand peaks.

GradTools is instead designed so that:
- **Every deterministic feature works with zero external sources** — calculators, attendance, timetable, results entry, backlogs.
- **External data is additive**: announcements, papers, syllabus reference data.
- **Every source sits behind an adapter** with a uniform contract, so replacing one is a module swap.

If every source in the registry were disabled tomorrow, GradTools would lose the announcements feature and nothing else.

## 14.2 The adapter pipeline

```
ExternalSource (registry row)
      │
      ▼
 ┌─────────┐  ┌────────┐  ┌────────────┐  ┌───────────┐  ┌───────────┐
 │ Fetcher │─►│ Parser │─►│ Normalizer │─►│ Validator │─►│ Publisher │
 └─────────┘  └────────┘  └────────────┘  └───────────┘  └───────────┘
   robots        source-     canonical       schema +       write +
   check         specific    shapes          sanity +       change_event
   timeout       HTML→data                   anomaly        + provenance
   retry                                        │
   backoff                                      │ FAIL
   rate limit                                   ▼
   conditional GET                    source → unhealthy
   raw snapshot                       publishing BLOCKED
                                      response saved as fixture
                                      operator alerted
```

Each stage is a pure-ish function with a typed input and output, so each is independently testable against fixtures. The `Fetcher` is the only stage performing I/O; `Parser`, `Normalizer` and `Validator` are pure and run against recorded fixtures in CI without network access.

### Adapter contract

```
interface SourceAdapter {
  key: string
  kind: 'announcements' | 'syllabus' | 'papers' | 'calendar'
  parserVersion: string

  fetch(ctx): Promise<RawResponse>        // honours timeout, rate limit, conditional GET
  parse(raw: RawResponse): ParsedItem[]   // pure
  normalize(items: ParsedItem[]): NormalizedItem[]   // pure
  validate(items: NormalizedItem[]): ValidationResult // pure
}
```

**Rules binding on every adapter:**
1. `parse`, `normalize` and `validate` are pure — no I/O, no clock, no randomness — so they are fully fixture-testable.
2. `parserVersion` is stamped on every produced record, making it possible to identify all data produced by a broken parser version.
3. An adapter never writes to the database. Only the shared `Publisher` writes, and only after validation passes.
4. Every adapter ships with at least one captured fixture and a golden-output test.

## 14.3 Source registry

Sources are database rows, not code constants, so an operator can disable one without a deploy (`09` §9.7).

| Field | Purpose |
|---|---|
| `enabled` | **Defaults to false** |
| `official` | Whether this is a university source or a third party |
| `robots_checked_at`, `robots_allows_path` | The recorded legal/ethical gate |
| `terms_reviewed_at`, `terms_note` | Human review of the site's terms |
| `poll_interval_seconds`, `rate_limit_per_hour` | Conservative throttles |
| `health`, `consecutive_failures` | Operational state |
| `parser_version` | Which adapter version is active |

**The gate is a database constraint, not a policy document:**

```sql
CONSTRAINT source_enable_requires_robots_check CHECK (
  enabled = false OR (robots_checked_at IS NOT NULL AND robots_allows_path = true)
)
```

No code path, admin mistake or future contributor can enable a source that robots.txt disallows. This is the mechanism that enforces §14.7 permanently rather than by good intentions.

### 14.3.1 As built in M5

Implemented in migration `0004` as `sources`, with the gate widened: `enabled`
requires robots **and** terms **and** verification **and** a real access method.

```sql
CONSTRAINT source_enable_requires_all_gates CHECK (
  enabled = false
  OR (robots_status = 'allowed'   AND robots_checked_at IS NOT NULL
      AND terms_status = 'permitted' AND terms_reviewed_at IS NOT NULL
      AND verification = 'verified'  AND verified_at IS NOT NULL
      AND access_method <> 'none')
)
```

**Why terms became part of the constraint rather than a note.** The two gates
answer different questions and can disagree, and VTU's own hosts demonstrate it.
Both `robots.txt` files were fetched on **2026-08-24**:

| Host | robots.txt | Gate result |
|---|---|---|
| `results.vtu.ac.in` | `User-agent: *` / `Disallow: /` | **Disallowed.** Seeded `prohibited`, permanently unenclosable |
| `vtu.ac.in` | disallows only `/wp-admin/` | **Allowed** — announcements are not refused by robots |

`vtu-announcements` is nonetheless **disabled**, because its terms of use have
never been reviewed (`OQ-006`). A machine-readable crawl policy is not a licence
to reuse content. Had the gate been robots-only, this source would have been
enableable on the strength of a check that answers a different question.

A status also cannot be asserted without its evidence date
(`source_robots_status_needs_check`, `source_terms_status_needs_review`), so
"allowed" always carries a record of when that was established.

**Fetching is not an adapter's to perform.** `parse`, `normalize` and `validate`
are pure and live on the adapter; `fetch` lives in `sources/fetch.ts`, consults
the source row, and additionally refuses any destination resolving to a private
or loopback address (SSRF, `13` §T-11). Nothing in M5 calls it — the gate exists
before the capability does.

## 14.4 Fetching

| Control | Value | Reason |
|---|---|---|
| Timeout | 15 s connect, 30 s total | Never hang a worker |
| Retries | 2, only on 5xx / network errors | 4xx is not retryable |
| Backoff | Exponential with full jitter: 30 s, 120 s | Avoids synchronised retry storms |
| Rate limit | Per-source, default 4 requests/hour | Deliberately far below anything burdensome |
| Concurrency | 1 request per source at a time | Never parallelise against one host |
| User agent | Identifies the project and provides a contact URL | Honest identification; an operator can contact us or block us |
| Conditional GET | `If-None-Match` / `If-Modified-Since` | 304 responses cost the source almost nothing |
| Response cap | 10 MB | Prevents a hostile or broken response exhausting memory |
| Robots re-check | Every 7 days, before the first fetch of a cycle | A site can change its policy |
| Raw snapshot | Stored for 30 days | Reproducible debugging and fixture capture |

**Never:** parallel request floods, ignoring 429 or `Retry-After`, retrying a 403, rotating user agents or IPs to evade limits, or fetching during a detected outage at the source.

**On 429 or 503 with `Retry-After`:** honour it exactly, mark the source degraded, and lengthen the interval. Under high user demand the polling interval is *increased*, never decreased (`14` §5).

## 14.5 Rate limiting and result-day behaviour

Result day is the moment of maximum user demand and maximum temptation to poll harder. The policy is the opposite:

| Signal | Response |
|---|---|
| User traffic spike | Serve from CDN and cache; **do not change polling** |
| Users repeatedly refreshing | Cached response; no additional upstream request |
| Source slow | Lengthen the interval, mark degraded |
| Source returning 429 | Honour `Retry-After`, back off further |
| Source down | Serve last valid data with a staleness label; send no notifications |

**Never scale by sending more requests to the source.** Additional user load must never translate into additional upstream load. Architecturally this is guaranteed because user requests read from our database, never from the source; only the scheduler causes an upstream fetch.

## 14.6 Change detection

```
fetch → normalize → canonical serialization → SHA-256 → compare with last hash
   │
   ├─ identical  → no change; record a successful run and stop
   └─ different  → per-item diff → classify (new / modified / removed)
                 → validate
                 → anomaly checks
                 → publish + create change_event
```

**Canonicalisation before hashing** (sorted keys, normalised whitespace, timestamps and session IDs stripped) prevents cosmetic page changes from producing phantom change events. Without it, a rotating banner or a "generated at" footer creates a change event on every poll.

**Anomaly checks that block publication:**
- More than 50% of items changed at once → likely a template change, not real news
- Item count dropped by more than 50% → likely a parse failure returning partial results
- Zero items where the previous run had many → parse failure
- A "new" item dated more than 90 days in the past → parse or date-handling error

Each anomaly marks the source degraded and routes to operator review rather than publishing.

## 14.7 Legal and ethical boundaries

### The verified robots.txt position

Checked on 2026-08-23 as part of this documentation phase:

| Host | `robots.txt` | Consequence |
|---|---|---|
| `results.vtu.ac.in` | `User-agent: *` / `Disallow: /` | **All automated access is disallowed.** No adapter may be built or enabled for this host. |
| `vtu.ac.in` | `Disallow: /wp-admin/`, `Allow: /wp-admin/admin-ajax.php` | General crawling is permitted; the announcements adapter is buildable |

**This is the single most consequential finding of Phase 1.** The human's decision (`DEC-004`) selected "automated polling of public VTU pages from the start." That decision is executable for `vtu.ac.in` announcements and **is not executable for the results portal.**

### What this means concretely

| Capability | Status |
|---|---|
| Polling public announcements on `vtu.ac.in` | **Permitted** — subject to the terms review in §14.8 |
| Polling `results.vtu.ac.in` for anything | **Prohibited** — robots.txt disallows all paths |
| Per-USN automated result retrieval from that host | **Prohibited** — same, and additionally it would require submitting a student's identifiers to a portal on their behalf |
| Student manually entering or pasting their own result | **Unaffected** — this is the student using their own data, and it is the primary results path (FR-040) |
| A future *authorized* result integration | **Out of current scope, not permanently excluded.** It would be a new `ResultProvider` implementation (`15` §15.5.1) and would require documented authorization. Every prohibition below still applies to it |

The product design already assumed manual result entry as the primary path, so this finding removes an intended enhancement rather than a core feature. `03/UF-08b` turns the constraint into a stated trust position.

**Note on the `ResultProvider` interface:** its existence is an architectural hedge so that authorized integration remains possible without a rewrite. It is **not** a permission structure. A provider that scraped a disallowed host would violate the prohibitions below exactly as a source adapter would, and the robots constraint in `09` §9.7 applies to any provider performing network fetches.

### Absolute prohibitions

Regardless of any future decision, GradTools will never:

- Bypass, solve or outsource a CAPTCHA
- Collect, store, transmit or proxy a student's university portal credentials
- Submit a student's identifiers to a university or third-party portal on their behalf as an automated action
- Evade rate limits, IP blocks, user-agent blocks or any other technical restriction
- Ignore `robots.txt` on any host
- Describe unofficial data as official
- Present scraped data without provenance

These are not tunable settings. A future request to relax any of them is refused, and the reason is that each one either breaks the law-adjacent boundary, endangers students directly, or destroys the institutional case the product exists to build.

### Uncertain access → stop and ask

If a source's permissibility is ambiguous — ambiguous robots directives, terms that neither permit nor forbid automated access, or content of unclear provenance — the adapter is **not enabled** and the question is raised with the human. Ambiguity resolves to "off", never to "probably fine."

## 14.7.1 Three categories of access — never conflated

The most common reasoning error in scraping is treating "publicly reachable" as "permitted to automate". GradTools classifies every source into exactly one of three categories, and the category is stored on the source row.

| Category | Meaning | Automated access | Example |
|---|---|---|---|
| **1. Official / authorized** | A documented agreement or a published interface intended for programmatic use | **Permitted**, within the terms of that authorization | None today. No VTU API or agreement exists (`15` §3) |
| **2. Publicly accessible information** | A human can open it in a browser without authentication | **Not automatically permitted.** Public readability is a statement about *access control*, not about *automation rights* | `vtu.ac.in` announcement pages |
| **3. Automated access not verified as permitted** | Anything where robots directives, terms or intent have not been affirmatively checked | **Prohibited.** The default for every source | Any source before its review is recorded |

**Every source starts in category 3.** Moving a source to category 2 requires a recorded robots check *and* a recorded terms review (§14.8). Category 1 requires documented authorization.

**A crawler is never described as "safe" because a page is publicly reachable.** The permitted set is determined by robots directives, terms of use, rate, purpose and the absence of technical restrictions — publicness is one input among several, and on its own it establishes nothing.

`results.vtu.ac.in` illustrates the distinction precisely: the site is publicly reachable, and its `robots.txt` disallows all automated access. Public, and not permitted.

## 14.8 Terms of use review

`robots.txt` is necessary but not sufficient. Before any source is enabled, a human records:

| Item | Recorded in |
|---|---|
| Date of review | `external_sources.terms_reviewed_at` |
| Whether the terms address automated access | `terms_note` |
| Whether the content is public and non-personal | `terms_note` |
| Whether the material carries a licence or copyright notice | `terms_note` |
| Rate and interval considered acceptable | `poll_interval_seconds` |

**Not yet done for `vtu.ac.in`.** The robots.txt check is complete; the terms review is not. This is `32/OQ-006` and is a prerequisite for enabling the announcements adapter in Milestone 6 — it is a human task, not a code task.

## 14.9 Failure handling

| Failure | Detection | Response |
|---|---|---|
| Network / timeout | Fetcher | Retry with backoff; after 3 consecutive runs → degraded |
| 4xx | Fetcher | No retry; mark unhealthy; alert operator |
| 429 / 503 | Fetcher | Honour `Retry-After`; lengthen interval; degraded |
| Parse throws | Parser | Save the response as a fixture; mark unhealthy; **block publication** |
| Parse returns empty | Validator | Anomaly check; block publication |
| Validation fails | Validator | Block publication; queue for review |
| Anomaly threshold hit | Validator | Block publication; queue for review |
| Publish fails | Publisher | Transaction rolls back; job retried; nothing partially published |

### The parser-broke workflow (binding)

```
1  Parser fails or validation rejects
2  Source → unhealthy; publishing BLOCKED (no partial, no guessed data)
3  The exact failing response is saved as a fixture in fixtures/
4  Operator sees the failure in the admin dashboard with a diff against the last good snapshot
5  Parser is fixed; the captured fixture becomes a PERMANENT regression test
6  parser_version is incremented
7  Source restored to healthy only after the fixture test passes
```

Step 5 is what makes the ingestion subsystem improve rather than merely churn: every real-world break becomes a test that prevents its own recurrence.

**During unhealthy state, users see** the last valid data with its original timestamp and a staleness banner. They never see stale data presented as fresh, and they never see fabricated data.

## 14.10 Provenance

Every published external record carries, embedded on the record rather than joined:

```json
{
  "source_id": "…",
  "source_name": "VTU announcements",
  "source_url": "https://vtu.ac.in/…",
  "official": true,
  "retrieved_at": "2026-08-23T14:32:11Z",
  "extraction_method": "html_parser",
  "parser_version": "vtu-ann-v3",
  "validation_state": "validated",
  "content_hash": "sha256:…"
}
```

**A record without complete provenance is not published.** The provenance is surfaced in the UI (`04` §4.10), so any claim GradTools makes is one tap from the original document.

Provenance is embedded rather than joined so it survives the source row being disabled or removed — a historical record must remain explicable years later.

## 14.11 Caching

| Layer | Purpose |
|---|---|
| Conditional GET | Reduces load on the source; a 304 is nearly free for them |
| Raw snapshot (30 days) | Reproducible debugging and fixture capture |
| Normalized records in Postgres | What users read — **users never trigger an upstream fetch** |
| HTTP cache + CDN | Absorbs user-facing spikes |

The critical property: **the read path from a user never touches the external source.** This decouples user demand from upstream load entirely, which is what makes result-day behaviour safe.

## 14.12 Testing

| Test | Method |
|---|---|
| Parser correctness | Golden fixtures → expected normalized output |
| Parser robustness | Truncated, empty, malformed and encoding-mangled HTML must fail cleanly, never produce partial data |
| Change detection | Two fixtures differing in one item → exactly one change event |
| Canonicalisation | Cosmetically-different-but-equivalent pages produce an identical hash |
| Anomaly detection | A fixture with 90% of items changed must block publication |
| Rate limiting | Verifies the limiter under concurrent job attempts |
| Robots enforcement | Attempting to enable a disallowed source must fail |
| Backoff | Simulated 429 responses produce the correct delays |

**No test makes a real network request.** The CI suite runs entirely against fixtures, which is both faster and a guarantee that CI never accidentally hits an external source.

## 14.13 Scheduling

| Source kind | Default interval | Rationale |
|---|---|---|
| Announcements | 6 hours | Announcements are not minute-critical; 4 requests/day is negligible load |
| Syllabus / reference | Manual only | Changes once per scheme revision |
| Papers | Manual only | Operator-driven import |
| Results | **Never** | No adapter exists (§14.7) |

Jitter is added to every scheduled run so requests do not land on the hour, and the scheduler skips a run if the previous one is still executing.

**During Stage 1 (experimental), all sources remain disabled.** The experiment runs on seeded and manually-entered data (`15` §7). Ingestion is enabled no earlier than Milestone 6, and only after §14.8's terms review.

## 14.14 What ingestion must never do

1. Write to student data. Ingestion produces reference and announcement content only.
2. Publish unvalidated data. Enforced by database constraint.
3. Trigger a notification from an unvalidated or unpublished event.
4. Increase request rate in response to user demand.
5. Present third-party data as official.
6. Continue publishing while unhealthy.
7. Store data without provenance.
8. Run against a source whose robots check is missing or negative.

---

### 14.3.2 Narrowed in M5.1

The enable gate now requires `access_method = 'http_fetch'` rather than
`access_method <> 'none'`.

`enabled` is a statement about **automated outbound access**, and only one
access method is automated. A `manual_upload` source describes a student handing
us a file; a `manual_entry` source describes an operator typing a document in.
Both are worth recording as provenance, and neither is something to poll.

`checkSourcePermission` refuses them with `access_method_not_fetchable` — a
distinct code from `source_disabled`, because a manual source is not a source
someone forgot to switch on. It is not the kind of thing a fetch applies to.

## 14.15 Announcement ingestion (M7)

### The VTU source remains disabled

**No VTU announcement source was enabled, and none may be enabled by
configuration.** The registry row stays:

| Field | Value |
|---|---|
| `enabled` | `false` |
| `terms_status` | `unknown` |
| `access_method` | `none` |

Blocked on `OQ-026` and `OQ-006` (terms review). This is enforced, not merely
documented: the source gate refuses to enable a source whose terms are unknown,
and a test asserts that attempting it throws. There is **no environment switch,
no direct scraping path, and no frontend fetch of vtu.ac.in** anywhere in the
codebase.

M7 therefore built the ingestion *framework* and verified it against operator
entries and demo fixtures. **No real VTU announcement has ever been ingested,
and no claim to the contrary appears in this repository.**

### What ingestion does when a source is one day enabled

1. An adapter fetches (network lives here and nowhere else).
2. `normalizeAnnouncement` reduces content to plain text, checks the link
   against the allowlist, parses timestamps, computes a content hash (§13.15).
3. `upsertAnnouncement` resolves identity — `(source_id, external_id)` first,
   then `(source_id, content_hash)`.
4. The row is written as `draft` / `unpublished`. **Fetching never publishes.**

### Unchanged, changed, new

| Case | Effect |
|---|---|
| Seen before, identical | Only `last_seen_at` moves. Verification stands — nothing was said differently |
| Seen before, content changed | Updated in place **and verification withdrawn**: `verification = 'draft'`, `verified_at = NULL`, `publication = 'unpublished'` |
| Not seen before | Inserted as `draft` / `unpublished` |

### Dates are read, never inferred

A deadline exists only when a real timestamp was parsed. **"Apply soon" is not a
deadline.** An unparseable date is absent rather than guessed at, because an
invented deadline is worse than no deadline — a student would plan around it.

### Nothing here is AI

No model, no embedding, no classification. Category comes from the source or the
operator; priority is computed from timestamps (§20.12). Urgency is never
derived from wording.

## 14.16 M8 fetched nothing

The question-paper library is a **read-only view over documents that were
already there** (§7.15). It added no adapter, no scheduler, no fetch and no
source.

**No VTU source was enabled, and none may be.** `vtu.ac.in` remains blocked on
the terms review (`OQ-006` / `OQ-026`); `results.vtu.ac.in` remains
`prohibited` by its own robots.txt. The gate is unchanged and untouched.

**No third-party paper site was contacted.** The demo fixtures link to
`example.org`, deliberately: pointing a fixture at a real paper site would be
presenting somebody else's material as part of this library, which is the exact
thing the rights model exists to prevent (M8 §43).

### The one new source row is not a fetch target

`seed:demo-papers` inserts a `demo-question-papers` source so the synthetic
papers have honest provenance. It is `access_method = 'none'`, `enabled =
false`, and nothing polls it. It exists to be *attributed*, not to be read.

### Where a real paper would enter

Unchanged: the private import route, which takes **bytes and not a URL**, so it
cannot be turned into an SSRF gadget by any input (§14.9). A paper reaching the
library from there would still need a rights determination it cannot have while
`OQ-008` is open.
