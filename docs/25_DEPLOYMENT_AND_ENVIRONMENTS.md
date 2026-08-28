# 25 — Deployment and Environments

**Status:** Phase 1 draft — design only, **no deployment configuration is created in Phase 1**
**Consistent with:** `06` (React SPA + Express API + Postgres, long-running container) and `07` (modular monolith).

---

## 25.1 Environments

| Environment | Purpose | Data | Who |
|---|---|---|---|
| **local** | Development | Seeded demo data | Developer |
| **experimental** | Stage 1 public experiment | Seeded + user-entered; **all demo data clearly labelled** | Lead + a few students |
| **staging** | Pre-release verification | Anonymised or synthetic | Lead |
| **alpha** | Stage 3 release | **Real student data. No demo data ever.** | Cohort + college demo |
| production | Future | — | Not yet defined |

**Hard rule:** the alpha environment contains **no demo or sample data**. The `DEMO` markers exist so demo data is unmistakable (`09` §9.11), and a startup check refuses to boot the alpha environment if any record carries a demo marker. A screenshot of fake results circulating out of context is the fastest way to lose institutional credibility (`15` §7).

## 25.2 Topology

```
┌──────────────────────┐
│ Static host + CDN    │   apps/web build output
│ (Netlify / Vercel /  │   immutable, content-hashed assets
│  Cloudflare Pages)   │
└──────────┬───────────┘
           │ HTTPS
           ▼
┌──────────────────────┐
│ API container        │   apps/api — Express + scheduler + workers
│ (Railway / Fly /     │   1 instance, 512 MB → 1 GB
│  Render)             │   includes pdftotext + tesseract binaries
└─────┬──────────┬─────┘
      ▼          ▼
┌──────────┐  ┌──────────────┐
│ Managed  │  │ Object store │
│ Postgres │  │ (R2 / B2)    │
│ + PITR   │  │              │
└──────────┘  └──────────────┘
```

**Provider selection is not final** (`32/OQ-020`). The requirements each must meet:

| Component | Non-negotiable requirements |
|---|---|
| Static host | CDN, custom domain, TLS, immutable asset caching, deploy previews |
| API host | **Long-running process** (not serverless — see `06` §6.2), custom Docker image (for `pdftotext`/`tesseract`), ≥ 512 MB, secret store, zero-downtime deploy |
| Postgres | Managed backups, PITR, connection pooling, and **no aggressive idle-suspend** — the cron scheduler means the API is never truly idle, and an autosuspending database would produce cold-start failures on scheduled jobs |
| Object store | S3-compatible, lifecycle rules, **a separate serving origin** for untrusted documents (`13` §T-03) |

The Postgres idle-suspend and object-store origin requirements are the two most likely to eliminate an otherwise attractive free tier, and both are listed in `06` §6.8 as validation tasks before implementation.

## 25.2.1 Hosting evaluation and recommendation (`OQ-020`)

Evaluated against the actual architectural requirement, not against price alone: a persistent process, PostgreSQL, in-process background jobs and cron, PDF/OCR workloads, future workers, scheduled ingestion, possible local model inference, backups, observability, cost at experimental scale, and a straightforward Alpha upgrade path.

**The disqualifying requirement is the scheduler.** GradTools runs `node-cron` inside the API process. Any host that suspends an idle container — and any database that auto-suspends on idle — breaks scheduled ingestion in a way that is intermittent and hard to diagnose. This eliminates several otherwise attractive free tiers, including free plans that spin down after a period of inactivity.

*Pricing below is indicative, gathered 2026-08 from secondary comparison sources and **NOT VERIFIED** against provider pricing pages. Confirm before committing.*

| | **Option A — Railway** | **Option B — Render** | **Option C — Fly.io** |
|---|---|---|---|
| Model | Per-second metered on a small plan fee | Fixed instance tiers, workspace fee for teams | Pure pay-as-you-go per second |
| Entry cost | ~$5/mo Hobby (credits included) | ~$7/mo Starter (always-on); free tier **spins down** | ~$2–5/mo for a small always-on VM |
| Free tier | None | Yes, but **disqualified** — idle spin-down breaks cron | None for new accounts |
| Persistent process | Yes | Yes (paid tiers) | Yes |
| Docker image | Yes | Yes | Yes |
| Managed Postgres | One-click, included in usage; **single node, no PITR** | Separate paid add-on with backups | Available, more manual setup |
| Ops burden (solo operator) | **Lowest** | Low | **Highest** — most configuration |
| Best at | Fastest path from zero to running | Predictable bills, complete PaaS | Cheapest steady-state, global regions |

