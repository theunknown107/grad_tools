# 06 — Tech Stack and Dependencies

**Status:** Phase 1 draft — stack frozen for Alpha pending approval
**Human decision:** `DEC-005` selected **React SPA + separate Node/Express API + PostgreSQL**. This document records that choice, its consequences, and every dependency with a justification.

---

## 6.1 Decision summary

| Layer | Choice | Alternative considered | Why this one |
|---|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Next.js; SvelteKit | Human-selected. SPA is sufficient: the product is behind-the-fold utility, not SEO-driven content. Vite gives fast builds and small bundles. |
| Routing | React Router | TanStack Router | Ubiquitous, adequate, no migration cost |
| State | TanStack Query (server) + Zustand (local) | Redux Toolkit | Most state here is either server cache or small local profile state. Redux is ceremony this project cannot justify. |
| Styling | CSS custom properties + Tailwind (token-locked) | CSS Modules; styled-components | Tokens from `05` must be the only source of values; Tailwind configured to expose exactly those, arbitrary values lint-blocked |
| Backend | Node 22 + Express 5 + TypeScript | Fastify; NestJS | Human-selected Express. Fastify is faster but Express's ecosystem and familiarity matter more at this scale. NestJS is far too much structure for one developer. |
| Validation | Zod | Joi; class-validator | Single schema drives runtime validation **and** the shared TypeScript type. Eliminates contract drift between client and server. |
| Database | PostgreSQL 16 | MySQL; SQLite | Relational academic data, real constraints, JSONB for provenance blobs, mature migration tooling. Non-negotiable per `12` §Database principles. |
| DB access | Drizzle ORM | Prisma; raw pg | SQL-first (readable migrations, no hidden query behaviour), typed, tiny runtime, no separate engine binary. Prisma's generated client and engine add build weight for little gain here. |
| Migrations | drizzle-kit | node-pg-migrate | Same toolchain as the schema definition |
| Background jobs | Postgres-backed job table + `node-cron` in the API process | BullMQ + Redis | See §6.3 — deliberately deferred complexity |
| Cache | In-process LRU + HTTP cache headers | Redis | See §6.3 |
| Auth | Custom magic-link + opaque session cookie | Auth0; Clerk; Lucia | See §6.4 |
| Email | Resend (or SES) | SendGrid | Only used for magic links and deletion confirmations; low volume, simple API |
| Push | Web Push (VAPID) via `web-push` | FCM | Standards-based, no Google account dependency, works on Android/desktop; iOS requires installed PWA (documented limitation) |
| PDF text | `poppler-utils` (`pdftotext -layout`) via child process | pdf-parse; pdf.js | Verified during this phase: `pdftotext -layout` correctly extracted the VTU regulation PDF that a generic parser could not. Layout preservation matters for question papers. |
| OCR fallback | Tesseract (`tesseract.js` or system binary) | Cloud OCR | Only for scanned papers; keeps documents on our infrastructure |
| Embeddings | `all-MiniLM-L6-v2` via `transformers.js` (ONNX, local) | OpenAI embeddings API | Human decision `DEC-006`: local. No per-query cost, no document leaves our infrastructure, adequate quality for question similarity |
| Vector search | In-Postgres cosine over `real[]`, upgrade to `pgvector` when measured | pgvector from day one; Pinecone | See §6.3 |
| LLM (optional) | Claude API, explanations only, behind a feature flag | Local LLM | Used only for natural-language summaries, never for computation. Disabled by default in Alpha. |
| Testing | Vitest + Supertest + Playwright + axe-core + fast-check | Jest + Cypress | Vitest shares Vite's transform pipeline; fast-check adds property-based testing for the rules engine, which is where it genuinely pays |
| Lint/format | ESLint (typescript-eslint) + Prettier | Biome | Mature plugin ecosystem (a11y, security rules) |
| Monorepo | pnpm workspaces | npm workspaces; Turborepo | pnpm's strict node_modules prevents phantom dependencies; Turborepo adds caching complexity not yet needed |
| Frontend hosting | Static host with CDN (Netlify / Vercel / Cloudflare Pages) | Self-hosted nginx | Static SPA, free tier adequate |
| API hosting | Long-running container host (Railway / Fly.io / Render) | Serverless functions | See §6.2 — decisive |
| Database hosting | Managed Postgres (Neon / Supabase) | Self-managed | Backups, PITR and patching handled; a solo operator should not run a database |
| Object storage | S3-compatible (Cloudflare R2 / Backblaze B2) | Postgres bytea; local disk | PDFs are large and immutable; the DB stores metadata and a key |
| Observability | `pino` structured logs + Sentry + `/health` endpoints | Full APM stack | See `24` |

## 6.2 Why a long-running API host, not serverless

This follows directly from `DEC-005` and constrains deployment (`25`).

GradTools has three workloads that fit serverless badly:
1. **PDF text extraction and OCR** — seconds to minutes per document, exceeding typical serverless limits and costing far more per second.
2. **Local embedding inference** — the ONNX model must be loaded into memory; cold-starting it per request is untenable.
3. **Scheduled ingestion with in-process cron** — needs a process that stays alive.

A single always-on container (512 MB–1 GB) runs the API, the scheduler and the workers. This is the modular monolith the master instruction calls for, and it is the cheapest and simplest thing that works.

## 6.3 Deliberately deferred complexity

Three places where the obvious "proper" choice is deferred, with the explicit trigger for adopting it. Adding these before the trigger would be speculative infrastructure for a product with zero users.

| Deferred | Interim solution | Adopt when |
|---|---|---|
| **Redis + BullMQ** | `jobs` table in Postgres, claimed with `SELECT … FOR UPDATE SKIP LOCKED`, driven by `node-cron` | Job volume exceeds ~1/second sustained, or a second API instance is needed, or retry/backoff logic outgrows a single table |
| **pgvector** | Embeddings in a `real[]` column; cosine similarity computed in Node over the candidate set for one subject (hundreds of questions, not millions) | Similarity search exceeds ~200 ms p95, or the corpus passes ~50k questions |
| **Separate worker service** | Workers run in the API process on a separate concurrency limit | PDF processing measurably degrades API latency, or horizontal scaling of either is required |

Each interim solution is behind an interface (`JobQueue`, `VectorIndex`) so the swap is a single implementation change — but only one implementation exists today, and no factory or config abstraction wraps it.

## 6.4 Why custom auth rather than a provider

Auth is the one place where "build it yourself" usually deserves suspicion, so the reasoning is explicit.

The chosen model (`11_AUTH_IDENTITY_AND_ACCESS.md`) is deliberately minimal: email magic link, opaque random session token stored hashed in Postgres, httpOnly + Secure + SameSite=Lax cookie. There is no password, no OAuth provider, no refresh-token rotation, no JWT.

- **No password** means no password hashing, no reset flow, no credential-stuffing surface, no breach exposure of reusable secrets.
- **Opaque server-side sessions** mean revocation is a `DELETE`, unlike JWTs which need a denylist to be revocable — reintroducing the state JWTs claim to avoid.
- The total implementation is roughly 150 lines with a small, auditable threat surface.
- A hosted provider (Clerk, Auth0) would add a vendor dependency holding student email addresses, a per-user cost curve, and a hard external dependency for a product whose privacy story is its main institutional asset.

**Risk accepted:** custom auth is a place where a subtle mistake is costly. Mitigations: the session table design and every control are specified in `11`; the auth flow gets dedicated security tests (`22` §Security tests); a security review (`13`) is a Milestone 9 gate.

## 6.5 Repository layout

```
gradtools/
├── apps/
│   ├── web/                 React SPA
│   └── api/                 Express API + scheduler + workers
├── packages/
│   ├── shared/              Zod schemas + inferred TS types (the API contract)
│   ├── academic-rules/      Pure functions: SGPA, CGPA, grades, attendance, targets
│   └── ingestion/           Source adapters: fetch → parse → normalize → validate
├── docs/                    These 32 documents
└── fixtures/                Captured source responses, sample PDFs, golden outputs
```

**`packages/academic-rules` is the crown jewel and has hard rules:**
- Zero dependencies. Zero I/O. Zero framework imports. Pure functions only.
- Runs identically in the browser and on the server — the client computes for instant feedback, the server recomputes before persisting anything (`11` §Trust boundaries).
- Every exported function cites its regulation clause in a doc comment.
- Highest test coverage in the repository, including property-based tests.

## 6.6 Dependency register

Every runtime dependency, with its justification. Anything not on this list requires a documented reason before being added.

### `apps/web`

| Package | Purpose | Justification |
|---|---|---|
| `react`, `react-dom` | UI | Core |
| `react-router-dom` | Routing | URL-addressable screens (`04` §4.3) |
| `@tanstack/react-query` | Server-state cache | Caching, retry, stale-while-revalidate for API reads |
| `zustand` | Local state | Tiny; holds profile and UI preferences |
| `zod` | Client validation | Same schemas as the server via `packages/shared` |
| `@radix-ui/react-{dialog,popover,select,tabs}` | Accessible primitives | Focus trapping and keyboard semantics are hard to get right; these are the four worth not writing |
| `lucide-react` | Icons | Consistent set, tree-shakeable |
| `recharts` | Charts | Only three chart types are used (`05` §Chart); evaluated against a hand-rolled SVG alternative and kept for axis/accessibility handling |
| `idb-keyval` | IndexedDB wrapper | Local-first storage; ~600 bytes vs a full ORM |
| `date-fns` | Dates | Tree-shakeable, no global mutation (unlike moment) |
| `workbox-window` | Service worker | Offline shell + push registration |