### Recommendation

**Experimental (Stage 1): Railway Hobby**, API container plus its managed Postgres.

Reasoning: the experimental website's binding constraint is *operator time*, not money. The difference between the options is a few dollars a month; the difference in setup and debugging time is hours. Railway gives a persistent container, a Docker build, a Postgres instance and a secret store with the least configuration, which is the correct optimisation while the goal is validating a product rather than running infrastructure.

**Alpha (Stage 3): re-evaluate, expecting to move Postgres to a provider with PITR.** Railway's bundled Postgres being single-node without point-in-time recovery is acceptable for an experiment whose data is also local-first, and **not** acceptable for Alpha, which holds real student records (`24` §8 requires PITR plus a rehearsed restore). The likely Alpha shape is the API on Railway or Render, with Postgres on a managed provider offering PITR.

### Why deferring the Alpha decision is safe

The migration cost is deliberately low, and that is an architectural property rather than an assumption:

- The API is a **Docker image** — portable across all three options unchanged.
- The database is reached by a **standard `DATABASE_URL`** — no provider-specific client, no proprietary extension (`pgvector` is deferred, `09` §9.2).
- Object storage is **S3-compatible** and already independent of the API host.
- The frontend is **static files on a CDN**, independent of all of it.
- Configuration is **environment variables validated at boot** (§25.4), so moving hosts is a matter of re-entering values.

Nothing in the stack binds to a vendor API. Choosing a host now is therefore a reversible decision, which is exactly why it should not consume more deliberation than it already has.

**Not doing:** deploying anything. This is a recommendation for M3, pending approval.

## 25.3 Containerisation

The API ships as a Docker image because it needs system binaries that no buildpack provides.

```dockerfile
# Multi-stage: build with full toolchain, run with minimal surface
# Runtime stage requirements:
#   - node:22-slim base
#   - poppler-utils      (pdftotext)   REQUIRED
#   - tesseract-ocr      (OCR)         OPTIONAL — feature degrades if absent
#   - non-root user
#   - HEALTHCHECK hitting /health
#   - only production dependencies
```

Image size target < 400 MB. The ONNX embedding model (~90 MB) is baked into the image rather than downloaded at boot, so a cold start does not depend on network access to a model host.

## 25.4 Configuration

All configuration via environment variables, **validated by a Zod schema at boot**. The process refuses to start on a missing or malformed variable rather than failing later at first use.

| Variable | Purpose | Secret |
|---|---|---|
| `NODE_ENV`, `APP_ENV` | Runtime and environment identity | No |
| `PORT` | Listen port | No |
| `DATABASE_URL` | Postgres connection | **Yes** |
| `WEB_ORIGIN` | CORS allowlist | No |
| `SESSION_COOKIE_DOMAIN` | Cookie scope | No |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Magic-link delivery | **Yes** / No |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push | Partly |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Object storage | **Yes** |
| `DOCUMENT_SERVE_ORIGIN` | Separate origin for untrusted files | No |
| `ADMIN_EMAILS` | Operator allowlist | No |
| `SENTRY_DSN` | Error reporting | Partly |
| `LLM_ENABLED`, `LLM_API_KEY` | Optional explanations — **default off** | **Yes** |
| `INGESTION_ENABLED` | Master switch for all source polling — **default off** | No |

Client-side variables are prefixed `VITE_` and contain **no secrets**; a build-time check fails if any non-prefixed variable is referenced in client code, and a second check scans the built bundle for known secret patterns.

**`INGESTION_ENABLED` defaults to off in every environment.** Combined with the per-source `enabled` flag and the robots constraint (`09` §9.7), three independent things must be true before any external request is made. This is deliberate belt-and-braces on the highest-consequence external behaviour.

### 25.4.1 HOST — a security control, not a convenience (M5A)

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | The interface the API binds to |
| `ALLOW_PUBLIC_BIND` | unset | Deliberate override for a deployment that authenticates the private routes some other way |
| `DOCUMENT_STORAGE_ROOT` | `./.local-storage` | Object-store root. Must be outside the repository and outside any served directory |

Stage 1 has no authentication, so the private document routes are
unauthenticated by design. The bind address is what keeps them off the network,
and **CORS is not a substitute** — it is a browser policy that `curl` ignores.

`assertSafeExposure()` runs before the server listens and **refuses to start**
on a non-loopback `HOST` unless `ALLOW_PUBLIC_BIND=true` is set on purpose. A
misconfiguration is therefore a loud startup failure, consistent with how the
rest of §25.4 treats configuration.

**Production must set `HOST` explicitly** rather than inheriting a default. The
loopback default is correct for local and experimental use; it is not a
deployment strategy, and silently assuming localhost in production would hide a
decision that ought to be made.

### 25.4.2 The OCR worker process (M5A.3)

A second process, from the same image and the same configuration:

```
pnpm --filter @gradtools/api start    # the API
pnpm --filter @gradtools/api worker   # the OCR worker
```

The worker binds nothing and serves nothing, so `HOST` does not apply to it —
but it reads the same configuration and fails identically on a misconfiguration,
which is why `assertSafeExposure` runs there too.

| Variable | Purpose |
|---|---|
| `TESSERACT_BIN` | Path to `tesseract`, when not on `PATH` |
| `PDFTOPPM_BIN` | Path to `pdftoppm`, when not on `PATH` |
| `TESSDATA_PREFIX` | Directory holding `eng.traineddata` and `kan.traineddata` |
| `DOCUMENT_STORAGE_ROOT` | Shared with the API — both processes need the same object store |

**The worker must reach the same object store as the API.** With the local
filesystem driver that means the same path; production storage is `OQ-027` and
undecided.

Scale by running more worker processes. They coordinate through PostgreSQL, so
there is no leader, no broker and nothing to configure between them.

## 25.5 Secrets

- Stored only in the host platform's secret manager. Never in the repository, never in the image, never in logs, never in the client bundle.
- `.env` is gitignored; `.env.example` is committed with keys and no values.
- Secret scanning runs pre-commit and in CI.
- **Rotation:** documented procedure per secret. Note that no secret currently protects stored personal data — removing DOB (`DEC-008`) eliminated the only application-managed encryption key and its rotation migration. Rotating any secret listed above is a config change plus a redeploy, with no data re-encryption step.
- Compromise response: rotate, redeploy, revoke all sessions, audit access.

## 25.6 Database migrations

```
Deploy sequence:
  1  Build and push the image
  2  Run migrations as a SEPARATE step, under the DDL-privileged role
  3  Only on success, roll out the new application version
  4  Health check
  5  Smoke tests
  6  Watch the error rate for 15 minutes
```

- **Forward-only.** No down-migrations in production (`09` §10).
- **Expand/contract** for every breaking change, so the previous application version remains compatible with the new schema. This is what makes code rollback safe — and without it, rollback becomes impossible precisely when it is most needed.
- Index creation uses `CONCURRENTLY`.
- Any migration touching a large table documents its locking behaviour before merge.

### 25.6.1 As built in M5a

The runner exists (`services/api/src/db/migrate.ts`) and implements the parts of
the sequence that apply without a deployment target: it is forward-only, applies
each file inside a transaction, records applied files in `schema_migrations`, and
is a separate step from starting the application.

**Nothing has been deployed.** Steps 1, 3–6 of the sequence above are `NOT RUN`;
there is no image, no environment and no pipeline yet. The runner is exercised
locally and by the integration suite from a clean database.

`CONCURRENTLY` is not used in `0001` because it creates the initial schema, where
every table is empty and no lock is contended. It becomes mandatory from the
first migration that touches a populated table.

## 25.7 Deployment pipeline

```
main branch push
  ├─ CI (lint, typecheck, tests, build, E2E, a11y, security)  ~12 min
  ├─ Build web → deploy to static host
  ├─ Build API image → push to registry
  ├─ Run migrations
  ├─ Deploy API (rolling, zero-downtime)
  ├─ Health + readiness checks
  ├─ Smoke tests against the deployed environment
  └─ Tag the release; record commit SHA, time and migrations applied
```

Pull requests get a preview deployment of the web app pointed at staging. Alpha deploys are **manually triggered** from a green `main`, not automatic — an automatic push to an environment holding real student data is an unnecessary risk for a project that ships weekly, not hourly.

## 25.8 Rollback

| Failure | Action |
|---|---|
| Bad application version | Redeploy the previous image — seconds |
| Bad migration | **Fix forward.** Expand/contract means the previous code still works against the new schema, so code rollback alone usually resolves it |
| Bad data (a wrong rule set) | Deactivate the rule-set version; the previous version reactivates; stored records are unaffected because they reference their own version |
| Catastrophic | Restore from backup (RPO 24 h; local-first data on devices unaffected) |

**Rollback criteria** (`30`): error rate > 5%, any wrong academic value confirmed, sign-in broken, or data loss. Any of these triggers rollback without deliberation.

## 25.9 Domain and TLS

- Web: `gradtools.<domain>` · API: `api.gradtools.<domain>` · Documents: a **distinct** origin
- TLS via the platform's automated certificates; HSTS with preload
- The document origin is separate specifically so untrusted PDFs cannot script the application origin (`13` §T-03) — it is a security boundary, not a tidiness preference