### `apps/api`

| Package | Purpose | Justification |
|---|---|---|
| `express` | HTTP | Human-selected |
| `helmet` | Security headers | CSP, HSTS, frame options (`13` §Baseline) |
| `cors` | CORS | SPA is on a different origin |
| `cookie-parser` | Cookies | Session cookie |
| `express-rate-limit` + `rate-limit-postgres` | Rate limiting | Deterministic, shared across instances (`13` §Rate limiting) |
| `zod` | Input validation | Every request body, query and param |
| `drizzle-orm`, `pg` | Database | Parameterised queries by construction |
| `pino`, `pino-http` | Logging | Structured JSON, low overhead, redaction built in (NFR-011) |
| `node-cron` | Scheduling | Ingestion schedule |
| `undici` | HTTP client | Native fetch semantics, timeouts, connection limits for adapters |
| `web-push` | Push | VAPID Web Push |
| `@aws-sdk/client-s3` | Object storage | S3-compatible PDF storage |
| `nanoid` | IDs | URL-safe public identifiers |
| `@sentry/node` | Error reporting | With PII scrubbing configured |

### System binaries (documented, not npm)

| Binary | Purpose | Note |
|---|---|---|
| `pdftotext` (poppler-utils) | PDF text extraction | Must be present in the API container image |
| `tesseract` | OCR fallback | Optional; feature degrades gracefully if absent |

### Dev dependencies (abbreviated)

`typescript`, `vite`, `vitest`, `@vitest/coverage-v8`, `supertest`, `@playwright/test`, `@axe-core/playwright`, `fast-check`, `eslint`, `typescript-eslint`, `eslint-plugin-jsx-a11y`, `eslint-plugin-security`, `prettier`, `drizzle-kit`, `tsx`.

## 6.7 Dependency policy

- **Adding a dependency requires:** a stated reason, a check of size and transitive count, last-publish date, and confirmation that no existing dependency or stdlib API covers it.
- **Prohibited:** packages with a single maintainer and no releases in 24 months for anything on the request path; packages requiring post-install scripts unless individually reviewed.
- **`npm audit` (or `pnpm audit`) runs in CI**; high or critical vulnerabilities fail the build.
- **Lockfile is committed** and dependency updates are a separate, reviewable PR.
- **Automated update PRs** (Dependabot/Renovate) grouped weekly, patch versions auto-merged only when the full test suite passes.

## 6.8 Dependencies requiring validation before implementation

These are stated but **not yet proven** for this project. Each must be validated in Milestone 2 or early Milestone 3.

| Item | Unknown | Validation |
|---|---|---|
| `transformers.js` + MiniLM in Node | Memory footprint and cold-start time on a 512 MB–1 GB container | Load the model, measure RSS and first-inference latency; if it exceeds budget, fall back to a Python sidecar or hosted embeddings (reopens `DEC-006`) |
| `pdftotext` on real VTU question papers | Whether papers are text-layer or scanned images | Run against 10 real papers once supplied; determines whether OCR is optional or mandatory |
| Web Push on the students' actual devices | iOS Safari requires an installed PWA; Android vendor battery optimisation may delay delivery | Test on the Stage-2 cohort's real phones |
| Managed Postgres free tiers | Connection limits and cold-start/idle-suspend behaviour (notably Neon's autosuspend) vs a cron-driven always-on API | Measure before committing; may force a paid tier earlier than planned |
| Announcement page structure | Whether the page is server-rendered HTML (parseable with a DOM parser) or JS-rendered (would require a headless browser, a materially larger dependency) | Inspect once, in Milestone 6, under the robots-permitted path |

## 6.9 Explicitly rejected technologies

| Rejected | Why |
|---|---|
| Kubernetes | One container, one operator |
| Microservices | Nothing scales independently yet; would multiply failure modes |
| GraphQL | The client's queries are known and few; REST plus typed schemas is less machinery |
| Kafka / event bus | A `jobs` table covers current needs |
| Dedicated vector DB | Corpus is orders of magnitude too small (§6.3) |
| MongoDB | Academic data is relational, and correctness depends on constraints |
| Server-side rendering framework | No SEO requirement for an authenticated utility; SPA is adequate and simpler given the chosen split |
| React Native / Flutter | A responsive PWA meets the persona need; two more pipelines does not |
| An LLM anywhere in the calculation path | Prohibited by `19` |