## 25.10 Environment differences

| Setting | local | experimental | staging | alpha |
|---|---|---|---|---|
| Demo data | Yes | Yes, labelled | Synthetic | **Never** |
| `INGESTION_ENABLED` | false | false | true (staging sources) | true, per-source |
| Accounts | Optional | **Disabled** (no server-side student data in Stage 1) | Enabled | Enabled |
| Notifications | Disabled | Disabled | Enabled | Enabled |
| `LLM_ENABLED` | false | false | false | **false** |
| Error reporting | Console | Sentry | Sentry | Sentry |
| Log level | debug | info | info | info |
| Rate limits | Relaxed | Normal | Normal | Normal |
| Robots policy | — | `noindex` | `noindex` | Indexable |

The experimental environment has **accounts disabled entirely**, which is what makes Stage 1's promise honest: during the experiment, GradTools holds no student data on any server (`02` §2.4).

## 25.11 Pre-launch checklist (Alpha)

| Item | Gate |
|---|---|
| All CI checks green | Required |
| Migrations tested on a production-shaped copy | Required |
| Backup taken immediately before deploy | Required |
| **Restore rehearsal completed** | Required |
| Secrets set and validated in the target environment | Required |
| Security headers verified against the live deployment | Required |
| Rate limits verified live | Required |
| Health and readiness responding | Required |
| Alerts firing to a channel that is actually monitored | Required |
| Status page live | Required |
| Demo data absent — verified by the startup check | Required |
| Robots/terms review recorded for every enabled source | Required |
| Rollback rehearsed | Required |
| Release notes and known limitations published | Required |

## 25.12 Open items

| ID | Question | Needed by |
|---|---|---|
| `OQ-020` | Final provider selection for API host, database and object storage, validated against §25.2's requirements | Milestone 3 |
| `OQ-021` | Domain name and registrar | Before the experimental launch |
| `OQ-013` | Where the DOB encryption key lives and how it rotates | Before any DOB is stored |
| `OQ-014` | Whether the chosen object store supports a separate serving origin with attachment disposition | Before uploads open |

---

### 25.6.2 Migrations are now concurrency-safe (M5)

The runner takes a PostgreSQL advisory lock before applying anything. Without
it, two instances starting together both read `schema_migrations`, both see a
pending migration, and the second fails on a duplicate type — which is precisely
what step 2 of the deploy sequence does under a rolling deploy. The lock blocks
rather than failing, so the second caller waits and finds nothing to apply.

### 25.6.3 Document storage (M5)

Documents are stored through an `ObjectStore` interface with a local-filesystem
driver. **No cloud provider is chosen** (M5 §7): S3, R2 or Blob storage is one
more implementation, not a change to any caller.

Three properties make the local driver safe to run outside a container:

1. Keys derive from the content hash, so nothing attacker-controlled reaches a
   path — traversal is designed out rather than filtered.
2. The root is configured **outside the repository and outside any served
   directory**. The web server never maps a URL onto it.
3. Every resolved path is re-checked to be inside the root, which property 1
   should make unreachable — asserted anyway, because "should be unreachable" is
   how traversal bugs get written.

## 25.9 M6 changed nothing about deployment

No new environment variable, service, migration or build step. The student
academic core is local-first and ships inside the existing web bundle.

The September 2026 pilot is a **roadmap date, not configuration** (M6 §3).
Nothing in the build, the environment or the business logic knows about it, and
nothing may be made to: a semester's status is set by the student, never derived
from the calendar.

## 25.13 M7 deployment notes

One migration, no new service, no new infrastructure.

| Change | Effect |
|---|---|
| `0009_announcements.sql` | One table, two enums, five indexes. Forward-only, additive; nothing existing is altered |
| `seed-demo.ts` | **A separate command**, never part of `seed.ts` and never run automatically |

### Demo data is opt-in, by command

```
pnpm --filter @gradtools/api seed:demo
```

Kept out of the ordinary seed on purpose: synthetic notices labelled DEMO DATA
are useful in development and a liability anywhere a real student might read
them. Nothing runs it implicitly, so no environment gets demo content by
default.

### Environment variables

**None were added.** In particular there is no flag that enables a VTU
announcement source — the gate is terms status in the database, not
configuration, so it cannot be opened by editing an environment (§14.15).

### The loopback boundary

`POST /announcements/entry` and `/publish` are reachable only from the machine
running the API. **Any deployment that puts a proxy in front of the API must not
forward these paths**, exactly as for the document routes.
