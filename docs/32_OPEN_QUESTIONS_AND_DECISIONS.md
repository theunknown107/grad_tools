# 32 — Open Questions and Decisions

**Status:** living document — the single source of truth for every unresolved decision
**Rule:** a decision recorded here supersedes any conflicting statement elsewhere. When a decision changes, this document is updated **first**, then the affected documents.

*Numbering note: `OQ-001`–`OQ-005` were the initial Phase 1 question batches; they were answered by the human and are recorded below as `DEC-001`–`DEC-005`. Open questions therefore begin at `OQ-006`.*

---

## Part A — Decisions made by the human

### DEC-001 — Identity model
**Question:** Anonymous, local-first with optional account, or accounts required?
**Decision:** **Local-first with an optional account.**
**Date:** 2026-08-23
**Rationale:** zero-friction first use; minimal stored data; account earns its existence through sync and notifications.
**Consequences:** two storage paths (IndexedDB + server); explicit merge flow on sign-in; the experimental environment has accounts disabled entirely.
**Documents:** `11`, `02`, `03`, `25`

---

### DEC-002 — Student fields stored server-side · *amended by `DEC-008`*
**Question:** Which of USN, name, date of birth and academic records may be stored server-side?
**Original decision (2026-08-23):** all four accepted, for account holders.
**Amended (M2) by `DEC-008`:** **date of birth removed entirely.** The stored set is now email, optional display name, optional USN, and academic records.
**Engineering position at the time:** recommended local-only or hashed USN and no DOB at all, since name + USN + DOB + academic record is a near-complete identity package and DOB had **no feature requiring it**. The DOB half of that recommendation has now been adopted by the human.

**Binding compensating controls for what remains:**
1. USN and name are never required at onboarding — only when a feature needs them
2. USN, name and email are in the log redaction list, verified by a test
3. Neither enters analytics or error reports
4. **No admin screen can read an individual student's personal or academic records**
5. Both optional fields are skippable; the product is fully functional without them
6. Deletion erases them immediately, not soft-flags them

**Pre-agreed downgrade path** (execute, do not redesign, if a pilot reviewer objects): store USN as a salted hash server-side with plaintext local-only. Cost: losing result-label matching across devices.
**Review trigger:** Alpha readiness review, and any pilot privacy review.
**Documents:** `08`, `09`, `11`, `12`, `13`

---

### DEC-003 — Initial academic scope
**Question:** Which college, scheme and college type?
**Decision:** **VTU 2022 scheme (`22OB`), non-autonomous affiliated college, B.E./B.Tech, 1–2 branches.**
**Date:** 2026-08-23
**Consequences:** one verified rule set covers everything; autonomous colleges explicitly unsupported and warned about at profile setup; the data model is college-versioned from day one so expansion is a data change.
**Documents:** `01`, `16`, `30`

---

### DEC-004 — External data acquisition
**Question:** Manual entry, automated polling of public pages, or announcements-only?
**Decision (human):** **Automated polling of public VTU pages from the start.**
**Date:** 2026-08-23
**Finding that constrains it — verified 2026-08-23:**

| Host | robots.txt | Consequence |
|---|---|---|
| `results.vtu.ac.in` | `User-agent: *` / `Disallow: /` | **All automated access disallowed** |
| `vtu.ac.in` | `Disallow: /wp-admin/` only | Crawling permitted |

**Therefore the decision is executable for announcements and is not executable against that results host.** Per-student result retrieval from `results.vtu.ac.in` is excluded for three independent reasons (robots.txt; submitting a student's identifiers to a portal on their behalf; CAPTCHA, which we never bypass).

**Amended (M2) by `DEC-011`:** the correct framing is **scope, not incapacity**. The canonical sentence is *"Automated retrieval of individual VTU result records is outside the current scope unless an official or authorized integration becomes available."* GradTools is **not** described as permanently unable to consume result data. Results enter through a `ResultProvider` interface (`15` §15.5.1) with two `user_supplied` implementations today; an authorized integration would be a third implementation, not a rewrite.

**Implemented as:** the adapter framework is built and fixture-tested; the announcements source is **disabled by default** and cannot be enabled until a robots check and a terms review are recorded — enforced by a database constraint, not by policy. Results remain student-entered (FR-040), which was already the primary design.
**Outstanding:** `OQ-006` (terms review) gates enabling.
**Documents:** `14`, `15`, `02`, `09`

---

### DEC-005 — Technology stack
**Question:** Next.js monolith, React SPA + Node API, or React SPA + Python API?
**Decision:** **React SPA + separate Node/Express API + PostgreSQL.**
**Date:** 2026-08-23
**Consequences:** requires a **long-running container host, not serverless** (PDF processing, local model inference, in-process cron); two deployables; TypeScript end to end with a shared Zod contract.
**Documents:** `06`, `07`, `25`

---

### DEC-006 — AI approach
**Question:** Local embeddings, hosted API for everything, or no AI?
**Decision:** **Local embeddings for matching; optional hosted LLM for explanations only, disabled by default in Alpha.**
**Date:** 2026-08-23
**Consequences:** no per-query cost; no document leaves our infrastructure; deterministic fallbacks required for every AI path; **no student data ever reaches any model.**
**Risk:** the ONNX model's memory footprint in a 512 MB–1 GB container is unmeasured (`OQ-022`). If it exceeds budget, the fallback is a Python sidecar or hosted embeddings — the latter would reopen this as a privacy decision, not merely a technical one.
**Documents:** `19`, `18`, `06`

---

### DEC-007 — Question-paper corpus
**Question:** What corpus is available?
**Decision:** **Collect any papers obtainable; the human will supply an initial set; students may also upload — with verification before storage and explicit protection against decompression bombs and other destructive payloads.**
**Date:** 2026-08-23
**Implemented as:** the full hostile-input pipeline in `17` §3 — magic-byte verification, decompression-ratio guard (100:1), page and object caps, active-content rejection, extraction in a resource-limited sandboxed child process, quarantine, and operator review before publication. All three intake paths (operator import, public collection, student upload) run through **identical** validation.
**Outstanding:** `OQ-008` (redistribution rights).
**Documents:** `17`, `13`, `02`

---

### DEC-008 — Date of birth removed from the product
**Question:** Does date of birth have an approved product requirement?
**Decision:** **No. Remove it entirely.**
**Date:** M2 (human)
**Scope of removal:** not collected, not stored, not encrypted, not logged, not requested at onboarding, not in the profile schema, not in the API, not in the UI, not in tests, not in Alpha scope, and no key management designed for it.
**What this deleted:** a database column, an application-layer AEAD scheme, the `DOB_ENCRYPTION_KEY` secret, a re-encryption rotation migration, a just-in-time collection flow and its copy, `OQ-013`, and the highest-value single field in the breach-exposure model.
**Rule going forward:** if a future feature genuinely requires it, DOB returns as a **new explicit product decision** with its own privacy review — never as a nullable column added quietly.
**Documents:** `01`, `02`, `03`, `08`, `09`, `10`, `11`, `12`, `13`, `19`, `22`, `24`, `25`, `28`, `30`, `31`

---

### DEC-009 — Percentage conversion is a versioned RuleSet identifier
**Question:** How is the CGPA-to-percentage conversion prevented from regressing to the obsolete formula?
**Decision:** **VTU 2022 uses `M = CGPA × 10`** (22OB 6.7). The formula is stored as an *identifier* on the RuleSet (`percentage_formula = 'cgpa_x_10'`), never as an inline expression. The identifier `cgpa_minus_0_75_x_10` exists in the registry but is assigned to **no active rule set**.
**Date:** M2 (human, confirming the Phase 1 finding)
**Enforcement:** eight regression tests (`22` §Percentage-formula regression tests), including two **negative assertions** — that CGPA 8.20 does not yield 74.5, and that no active rule set carries the offset formula — plus a continuous data-quality check and the existing constraint that an unverified rule set cannot be active.
**Consequence:** other schemes, if ever supported, get their own explicitly versioned rule set with their own verified provenance. They never inherit the 2022 values.
**Documents:** `08`, `09`, `16`, `18`, `22`

---

### DEC-010 — Two paper corpora: private experimental, public library
**Question:** Does unresolved paper-redistribution licensing (`OQ-008`) block the product?
**Decision:** **No — it blocks only public redistribution.** Two tiers sharing one pipeline: a **private/experimental corpus** (operator documents, test fixtures, a student's own uploads visible only to them) available now, and a **public paper library** requiring verified rights, disabled until `OQ-008` resolves.
**Date:** M2 (human)
**Enforcement:** `documents.publication_tier` defaults to `private`; a `CHECK` constraint forbids `public` without a recorded rights determination (`09` §9.6). An omission fails closed.
**Consequence:** M5 proceeds on schedule; analysis over lawfully-held documents is unaffected; a negative licensing answer degrades the library to link-only rather than cancelling it.
**Documents:** `02`, `09`, `17`, `30`

---

### DEC-011 — Result Provider abstraction and scope language
**Question:** How is future authorized integration kept possible without implying it exists?
**Decision:** All results enter through a **`ResultProvider` interface** recording `provider_key`, `authority` (`student_asserted` | `official`) and `parser_version`. Two `user_supplied` implementations exist today: manual entry and paste-parse.
**Date:** M2 (human)
**Language rule:** never *"GradTools cannot ever retrieve VTU results"*; always *"Automated retrieval of individual VTU result records is outside the current scope unless an official or authorized integration becomes available."*
**Constraint:** the interface is **not** a permission structure. Every prohibition in `14` §7 applies to providers identically; a provider fetching a robots-disallowed host would violate them exactly as a source adapter would.
**Documents:** `02`, `03`, `07`, `08`, `09`, `14`, `15`

---

### DEC-012 — Product positioning
**Question:** Is GradTools framed primarily around VTU result retrieval?
**Decision:** **No.** Canonical positioning: *"GradTools is a student-facing academic utility layer that brings routine academic workflows and information into one place."* Result handling is one component among many — calculations, attendance, timetable, marks, backlogs, result organisation, notifications, syllabus, papers where permitted, analytics, historical question analysis, recommendations, and possible future institutional integrations.
**Date:** M2 (human)
**Test of the framing:** removing results entirely leaves most of the product's value intact. That is the design intent, not a consolation.
**Documents:** `01`, `15`, `28`, `29`, `30`

---

### DEC-013 — Hosting strategy
**Question:** Which host, evaluated against the real architectural requirement rather than price alone?
**Decision:** **Railway Hobby for the experimental stage** (persistent container plus managed Postgres, lowest operator-time cost); **re-evaluate at Alpha, expecting to move Postgres to a provider offering PITR**, which Alpha requires (`24` §8) and a bundled single-node Postgres does not provide.
**Date:** M2 (engineering recommendation, pending approval)
**Disqualifier applied:** any host or database that suspends on idle breaks the in-process `node-cron` scheduler intermittently and undiagnosably. This eliminated free tiers with spin-down.
**Why deferral is safe:** the API is a Docker image, the database is reached by a standard `DATABASE_URL`, storage is S3-compatible, the frontend is static on a CDN, and configuration is environment variables validated at boot. Nothing binds to a vendor API, so the choice is reversible.
**Status:** pricing figures are from secondary comparison sources and **NOT VERIFIED**; confirm before committing. **Nothing has been deployed.**
**Documents:** `25`

---

### DEC-014 — Supabase Auth as the identity provider (not the application layer)
**Question:** Which authentication provider, and what is its scope?
**Decision:** **Supabase Auth is the identity provider.** It is not the business-logic layer.

```
Supabase Auth  ->  auth_user_id  ->  student_profile.id  ->  academic records
```

**Date:** M3 (human)
**Boundaries, binding:**
- **Express remains the authoritative application API.** Business logic does not move into Edge Functions because they exist.
- **PostgreSQL remains the authoritative store.**
- **`@gradtools/academic-rules` remains the domain.** No identity concern reaches it.
- **The domain layer never imports a Supabase SDK.** Enforced by the zero-dependency lint rule and `purity.test.ts`.
- **`auth_user_id` is the only identity key.** Never USN, email, name or college.
- **The provider's user row is not the academic profile.** 1:1 but distinct, which is what later permits account deletion, provider switching, provider linking and email changes without touching an academic record.

**Implemented in M3:** types only (`apps/web/src/domain/identity.ts`). `StudentProfile.authUserId` exists and is always `null`. **No authentication is implemented, and none may be claimed.**
**Documents:** `07`, `08`, `11`

---

### DEC-015 — Onboarding order once authentication exists
**Question:** Does academic profile setup come before or after identity?
**Decision:** **After.** `Welcome -> Sign in / Register -> identity established -> academic profile -> Dashboard`.
**Date:** M3 (human)
**Rationale:** collecting academic metadata before an identity exists creates duplicate profiles, complicates recovery, and asks for data before the student has a reason to trust the product with it.
**Stage 1 position:** the "try it without an account" branch of the same flow, which is why the local profile is optional and skippable.
**Documents:** `03`, `11`

---

### DEC-016 — Repository pattern with async interfaces
**Question:** How does a local-first app avoid a rewrite when a server arrives?
**Decision:** All storage goes through `RepositoryBundle`, supplied by React context. Interfaces are **async even though Stage 1 makes no network call**.
**Date:** M3 (engineering)
**Rationale:** a synchronous localStorage API is simpler today and forces every caller to be rewritten when an API repository arrives, because that one is unavoidably async. Async now makes the future swap a genuine swap.
**Not architecture theatre:** there are no fake network calls, no simulated latency and no server code. Tests inject an in-memory bundle, which is what demonstrates the seam is real.
**Documents:** `07`, `33`

---

### DEC-017 — Contrast tokens corrected against measurement
**Question:** Did the published design tokens actually meet WCAG AA?
**Finding:** **No.** `docs/05` asserted AA compliance for every pairing. The axe-core sweep proved two failures:

| Token | Was | Measured | Now | Now measures |
|---|---|---|---|---|
| `--text-subtle` (light) | `#828C9B` | **3.40:1** | `#67707D` | 5.01:1 |
| `--text-subtle` (dark) | `#6F7987` | **3.95:1** | `#8B95A3` | 5.75:1 |
| `--success` (light) | `#15803D` | 4.50:1, axe-rejected at 13px | `#136B33` | 5.93:1 |

**Date:** M3 (engineering, from measurement)
**Lesson recorded rather than quietly patched:** a documented contrast claim is worth nothing until something measures it. `tests/visual-qa.mjs` is now that something, and it runs against the real built app.
**Documents:** `05`

---

## Part B — Decisions made by engineering (low-risk, standard practice)

Recorded so they are visible and reversible rather than buried in code.

| ID | Decision | Rationale |
|---|---|---|
| ED-01 | Drizzle ORM over Prisma | SQL-first, readable migrations, no engine binary, typed |
| ED-02 | Passwordless magic-link auth | Removes password storage, reset flows and credential-stuffing entirely (`11` §2) |
| ED-03 | Opaque server-side sessions, not JWT | Revocation is a `DELETE`; a JWT denylist reintroduces the state JWTs claim to avoid |
| ED-04 | Postgres-backed job queue, not Redis | Adequate at this scale; `SKIP LOCKED` is concurrency-safe; documented upgrade trigger (`06` §6.3) |
| ED-05 | `real[]` embeddings, pgvector deferred | Corpus is hundreds of questions per subject, not millions; documented trigger |
| ED-06 | No third-party analytics | Session recording on a page showing marks would send those marks to a third party (`12` §7) |
| ED-07 | 404 rather than 403 for non-owned resources | A 403 confirms existence — an enumeration oracle (`10` §3) |
| ED-08 | **Admins cannot read individual student records** | Decouples the highest-privilege plane from the highest-value asset (`11` §5) |
| ED-09 | Cursor pagination only | Offset pagination drifts under concurrent inserts |
| ED-10 | `/health` performs no dependency checks | Otherwise a non-essential outage causes the platform to restart a working container |
| ED-11 | Forward-only migrations with expand/contract | Down-migrations are rarely tested and give false confidence; expand/contract is what makes code rollback safe |
| ED-12 | Rules engine has zero dependencies, enforced by lint | Makes "AI can never touch a calculation" structural rather than a promise |
| ED-13 | `evidence` is a `NOT NULL` column on scores | A score cannot physically exist without the evidence behind it |
| ED-14 | Source enablement gated by a database `CHECK` | Makes the robots boundary un-bypassable by any code path or admin error |
| ED-15 | Structural module mapping preferred over semantic | The regulation guarantees 2 questions per module across 5 modules — more reliable than any model (`17` §5) |
| ED-16 | No output below 4 papers | A frequency over 2 papers is noise; a disclaimer does not stop a student acting on it |
| ED-17 | Truncate fractional percentages toward zero for band lookup | Rounding 89.5 up would award an unearned O grade (`16` `A-16.1`) |
| ED-18 | Class equivalence at M = 50 resolves to Second Class | The regulation's own bands overlap there (`16` `A-16.3`) |
| ED-19 | Tabular figures mandatory in all numeric tables | Misaligned digits make a marks table look wrong |
| ED-20 | No emoji in product copy | Reads as unserious in a product shown to faculty; inconsistent screen-reader behaviour |
| ED-21 | Plain CSS Modules rather than Tailwind | `docs/05` §5.13 warned Tailwind decays the token system unless arbitrary values are lint-blocked. CSS Modules reach the same result with no config to maintain and no escape hatch to police |
| ED-22 | No component library (Radix, shadcn, MUI) | The slice needs ~12 primitives and no modal. Every imported component would still need restyling to the approved tokens |
| ED-23 | Lucide icons, against the Taste skill's preference | `docs/05` §5.8 approves Lucide, and an approved spec outranks a generic tool preference. One family, one stroke width |
| ED-24 | Inter, against the Taste skill's default-avoidance | Taste's own override permits Inter for "neutral / Linear-style" briefs, which is precisely this brief, and `docs/05` §5.3 mandates it |
| ED-25 | Em-dash removed from UI prose | Applying the Taste skill's most mechanical AI-tell check. 4 remain as "no value" glyphs in data cells, a typographic convention rather than prose flourish |
| ED-26 | Feature-owned page components; no separate `pages/` directory | A `pages/` layer that only re-exports feature components is an abstraction with no behaviour (`33` §33.1 warns against exactly this) |
| ED-27 | `postgres.js` + hand-written numbered SQL migrations, **not** Drizzle | `07` §7.4 named Drizzle as a candidate, not a commitment. M5a's schema is ~6 reference tables whose whole value is in CHECK constraints, partial unique indexes and a `COALESCE` expression index — none of which a query builder expresses better than SQL, and all of which it obscures. `postgres.js` tagged templates are parameterised by construction, so the injection guarantee is not weakened. Revisit if a student-data schema with many relations arrives |
| ED-28 | No `UNIQUE (scheme_id, college_id, version)` on `rule_sets`; a `COALESCE` unique index instead | PostgreSQL treats NULLs as distinct, so the plain constraint silently fails to deduplicate exactly the scheme-wide rows (`college_id IS NULL`) that matter most. Found by a seed that was not actually idempotent; fixed in the schema rather than in the seed |
| ED-29 | `createLogger` accepts an optional destination stream | Redaction is a security guarantee (NFR-011), so it must be tested against the shipped factory. The alternative — a test that re-declares the redaction path list — asserts nothing about production behaviour |
| ED-30 | Oversized request bodies mapped to `PAYLOAD_TOO_LARGE`, not `INTERNAL_ERROR` | `body-parser` throws before routing and before any `ApiError` exists, so without an explicit branch a client mistake is reported as a server fault — wrong for the caller and noise for on-call |
| ED-31 | `subjects.module_count` nullable, NULL = unverified; **not** 0 | A `NOT NULL DEFAULT 5` published a scheme norm as a per-subject fact next to an empty syllabus. 0 would mean "verified as having none", which is a different claim |
| ED-32 | Subjects addressed by UUID; a code is a `400`, not a `LIMIT 1` | Uniqueness is `(scheme_id, branch_id, code)`, so a code names a set. Guessing which member to return is worse than refusing |
| ED-33 | Rule-set precedence: college-specific, then scheme-wide, by explicit `ORDER BY (college_id IS NULL)` | The schema deliberately allows both to be active. `LIMIT 1` with no ORDER BY was a coin toss that looked stable only because one row existed |
| ED-34 | `RequiredMarksOutcome` returns raw-100 **and** printed-50 figures, printed one unrounded | The two differ by a factor of two. A bare `requiredSee` looked like a grade-card number and was not one (`A-16.7`). Rounding the printed view would create a figure that does not convert back |
| ED-35 | `colleges` gains provenance, verification and publication gating | It was the one publishable reference table with none, served on `active` alone. Nothing wrong was served — the table is empty — but the schema permitted it |
| ED-37 | Validate before storing; a rejected document leaves a row and no bytes | Storing first would put unexamined files on disk, and a validator that runs after storage protects nothing. The row keeps rejection auditable without retaining what was rejected |
| ED-38 | Active-content markers matched as complete PDF name tokens, not substrings | `/JS` is two characters and occurs by chance in compressed image streams. Substring matching rejected 3 of 63 real papers while catching nothing |
| ED-39 | `/OpenAction` refused only when it carries an `/S` action | docs/17 §17.3 always said "with an action". Rejecting benign view destinations refused 4 more real papers; a validator that rejects 12% of legitimate input gets worked around |
| ED-40 | `HOST` defaults to loopback and a non-loopback bind refuses to start | Stage 1 private routes are unauthenticated by design, so the bind address is the control. CORS is a browser policy and does not apply to `curl` |
| ED-41 | Synchronous extraction; no queue or worker pool | Measured: 12.6–202.5 ms per real document. §23.10 rejects infrastructure added before measurement. OCR would be the trigger to revisit |
| ED-36 | `universities` and `branches` are **internal taxonomy**, not verified reference data; no provenance columns added | The test: does the row make a checkable claim about the external world that could change a calculation? VTU is the product's scope anchor; `cse` is a join key. `docs/09` §9.4 already drew this line. Inventing a source URL for "VTU exists" would be fabricated provenance, which is worse than none. The real defect was the queries — `listUniversities()` filtered nothing — fixed by adding `universities.active` in `0003` |
| ED-37 | One shared `sources` registry for both M5 tracks, rather than per-subsystem source fields | Documents and announcements ask the same two questions: where is this from, and may we show it. Two answers drift, and rights end up duplicated on every table that holds material |
| ED-38 | Terms review is part of the enable CONSTRAINT, not a note beside it | robots and terms answer different questions and can disagree. VTU proves it: `vtu.ac.in` robots permits announcements while its terms are unreviewed. A robots-only gate would have let that source be enabled on the strength of a check that does not address reuse |
| ED-39 | Four presentation modes (`host`/`link`/`private`/`blocked`) rather than a two-tier public/private flag | While `OQ-008` is open, "we know where it is" is the useful state and a flag cannot express it. `link` additionally refuses to store bytes: holding a file we may not redistribute is the risk, not the metadata |
| ED-40 | Storage keys derived from the content hash, never from a filename | Path traversal is designed out rather than filtered. With no attacker-controlled input reaching a path there is nothing to escape, and deduplication comes free from the same decision |
| ED-41 | `fetch` is not a method on `SourceAdapter` | An adapter describes how to read a source; it does not carry permission to read it. Separating them makes `parse`/`normalize`/`validate` pure and fixture-testable, and makes the permission check impossible to forget |
| ED-42 | `ocr_required` is reported, never acted on | Silently OCR-ing every scan would make a document whose text was guessed indistinguishable from one whose text was read, and everything downstream depends on that difference |
| ED-43 | Migration runner takes a `pg_advisory_lock` | Two processes migrating concurrently both see a pending migration and the second fails on a duplicate type, which is exactly what a rolling deploy does. Found by two test files racing |
| ED-44 | `enabled` requires `access_method = 'http_fetch'`, not `<> 'none'` | `enabled` is a statement about automated outbound access, and only one method is automated. `manual_upload` and `manual_entry` describe a human handing us material; enabling one would mean polling a source that exists because nobody polls it. The enum keeps all four values because the provenance distinction is real |
| ED-45 | Public visibility requires validation as well as rights | Rights and safety are independent questions. Permission to show a document says nothing about whether its bytes have been checked. Expressed as a constraint rather than a query filter, so a second caller or an admin tool cannot forget it |
| ED-46 | The public-visibility condition is defined once and shared by both read paths | The by-id lookup is exactly where such a filter gets forgotten; sharing the fragment makes the list and the single-document paths incapable of drifting |

Any of these may be reversed; each names the condition under which reversal would make sense.

---

## Part C — Open questions

Every entry states why it is unresolved, the options, a recommendation, and exactly what decision is needed.

### OQ-006 — Terms-of-use review for `vtu.ac.in` · **STILL OPEN after M7**
**Why unresolved:** robots.txt is verified and permits crawling of the announcement paths, but the site's terms of use have not been read. **robots.txt is necessary, not sufficient.**
**Reinforced in M2:** `14` §14.7.1 now classifies every source into one of three categories, and the classification is stored on the source row:

| Category | Automated access |
|---|---|
| 1. Official / authorized | Permitted within the authorization. **None exists today.** |
| 2. Publicly accessible information | **Not automatically permitted.** Public readability describes access control, not automation rights |
| 3. Not verified as permitted | **Prohibited.** The default for every source |

Every source starts in category 3. **No crawler is ever described as "safe" merely because a page is publicly reachable** — `results.vtu.ac.in` is publicly reachable and disallows all automated access, which is the illustration held in the document.
**Options:** (a) review the terms and record the finding; (b) proceed on robots.txt alone; (c) abandon automated ingestion and enter announcements manually.
**Recommendation:** **(a)**. Perhaps 30 minutes of reading, and it is the difference between a defensible position and an assumption. If the terms are silent on automated access, record that fact — silence plus a conservative 4-requests-per-day rate is defensible; an unread terms page is not.
**Decision needed:** the human reads the terms and records the outcome in `external_sources.terms_note`.
**Consequence if unresolved:** the announcements adapter cannot be enabled — the database constraint prevents it, and the source stays in category 3.

### OQ-008 — Redistribution rights for question papers · **STILL OPEN after M8**
**Why unresolved:** whether a third party may host and redistribute VTU question papers is genuinely unclear. **NOT VERIFIED.**
**Status after M8: the public library is now BUILT and is nearly empty because of this question.** M8 shipped browsing, search, filtering, the paper page and the hosted-file route; the only documents that legitimately reach `host` are the ten synthetic papers GradTools wrote itself, and the database's `document_host_requires_rights` gate is what keeps it that way. Real material therefore lands as `link` or `private`. That is the rights model working, not the library failing — and it means the cost of leaving this question open is now visible rather than theoretical.
**Resolved in M2 (`DEC-010`) — it no longer blocks the product.** The question was previously scoped as blocking M5 entirely; that was wrong. It blocks exactly one thing: *public redistribution of third-party documents.* Two tiers now share one pipeline:

| | Private / experimental corpus | Public paper library |
|---|---|---|
| Available | **Now** | **Disabled until this question resolves** |
| Contents | Operator documents, fixtures, a student's own uploads visible only to them | Documents with verified rights |
| Redistribution | None | Yes |

`documents.publication_tier` defaults to `private`, and a `CHECK` constraint forbids `public` without a recorded rights determination (`09` §9.6), so an omission fails closed.
**Options if it resolves negatively:** (a) link-only — metadata, provenance and analysis with a link to the original location; (b) analysis-only; (c) seek explicit permission.
**Recommendation:** proceed with the private corpus now; decide (a)/(b)/(c) before any document is promoted to the public tier.
**Decision needed:** the human determines the position before the public library is enabled.
**Consequence if unresolved:** GradTools ships with a private corpus and a link-only public view. M5 is unaffected.

### OQ-009 — College admin role
**Why unresolved:** no college has agreed to a pilot, so designing an institutional role hierarchy is speculative.
**Options:** (a) defer until a pilot exists; (b) design a read-only aggregate role now.
**Recommendation:** **(a)**. `12` §13 already commits to the college receiving no individual student data, which constrains any future design.
**Decision needed:** none until a pilot is agreed.

### OQ-011 — Does the target college apply VTU 2022 regulations unamended? · **BLOCKING Alpha**
**Why unresolved:** assumed (`01` A1, `16` A-16.5) but **NOT VERIFIED**. A local amendment to the CIE split or attendance rule would make our figures wrong for exactly the students we are targeting first.
**Options:** (a) obtain the college's academic handbook or regulations; (b) verify against real grade cards; (c) both.
**Recommendation:** **(c)**. The grade-card validation is already an Alpha gate (`30` §8) and would surface most discrepancies empirically; the document confirms the rest.
**Decision needed:** the human obtains a college document and/or supplies anonymised grade cards.

### OQ-012 — DPDP Act applicability
**Why unresolved:** India's DPDP Act 2023 is enacted with phased rule notification; the precise obligations for a small student project are **NOT VERIFIED**.
**Options:** (a) design to the stricter of DPDP principles and general good practice (current approach); (b) obtain legal guidance before public Alpha.
**Recommendation:** **(a) now, (b) before a public Alpha.** The current design (consent, minimisation, self-service export and deletion, retention limits) is defensible under any likely interpretation. Note that the product never claims "DPDP compliant" — it describes what it does.
**Decision needed:** whether to seek guidance before Alpha.

### OQ-013 — DOB encryption key management · **PERMANENTLY RESOLVED**
**Resolution:** *Removed — DOB has no approved product requirement* (`DEC-008`).

The question is void rather than answered: there is no date-of-birth field, therefore no ciphertext, no key, no custody question and no rotation procedure. This entry is retained so the resolution is visible in the register rather than the question silently disappearing.

### OQ-014 — Separate serving origin for documents · **BLOCKING uploads**
**Why unresolved:** untrusted PDFs must be served from a distinct origin so they cannot script the application origin (`13` §T-03); not every object-storage provider makes this convenient.
**Options:** (a) provider-supported custom domain on the bucket; (b) a proxy route on a separate subdomain.
**Recommendation:** **(a)** if available, else (b). This is a security boundary, not a preference.
**Decision needed:** verify during provider selection.

### OQ-015 — WAF at Alpha scale
**Why unresolved:** cost versus benefit is unclear at hundreds of users.
**Recommendation:** rely on application-level rate limiting and validation; adopt a WAF only if the chosen platform includes one at no cost, or if abuse is observed.
**Decision needed:** before Alpha, informed by provider choice.

### OQ-016 — Security disclosure channel
**Why unresolved:** no channel exists for a researcher reporting a vulnerability.
**Recommendation:** publish a `/.well-known/security.txt` with a contact address and a simple, honest policy (no bounty, good-faith safe harbour, response target of 5 days).
**Decision needed:** before public Alpha. Low effort, and its absence looks careless to exactly the audience that matters.

### OQ-017 — Is the announcements page server-rendered or JS-rendered?
**Why unresolved:** not inspected. Determines whether a DOM parser suffices or a headless browser is required — the latter is a materially larger dependency (memory, image size, attack surface) and would be reconsidered rather than assumed.
**Recommendation:** inspect in M6. If it requires a headless browser, **re-evaluate whether announcements ingestion is worth it at all** versus manual operator entry.
**Decision needed:** M6.

### OQ-018 — Grade point for the `AB` grade
**Why unresolved:** the regulation lists `AB` (Absent) among special grades but does not clearly state its grade point or CGPA treatment. GradTools currently assumes 0 points and failure-equivalent for progression (`16` A-16.4). **NOT FULLY VERIFIED.**
**Options:** (a) verify against a real grade card containing an `AB`; (b) treat as F (current assumption); (c) exclude from CGPA like DX.
**Recommendation:** **(a)**. The difference between (b) and (c) changes a student's CGPA materially, so an assumption is not adequate here.
**Status after M4: still OPEN.** The artifact validated under `OQ-024` contains **no** `AB`, `IC` or `W` row — every one of its 9 courses is a pass. It therefore provides no evidence either way, and none was inferred. The engine continues to return `unverified_rule` for these grades rather than guessing.
**Decision needed:** before Alpha, via a grade card that actually contains one of these grades.

### OQ-019 — Do real VTU papers carry a text layer? · **PARTIALLY VERIFIED (M5A)**
**Why it mattered:** it determines whether OCR is an edge case or the main path, and therefore the effort behind everything downstream of extraction.

**Evidence.** A local corpus of **65 real academic PDFs** was supplied and run through the shipped validation and extraction path (`pdftotext -layout -enc UTF-8`). The corpus is gitignored and never committed.

| Outcome | Count |
|---|---|
| Produced usable text (`text_available`) | **9** |
| Produced no meaningful text (`ocr_required`) | **54** |
| Not a PDF at all — HTML carrying `<script>`, named `.pdf` | **2** |

Stated precisely: **in the supplied 65-document test corpus, 56 of 65 produced no meaningful text through `pdftotext`.**

**What this does and does not establish:**
- ✅ Real papers are a **mixed** corpus. Both kinds genuinely occur.
- ✅ Scan-like PDFs were the **large majority of this sample**, so OCR is very likely to matter rather than being an edge case.
- ❌ It does **not** generalise to all VTU papers. This is one local sample, of unknown provenance and selection, from one contributor.
- ❌ OCR **quality, cost and implementation remain entirely unverified**. No OCR exists in the codebase.

**Why it stays open:** the sample size and selection do not support a general claim, and the follow-on question — whether OCR output would be accurate enough to build on — has not been touched.
**Decision needed:** an OCR strategy, informed by this evidence. **Future OCR required** — not implemented.

### OQ-019a — Is OCR output good enough to build on? · **PARTIALLY VERIFIED (M5A.1)**
**Benchmark:** 10 scan-like documents (33 pages) through two **fully local** engines — Tesseract 5.5.3 and the OCR engine built into Windows. Nothing was sent to a hosted service; no document left the machine. Full method and examples in `17` §17.11b.

**Answer, for the readable part:** yes, with a caveat that decides the engine.

| Engine | GOOD | PARTIAL | POOR | FAILED | End to end |
|---|---|---|---|---|---|
| Tesseract | 6 | 4 | 0 | 0 | ~3.0 s/page (≈1.5–2 s tuned) |
| Windows OCR | 7 | 3 | 0 | 0 | ~2.5 s/page |

**The caveat:** Windows OCR scores marginally better on words and is unusable on
structure — on a two-column paper it reads the question-label column top to
bottom, detached from the question text. Tesseract with `--psm 6` keeps
`question | marks | Bloom's | CO` on one line. For GradTools, structure is the
product, so Tesseract wins despite lower raw accuracy. Windows OCR is also
Windows-only and therefore not deployable.

**Still unverified, and why this stays open:**
- **Kannada script: 0 codepoints recovered by either engine.** Neither has a Kannada language pack. `BKBKK107`/`BKSKK107` are mandatory courses. Fixable (`kan` traineddata) but not done and not measured.
- **Mathematics does not survive**, matching the text-layer finding — `tan⁡(∅)` became `tan = e $ v4 ayy`.
- **"Readable" is a lower bar than "segmentable".** Whether this output supports question-level extraction is a different question and has not been tested.
- One 10-document sample, one machine.

**Decision made (`DEC-021`):** local OCR with Tesseract **when OCR is implemented**. Not implemented in this milestone.

---

**M5A.2 UPDATE — the three measurements were taken. Two resolved, one did not.**

| M5A.1 unknown | M5A.2 outcome |
|---|---|
| Kannada accuracy with `kan.traineddata` | **RESOLVED.** `-l eng+kan` recovers 3 922 Kannada codepoints with the English header intact and coherent question text. GOOD for discovery, PARTIAL for authoritative transcription — and judged by recognising known phrases, not by a fluent reader |
| 150 DPI on a larger sample | **RESOLVED.** 20 documents, 65 pages: ~1.07 s/page, 2.8× faster than 300 DPI at comparable quality. Also corrected the PSM choice — it is format-dependent (PSM 3 descriptive, PSM 6 MCQ), not a single global setting |
| Is the output segmentable? | **PARTIALLY.** Five of seven fields are dependable; two are not |

**Segmentation, field by field** (20 documents; 5 inspected by hand):

| Field | Verdict |
|---|---|
| Page boundaries, module, question number, marks, Bloom's/CO | **dependable** — 15–20 complete rows per descriptive paper, all three attached |
| Sub-question letter (a/b/c) | **NOT dependable** — 3–4 of 15–20 rows |
| Question text | prose readable and noisy; **mathematics destroyed** |

**Therefore OQ-019a REMAINS PARTIALLY VERIFIED.** Calling it verified would
claim segmentability that two of seven fields do not support. Features keyed on
module and marks rest on solid ground; features keyed on "question 3(b)" or on
reconstructed equations do not.

**Decision needed:** whether sub-question identity is required by the first
intelligence feature. If it is not, OCR can proceed; if it is, it needs a
different approach — positional extraction rather than more parsing of flat
text.

---

**M5A.4 UPDATE — positional extraction was built and measured. The blocker is
substantially resolved.**

| Field | Flattened text | Positional (native) | Positional (OCR) |
|---|---|---|---|
| Sub-question letter | **3–4 of 15–20** | **essentially complete** (47 across 20 questions) | partial: 11–14 per paper |
| Marks / Bloom's / CO | fragile regex | by **column position** | by column position |
| Question number, module, page | dependable | dependable | dependable |
| Mathematics | destroyed | destroyed | destroyed |

Position is what does it: `a.` occupies its own narrow cell that flattening
merges into the question text, and the marks column is a location rather than a
pattern.

**Still not resolved, and why this stays PARTIALLY VERIFIED:**
- **MCQ gains little.** A single-column flow gives geometry nothing to work
  with: 44 items of 50 (English), 27 of 50 (Kannada), with instruction lines
  still appearing as items. Positional extraction is a *descriptive-paper*
  technique.
- **Kannada item numbering is unreliable** — observed `8, 8, 8, 0, 20` where
  consecutive numbers belong. The text is usable for discovery; the numbering is
  not.
- **Mathematics is unchanged**: structure survives, content does not.
- **A badly damaged scan yields nothing** rather than unreliable rows, by
  deliberate choice.
- Eight documents, one corpus.

**M5A.6 UPDATE — STILL PARTIALLY VERIFIED, and now for a measured reason.**

Sub-question STRUCTURE holds up under adjudication: label agreement 37/38 (97%)
across 71 reviewed records. Sub-question TEXT does not: 0/12 native texts were
exact, all truncated at the marks column (OQ-032).

So the answer to OQ-019a splits in two:

| | Verdict |
|---|---|
| Can we identify the sub-questions? | **Yes** — 97% on the reviewed sample |
| Can we trust what they say? | **Not yet** — every adjudicated text needed correction |

That is why this does not close. Sub-question identity was the original
question and is substantially answered; the corpus then found that identity
without dependable text is not enough for anything that reads the words.

**Decision needed:** whether the first intelligence feature can be built on
descriptive papers with native text and good scans — where the structure is now
dependable — while MCQ and poor scans are handled as a separate problem. That is
a product-scope question, not an engineering one.

### OQ-029 — VTU 2022 has more than one question-paper format · **OPEN**
**Discovered in M5A.1** while grading the OCR benchmark: 4 of 10 sampled papers are 50-question MCQ papers (`Max Marks: 50`, "Question Paper Version", "darken the circles") with **no modules and no Bloom's/CO columns**. The other 6 are the descriptive 100-mark format with `Module-1..5`.
**Why it matters:** a first rubric that assumed one format scored 4 real papers POOR when the OCR had read them correctly. Any future segmentation or intelligence work must detect the format before assuming a structure, or it will report good papers as broken.
**Unknown:** how many formats exist in total, and whether the mapping from course code to format is reliable.
**Decision needed:** before question segmentation.

### OQ-027 — Production object storage · **OPEN**
**Why unresolved:** M5A ships an `ObjectStore` interface with a local-filesystem driver, deliberately choosing no cloud provider. Production storage must provide: private access by default, signed URLs when serving is eventually permitted, encryption at rest, lifecycle rules, durable storage, predictable cost, and a serving origin separate from the application.
**Status:** the abstraction exists and is exercised; the provider decision is untouched. Swapping in S3/R2/Blob is one more implementation of the interface.
**Decision needed:** before any deployment that stores real student documents.

### OQ-028 — Document retention policy · **OPEN**
**Why unresolved:** no retention rule has been decided, and inventing one would be worse than admitting there isn't one.
**Interim behaviour, stated honestly in the UI:** an imported document stays until the student removes it. The Documents screen says exactly that rather than implying a policy.
**Decision needed:** before Alpha, alongside `OQ-027` — retention and storage cost are the same conversation.

### OQ-020 — Hosting provider selection · **RECOMMENDATION MADE (`DEC-013`), pending approval**
**Evaluated against** the real architectural requirement: persistent process, PostgreSQL, in-process background jobs and cron, PDF/OCR workloads, future workers, scheduled ingestion, possible local model inference, cost at experimental scale, upgrade path, backups and observability.
**Disqualifier discovered:** any host or database that **suspends on idle** breaks the in-process `node-cron` scheduler intermittently and undiagnosably. This eliminates free tiers with spin-down, regardless of price.
**Recommendation:** **Railway Hobby for the experimental stage**; re-evaluate at Alpha, expecting to move Postgres to a provider offering **PITR**, which Alpha requires (`24` §8) and a bundled single-node Postgres does not provide. Full comparison in `25` §25.2.1.
**Why deferring the Alpha choice is safe:** Docker image, standard `DATABASE_URL`, S3-compatible storage, static frontend, environment-variable config. Nothing binds to a vendor API, so the decision is reversible.
**Status:** pricing figures are from secondary comparison sources and **NOT VERIFIED**. **Nothing has been deployed.**
**Decision needed:** human approval of the recommendation before M3 provisioning.

### OQ-021 — Domain name
**Why unresolved:** not chosen.
**Decision needed:** before the experimental launch. Note that three origins are needed: web, API and a separate document-serving origin.

### OQ-022 — Embedding model footprint in the target container
**Why unresolved:** `transformers.js` + MiniLM memory and cold-start cost in a 512 MB–1 GB container is unmeasured.
**Options:** (a) measure and proceed; (b) Python sidecar; (c) hosted embeddings.
**Recommendation:** **(a)** in M2. Note that (c) would reopen `DEC-006` as a privacy decision, since question text would then leave our infrastructure.
**Decision needed:** M2, based on measurement.

### OQ-026 - VTU announcements terms of use - **BLOCKER, still open after M7**
**Status after M7: OPEN, unchanged.** M7 shipped the announcement feature *around* this question rather than through it — the model, the gate, the dedup, the relevance and the notification centre all exist and are tested, and the source they were built for is still closed. A test asserts the source reports `enabled = false`, `terms_status = 'unknown'`, `access_method = 'none'`, and that enabling it throws; that test is the thing standing between an unresolved terms question and a live scraper.
**Status after M5: OPEN.** This is `OQ-006` restated with its evidence in hand.
**What is now known:** `vtu.ac.in/robots.txt`, fetched 2026-08-24, disallows only `/wp-admin/`. Robots therefore does **not** block reading announcements.
**What is still unknown:** whether VTU's terms of use permit a third party to read, store and re-present those announcements. Nobody has reviewed them.
**Consequence:** the `vtu-announcements` source is seeded **disabled**, and the database constraint refuses to enable it. The adapter framework and fixtures exist and have never been run against VTU.
**Decision needed:** a human review of vtu.ac.in's terms. A reading task, not an engineering one.

### OQ-027 - Object storage provider
**Why unresolved:** M5 ships an `ObjectStore` interface with a local-filesystem driver. No cloud provider is chosen, and the choice interacts with hosting (`OQ-020`) and with retention.
**Impact:** low now. The interface means the decision is one implementation, not a rewrite.
**Decision needed:** before any deployment that accepts uploads.

### OQ-028 - Document retention
**Why unresolved:** how long a private document is kept, and what becomes of it when a student stops using GradTools, has never been decided. Stage 1 has no accounts, so nothing is retained on a server today.
**Decision needed:** before student uploads are accepted over the network. Requires a human answer, not a default.

### OQ-023 — Annexure-I grade/percentage table transcription
**Why unresolved:** the M4 roadmap criterion "transcribe Annexure-I" was never completed. The 2022 regulation's grade table is implemented in `academic-rules` from the clauses, but the annexure itself has not been transcribed row-for-row as an independent cross-check.
**Impact:** low today — the implemented bands are clause-verified and tested. It matters as corroboration, not as a source of new values.
**Status after M4: still OPEN, and deliberately not treated as addressed.** The `OQ-024` artifact prints no letter grades, so it corroborates no band. Its totals do land on 59, 79 and 80 — exactly the B/A/A+ edges `16` §16.3 identifies as the ones third-party calculators get wrong — which makes a future card *with* letter grades unusually valuable. One grade card is not a substitute for the official Annexure-I transcription in any case.
**Decision needed:** before Alpha.

### OQ-024 — Validation against real grade cards · **PARTIALLY VERIFIED (M4)**
**Artifact received:** a real VTU provisional result — UG, semester 4, 9 courses. Supplied by the project owner for their own result. Fixture at `packages/academic-rules/test/fixtures/real-grade-card.ts`; the raw image is **not** stored in the repository, and name and USN are absent from the fixture.

**Verified by the artifact:**
- Subject-code format including elective suffixes (`BCS405B`, `BCB456D`).
- `Total = Internal + External` on all 9 rows.
- The three simultaneous passing thresholds (22OB 6.3) hold for all 8 SEE-assessed rows, matching the printed `P`.
- 22OB 6.1(3), a course with no SEE, **corroborated by a real row**: a Physical Education course prints an internal above the CIE maximum of 50, an external of 0, and still passes. Both facts are impossible under the ordinary CIE + SEE structure.
- **A new finding (`16` A-16.7):** the printed `External` column is the SEE's contribution out of 50, not the raw script mark out of 100. `docs/16` §16.5 previously claimed the opposite; that claim has been corrected.

**Still NOT verified, because this artifact does not print it:** credits, letter grades, grade points, **SGPA**, **CGPA**, percentage, class, and any `AB`/`IC`/`W` row.

**Why it stays open:** the SGPA and CGPA formulas — the calculations with the most downstream impact — remain validated against the regulation alone. A provisional result carries no aggregate.
**Decision needed:** supply a **consolidated marks card**, or a grade card printing credits, letter grades and SGPA. That closes it.

### OQ-025 — No verified per-subject syllabus source · **BLOCKER for syllabus content**
**Why unresolved:** the verified scheme document (`csesch.pdf`) gives subject codes, titles, credits and CIE/SEE marks, but carries **no module breakdown**. Per-subject syllabus PDFs exist on the VTU site but have not been verified for the 2022 CSE scheme.
**Consequence, accepted deliberately:** `syllabus_modules` ships with **zero rows**. The table, the API route and the frontend empty state are all implemented and tested; the content is absent because inventing it would be worse than an honest gap (`14` §14.10).
**Decision needed:** supply or confirm the per-subject syllabus source. Until then the endpoint correctly returns an empty list, and the UI says the data is not available yet.

---

## Part D — Contradictions found in cross-review

Every contradiction found during the `22`-point cross-document review, and its resolution.

| # | Contradiction | Resolution |
|---|---|---|
| C-01 | `DEC-004` selected automated polling "from the start", but `results.vtu.ac.in` robots.txt disallows all access | **Resolved via `DEC-004` + `DEC-011`.** Polling applies to announcements only; results are student-entered today, through a `ResultProvider` interface that keeps authorized integration possible. Framed as scope, not incapacity (`03/UF-08b`, `15` §5) |
| C-02 | `18` originally implied module frequency is a strong signal, but the regulation *requires* 2 questions per module — so frequency is ~1.0 for every module in a well-formed paper | **Resolved in `18` §3.** The feature is reframed around topic-level frequency and repeated questions; module frequency is shown only with its structural explanation |
| C-03 | `02` FR-045 forbids automated result retrieval while `DEC-004` requested polling | **Resolved.** FR-045 is a P0 *constraint*; `DEC-004` applies to announcements. Both documents now state this |
| C-04 | `09` shows `announcements` referencing `change_events` before that table is defined in document order | **Not a defect.** Document order is thematic; migration order will define referenced tables first. Noted for implementation |
| C-05 | `06` selects a long-running container while `25` initially listed serverless-friendly hosts | **Resolved in `25` §2.** The requirements table now mandates a long-running process and explains why (`06` §6.2) |
| C-06 | `11` states admins cannot read student records; `21` needed a review queue over student uploads | **Resolved.** The review queue operates on *documents*, not student records. Upload attribution is visible; the uploader's academic data is not |
| C-07 | `12` promises no third-party analytics while `31`/`29` require retention metrics | **Resolved.** Metrics are daily aggregate counters plus voluntary surveys; no per-student behavioural tracking (`12` §7, `29` §7) |
| C-08 | `16` percentage formula contradicts every third-party source | **Resolved in favour of the regulation** (22OB 6.7, `M = CGPA × 10`), with the discrepancy explained in-product (`28` §5) |
| C-09 | `05` prohibits stat-card walls while `03/UF-03` describes a dashboard of status items | **Resolved.** `05` §Stat row defines the dense alternative; the dashboard uses grouped rows, not one card per number |
| C-10 | `20` places attendance notifications in Alpha scope while `02` marks them P2 | **Resolved.** P2, listed in `30` §2 as a strong promotion candidate at feature freeze |
| C-11 | `23` targets 99% uptime while `24` says a solo operator cannot promise availability | **Resolved.** 99% is a best-effort target stated honestly to users, not an SLA (`30` §5, limitation 9) |
| C-12 | `17` allows student uploads while `13` treats uploads as hostile | **Not a contradiction — it is the design.** Uploads are accepted *and* treated as hostile; `17` §3 is the reconciliation |

---

### M2 cross-review — contradictions found and resolved

| # | Contradiction | Resolution |
|---|---|---|
| C-13 | `12` §12.3 listed DOB as collected while `DEC-008` removed it | **Resolved.** Inventory row struck through and marked not collected; DOB added to the "never collected" list; §12.4 rewritten around what removal deleted |
| C-14 | `25` listed `DOB_ENCRYPTION_KEY` in the environment table and a re-encryption rotation procedure | **Resolved.** Variable removed; the rotation note now records that no application-managed encryption key exists at all |
| C-15 | `13` A2 described the identity bundle as "name + USN + DOB + email" | **Resolved.** Asset redefined as name + USN + email, with impact downgraded accordingly |
| C-16 | `15` said GradTools "cannot automate" results — an incapacity claim contradicting `DEC-011` | **Resolved.** Rewritten as a scope statement; §15.5.1 added defining the `ResultProvider` interface and its current/future implementations |
| C-17 | `14` §7 prohibitions could be read as forbidding a future authorized provider | **Resolved.** A row added distinguishing an authorized integration (out of current scope, not permanently excluded) from prohibited scraping, plus a note that the interface is not a permission structure |
| C-18 | `17` §11 treated `OQ-008` as blocking the whole paper pipeline | **Resolved by `DEC-010`.** Two-tier corpus; `publication_tier` defaults to private with a rights `CHECK` constraint |
| C-19 | `01` positioning implied result-watching was the central promise | **Resolved by `DEC-012`.** Promise restated as the consolidation layer; results explicitly one component among many |
| C-20 | `16` cited the percentage formula correctly but nothing prevented a seed or code edit from reintroducing the 0.75 offset | **Resolved by `DEC-009`.** Formula stored as a RuleSet identifier; eight regression tests including two negative assertions; continuous data-quality check |
| C-21 | `02` FR-045 stated an absolute prohibition inconsistent with the amended scope language | **Resolved.** Reworded as a scope boundary; FR-046 added for the provider interface |
| C-22 | `31` M9 gate referenced `OQ-013` (DOB key management), now void | **Resolved.** Reference removed; R-09 downgraded and rewritten |

## Part E — Assumptions register

Consolidated from all documents. Each is a place where the product could be wrong.

| ID | Assumption | Impact if wrong | Where |
|---|---|---|---|
| A1 | The target college applies VTU 2022 regulations unamended | **High** — wrong figures | `01`, `OQ-011` |
| A2 | Students will maintain manual attendance entry | **High** — the feature's value collapses | `01`, R-06 |
| A3 | Public announcement pages are stable enough for change detection | Medium | `01` |
| A-16.1 | Fractional percentages truncate toward zero | Low | `16` |
| A-16.2 | The SEE 35% threshold is reading-independent | None — settled | `16` |
| A-16.3 | M = 50 resolves to Second Class | Low | `16` |
| A-16.4 | `AB` scores 0 points and is failure-equivalent | **Medium** | `16`, `OQ-018` |
| A-16.5 | Non-credit `PP`/`NP` courses are excluded from GPA | Low | `16` |
| A4 | Papers carry an extractable text layer | Medium — changes M5 effort | `OQ-019` |
| A5 | The local embedding model fits the container budget | Medium | `OQ-022` |
| A6 | Free/low-cost hosting meets the stated requirements | Low — budget exists | `OQ-020` |
| A7 | Students accept the "no automatic results" explanation | Medium — positioning risk | `29` §8 Q5 |

---

## Part F — Decision log

| Date | ID | Decision | By |
|---|---|---|---|
| 2026-08-23 | DEC-001 | Local-first with optional account | Human |
| 2026-08-23 | DEC-002 | USN, name, academic records stored server-side, with compensating controls (DOB later removed by DEC-008) | Human |
| 2026-08-23 | DEC-003 | VTU 2022, non-autonomous college | Human |
| 2026-08-23 | DEC-004 | Automated polling — announcements only; results student-entered (amended by DEC-011) | Human + verified constraint |
| 2026-08-23 | DEC-005 | React SPA + Express + Postgres | Human |
| 2026-08-23 | DEC-006 | Local embeddings; optional LLM for explanations, off by default | Human |
| 2026-08-23 | DEC-007 | Broad corpus collection + verified student uploads | Human |
| 2026-08-23 | ED-01…ED-20 | Engineering decisions in Part B | Engineering |
| M2 | DEC-008 | Date of birth removed from the product entirely | Human |
| M2 | DEC-009 | Percentage conversion is a versioned RuleSet identifier, with negative regression tests | Human |
| M2 | DEC-010 | Two paper corpora — private experimental now, public library gated on rights | Human |
| M2 | DEC-011 | `ResultProvider` abstraction; scope language, not incapacity language | Human |
| M2 | DEC-012 | Positioning: academic utility layer, results one component among many | Human |
| M2 | DEC-013 | Hosting: Railway Hobby for experimental, re-evaluate at Alpha for PITR | Engineering (pending approval) |
| M3 | DEC-014 | Supabase Auth as identity provider only; Express/Postgres/academic-rules stay authoritative | Human |
| M3 | DEC-015 | Onboarding order: identity before academic profile | Human |
| M3 | DEC-016 | Repository pattern with async interfaces from the start | Engineering |
| M3 | DEC-017 | Contrast tokens corrected against measurement | Engineering |
| M3 | ED-21…ED-26 | Frontend engineering decisions in Part B | Engineering |
| M5a | DEC-018 | Reference data served from PostgreSQL through Express; student data stays local | Human |
| M5a | DEC-019 | Publication gated on verification by database CHECK constraint, not application code | Engineering |
| M5a | ED-27…ED-30 | Server engineering decisions in Part B | Engineering |
| M4 | DEC-020 | A grade card's printed `External` is the SEE contribution out of 50; `16` §16.5's contrary claim corrected | Engineering (evidence: real artifact) |
| M4.1 | ED-31…ED-35 | Reference-data and rules hardening decisions in Part B | Engineering |
| M4.2 | ED-36 | University/Branch classified as internal taxonomy; the two integrity models made explicit | Engineering |
| M5A | ED-37…ED-41 | Document lifecycle, validator corrections and the localhost boundary in Part B | Engineering (ED-38/39 evidence: real corpus) |
| M5A.3 | DEC-022 | OCR implemented as specified by DEC-021: local Tesseract, asynchronous, no hosted service | Engineering |
| M5A.1 | DEC-021 | OCR, when implemented, will be **local Tesseract** — privacy is decisive and structural fidelity beats raw accuracy | Engineering (evidence: 10-document benchmark) |
| M6 | ED-71 | The degree is eight semesters, always shown | A student's view of their degree must not depend on how much they have typed in. Someone in their third year sees the four behind, the one they are in, and the three ahead |
| M6 | ED-72 | `SemesterResult` pins `ruleSetId` at entry | A regulation change applies to semesters sat after it, not to ones already completed. Records saved before M6 fall back to the active set AND say so |
| M6 | ED-73 | Strong/weak is distance from the student's OWN mean, not a percentile | A percentile always produces a loser and would call the bottom of a uniformly excellent set "weak". Distance from one's own average can honestly classify nobody |
| M6 | ED-74 | Nothing is classified below five graded subjects | "Not enough history yet" is a real answer. A first-semester student must not be told what they are bad at on two grades |
| M6 | ED-75 | A subject taken once has NO trend | Reporting "unchanged" would dress a single data point up as a flat line |
| M6 | ED-76 | Credits remaining is reported as unknown, never assumed | No verified per-scheme total exists in this build. A fabricated denominator under a real numerator would be the most quietly misleading number in the product |
| M6 | ED-77 | Backlogs have no exam-date field | A re-sit date is a university fact needing a verified source. A student-entered one would look identical and be trusted the same way |
| M6 | ED-78 | No server-side student table was added | Student data is local. The repository bundle is the boundary a future signed-in mode swaps, and nothing in M6 needed a schema |
| M5A.7 | ED-65 | The marks column is MEASURED, not assumed | v1's 0.7 fraction was 90–100pt too far left on every paper in the corpus. A column is a narrow stack of short tokens repeated down the page; that is findable, and a fraction is a guess |
| M5A.7 | ED-66 | No marks column found means no truncation, and nothing on that page may be `high` | Preserving text and flagging it beats deleting it silently. Without a column there is no positional evidence, so confidence would be unearned |
| M5A.7 | ED-67 | The right-hand columns anchor CELLS; a new question starts when the LABELLING restarts, not when a number appears | A `Q.1` centred across (a), (b), (c) physically sits beside (b). Row-at-a-time parsing cannot express that, which is why v1 recovered no number at all on such a paper |
| M5A.7 | ED-68 | Sub-question labels are found at a detected label column | The English article "A" is a lone letter matching `[a-d]`, and real cells open with it. v1 was right only by luck of token ordering |
| M5A.7 | ED-69 | MCQ instructions are dropped only when BOTH structural cues agree | Numbering restart alone would discard a paper that starts above 1; missing options alone would discard an item whose options OCR lost. Neither cue reads any language |
| M5A.7 | ED-70 | v1 is frozen and still runnable, not deleted | It produced the M5A.6 corpus. A baseline you cannot re-run is not a baseline, and the v1-vs-v2 comparison depends on running both over the same tokens |
| M5A.6 | ED-60 | The review queue is an ORDER, not a score | `review_required → low → medium → high`, defined once in a SQL function. A number would have to be invented and would blend how much the geometry agreed with how much work a record needs |
| M5A.6 | ED-61 | A corrected TEXT shows the machine's original underneath rather than struck through | Strikethrough is unreadable on a paragraph. The original is never hidden: a corrected record must stay distinguishable from one the parser got right, or the corpus cannot evaluate the parser |
| M5A.6 | ED-62 | The two defects the review found were NOT fixed in this milestone | The corpus exists to evaluate parser changes. Changing the parser in the same milestone that built the baseline would leave nothing to measure against |
| M5A.6 | ED-63 | Agent adjudication is stored under `agent-adjudication`, never as human review | The judgements are real evidence and are not human ground truth. One predicate tells them apart or removes them |
| M5A.6 | ED-64 | Rejected records keep full text contrast; the state is carried by a dashed edge and a word | `opacity: 0.62` put 15 nodes below AA contrast. The state was already in words, so the fade was decoration that cost readability |
| M5A.5 | ED-53 | Identity is `(document_id, parser_version)`; a new parser version creates a new `extraction_version` rather than overwriting | Makes re-running the parser a no-op and reprocessing additive. Human review recorded against an earlier run survives an upgrade, which "replace the rows" could not offer |
| M5A.5 | ED-54 | Machine columns immutable; corrections in `reviewed_*` beside them | Effective value is `COALESCE(reviewed_x, x)` and the original stays visible. An audit trail that cannot show what the machine said is not one |
| M5A.5 | ED-55 | `rejected` is a review state, never a delete | A removed row cannot tell a later reader whether the parser was wrong or the scan was. Low-confidence material is evidence, not noise |
| M5A.5 | ED-56 | MCQ items are a separate table, enforced by a composite FK on `(paper_id, paper_format)` | An MCQ paper has no modules, Bloom's level, CO or marks. Null placeholders would invite "missing" to be read where the truth is "not applicable" — and the rule is enforced by the database, not by application code |
| M5A.5 | ED-57 | OCR emits `txt tsv` in ONE recognition pass | The geometry then costs nothing beyond the text. Asking for it separately would double a ~759 ms/page workload to recompute what the engine already had |
| M5A.5 | ED-58 | `PDFTOTEXT_BIN` is explicit, not left to PATH | Xpdf and poppler both ship a `pdftotext` and only poppler's supports `-tsv`. The wrong one disabled native positional extraction silently — 0 questions from papers that had yielded 20 and 12 |
| M5A.5 | ED-59 | Installed OCR languages are asked for before the request, never inferred from failure | `-l eng+kan` without the pack returned English-only output with NO error and zero Kannada. There was no failure to detect afterwards, so the absence must be established first and reported |
| M5A.4 | ED-50 | Positional TSV, not hOCR | Same information and speed, half the bytes, no XML — but decisively, `pdftotext -tsv` emits the same schema, so native PDFs and scans share one representation. hOCR has no native counterpart |
| M5A.4 | ED-51 | Lines grouped by vertical overlap, not by the tools' line numbers | On a two-column paper the question text and its marks column are different blocks whose line numbers restart. Overlap is what reassembles `question \| marks \| L \| CO` as one row |
| M5A.4 | ED-52 | A numbered row with nothing in the right-hand table is an instruction, not a question | Positional and needs no reading of the words. Trade-off accepted: a question whose entire marks column was lost is skipped rather than kept — which is why the worst scan yields nothing rather than unreliable rows |
| M5A.3 | ED-48 | Worker refuses to start without `tesseract` and `pdftoppm` | A worker that starts and fails every job burns each job's retry budget and marks good documents unreadable for a reason unrelated to them. One clear message at boot beats a trail of false failures |
| M5A.3 | ED-49 | Shutdown drains the in-flight job rather than cancelling it | A half-processed document would leave its row `processing` with sections partly written. The recovery path exists for crashes, not for shutdowns we chose |
| M5A.3 | ED-43 | Job queue is a PostgreSQL table with `FOR UPDATE SKIP LOCKED`; no Redis or BullMQ | The database already provides atomic claim and durable state. A broker adds an operational dependency and a second source of truth to solve a problem one query solves (docs/23 §23.10) |
| M5A.3 | ED-44 | Extraction lifecycle is a separate column from document lifecycle | `extracted` would otherwise mean both "we ran extraction" and "we have usable text". A scan reaches `extracted` with no text at all |
| M5A.3 | ED-45 | OCR language retry triggers on failure to CLASSIFY, not on empty output | A Kannada page read with `eng` returns confident Latin gibberish, not nothing. An emptiness check accepts it and the retry never fires — observed on a real paper |
| M5A.3 | ED-46 | No numeric OCR accuracy score, ever | There is no ground truth, so a percentage would be invented rather than measured. Qualitative state plus a readable reason carries the meaning |
| M5A.3 | ED-47 | Mathematics flagged for review even when OCR succeeds | OCR recovers zero operators, Greek letters, superscripts or subscripts. The text is usable for search and must not be presented as the original |
| M5A.1 | ED-42 | `ocr_required` presented as a processing outcome, not an error | 54 of 63 accepted PDFs were scans; calling that a failure would tell most students their good paper had broken, and would devalue the message that does mean failure |
| M5 | DEC-021 | M5b and M6 become parallel tracks M5A/M5B over one shared source layer | Human |
| M5 | DEC-022 | Public paper tier stays hard-disabled; rights-unknown material is link-only | Human |
| M5 | DEC-023 | `results.vtu.ac.in` robots re-verified 2026-08-24 and seeded as permanently blocked | Human + verified constraint |
| M5 | DEC-024 | Documents stored via an object-store interface, local driver, outside the repository | Human |
| M5 | ED-37...ED-43 | Source and document engineering decisions in Part B | Engineering |
| M5.1 | ED-44...ED-46 | Fetch and publication gate hardening in Part B | Engineering |

---

### OQ-030 — Is Kannada extraction still working?

**Status:** OPEN · raised M5A.5

**Why:** M5A.2 qualified Kannada with `kan.traineddata` installed and recovered
3 922 codepoints. During M5A.5 real-document validation the same paper yielded
`unknown` format and zero Kannada, because the language pack is **no longer
installed on the development machine** (`tesseract --list-langs` → `eng`,
`osd`).

The pipeline now handles the absence honestly — English, a review flag, a stated
reason, and a startup warning (ED-59). What is NOT established is whether
Kannada extraction still performs as M5A.2 measured, because it has not been
re-run with the pack present.

**Decision needed:** whether to reinstall `kan.traineddata` and re-validate
Kannada now, or to defer it until bilingual papers are actually in scope. This
is a human decision because it involves installing a language model on the
user's machine.

**Consequence if deferred:** bilingual papers are read as English and marked for
review. Nothing produces wrong data silently; some documents are simply less
useful than they could be.

---

### OQ-031 — Human ground truth does not exist yet

**Status:** OPEN · raised M5A.6

**Why:** M5A.6 asked for 10–20 real papers reviewed by a human. What exists is
**71 records across 4 papers adjudicated by an AI agent** reading the rendered
pages — genuine independent evidence, stored honestly under
`agent-adjudication`, and not the same thing.

Every metric in docs/17 §17.18 inherits that limitation. They are defensible as
"what an independent reader saw when comparing the pages to the records"; they
are not defensible as human-confirmed ground truth.

**Decision needed:** whether a person reviews these 71 records (the workbench is
built and the queue is ordered, so it is now a sitting task rather than an
engineering one), or whether agent adjudication is accepted as the baseline for
parser evaluation with the caveat carried forward.

**Consequence if deferred:** parser changes can still be measured against a
consistent baseline. Nothing downstream may describe the corpus as
human-verified.

---

### OQ-032 — Question text is truncated at the marks column

**Status:** OPEN · raised M5A.6 · **measured**

**Why:** `analyseRow` removes every token past 70% of the page width as a
marks-column token. In a justified table cell the question text reaches that
far, so the last word or two of each line is deleted. **0 of 12 adjudicated
native sub-question texts were exact** (docs/17 §17.18), and every one of them
carried `high` structural confidence.

This is the single largest measured defect in the extraction pipeline, and it
was invisible before a reviewer compared records to pages.

**Options:**
1. Detect the marks column from the actual x-positions of the numeric column
   rather than a fixed 70% fraction.
2. Require a marks-column token to be a lone short token, not merely far right.
3. Both, then re-run against this corpus and compare.

**Recommendation:** (3). The corpus now exists precisely so a change like this
can be measured rather than argued.

---

**M5A.7 UPDATE — RESOLVED IN PARSER v2, NOT YET RE-ADJUDICATED.**

Option (3) was implemented (docs/17 §17.19). `detectMarksColumn` finds the
column from real token positions; option (2) is part of it, since only short
column-shaped tokens are candidates. Regression fixture A pins the defect
against v1 and the fix against v2, and the three real examples adjudication
recorded now come out exactly right:

| | v1 | v2 |
|---|---|---|
| `…full-wave ___ rectifier` | (blank) | **bridge** |
| `…of an ___ amplifier` | (blank) | **ideal operational** |
| `…phase shift ___ response` | (blank) | **and frequency** |

**This does not close automatically.** The 0/12 figure was measured by
adjudicating v1 output; **no v2 output has been adjudicated**. The defect is
fixed and regression-tested, and the claim "v2's text is right" has not been
measured. It closes when v2 records are reviewed — which is OQ-031's work.

**Status:** defect fixed and pinned; verification pending re-adjudication.

---

### OQ-033 — OCR papers gain unlabelled question records under v2

**Status:** OPEN · raised M5A.7 · **measured**

**Why:** v2 preserves material v1 discarded, which is the intended direction —
but where OCR destroyed a sub-question's label glyph, the recovered cell becomes
an unlabelled `low`-confidence QUESTION instead of a part of its question.

On `BCHEM102` page 1 the two sub-parts v1 dropped entirely (`Q3 b` and `Q3 c`)
now appear, read as `db. What is Anodizing?` and `¢. | What is CPR?`. Both are
present and flagged; neither is correctly slotted. Across the corpus this shows
as `BCHEM102` 10→24 questions, `BCIVC103` 7→21, `BMATS101` 8→25, and `BCY358A`
0→14.

**The trade, stated:** v1 lost the records silently; v2 keeps them and says it
is unsure. For building a reviewable corpus that is better. For counting
questions it looks worse, which is why both directions are reported and neither
is called accuracy.

**Options:**
1. Accept it — the records are `low` and a reviewer resolves them.
2. Attach an unlabelled cell to the preceding question when it sits inside that
   question's vertical span and before the next question number.
3. Recover the label from the cell's leading token by edit distance to `a`–`d`
   — deterministic, but a text heuristic rather than a geometric one.

**Recommendation:** (2), measured against this corpus. (3) is the kind of
guess this project has avoided so far.

**Decision needed:** none yet. Recorded so the count change is not mistaken for
a regression.

---

### OQ-034 — The total credits for a degree are not established

**Status:** OPEN · raised M6

**Why:** Graduation progress can show credits earned and semesters completed —
both are real. It cannot show credits REMAINING, because no verified total
exists for a scheme in this build. The reference schema holds per-subject
credits (`subjects.credits`), so a total is derivable in principle, but only for
a scheme and branch whose subjects are complete, verified and published for all
eight semesters. None is.

**Options:**
1. Derive the total by summing verified published subjects for the student's
   scheme and branch, and show it only when all eight semesters are covered.
2. Record a per-scheme total as verified reference data with its own source
   citation, as the rule sets already are.
3. Leave it unknown.

**Recommendation:** (2). A degree's credit requirement is a regulation fact with
a citable source, which is exactly what the reference tables are for; deriving
it by summation would silently produce a wrong total the moment one subject is
missing.

**Decision needed:** none urgently — the screen is honest today. This is
recorded so the gap is not mistaken for an oversight.

---

### OQ-035 — Semester 5 pilot readiness

**Status:** OPEN · raised M6

**Why:** The project owner begins semester 5 in September 2026, and M6 was built
so that the before / during / after of a real semester is supported (M6 §3).
What has NOT happened is a real student using it for a real semester.

Nothing in the code knows about that date, and nothing may be made to: a
semester's status is set by the student, never derived from the calendar
(`ED-71`). The pilot is a roadmap commitment, not business logic.

**What the pilot would establish:** whether entering four years of history is
tolerable in one sitting, whether the strong/weak rule reads as fair, whether
"not enough history yet" is understood rather than read as a bug, and whether
attendance and the subject list stay in step over a term.

**Decision needed:** none from engineering. Recorded so the milestone's purpose
is not lost between now and September.

### OQ-032 — How announcements reach a student who is not in the app · **opened by M7**

**Why unresolved:** M7 delivers everything about a notification except delivery.
In-app unread state works; an opt-in browser notification works *while the app
is open*; nothing reaches a student who has closed it.

Real delivery means Web Push — VAPID keys, a service worker, a subscription
store, and therefore a **server-side identity**, which Stage 1 deliberately does
not have (`09` §9.16). The interface says so plainly rather than implying
background delivery.

**Options:** (a) wait for M9 and build Push on the identity it introduces;
(b) email digests, which need an address and therefore the same identity;
(c) accept that GradTools notifies only while open, and say so permanently.

**Recommendation:** **(a)**, sequenced after M9. Push before identity means
inventing a device-identity scheme purely to notify, which is a tracking
identifier by another name.

**Decision needed:** at M9, not before.

### OQ-033 — Who verifies announcements at any scale · **opened by M7**

**Why unresolved:** nothing is published without a human verifying it, and a
content change withdraws that verification (`14` §14.15). That is correct and it
does not scale: one operator is the entire verification capacity, and a source
producing daily notices would outrun them.

**What M7 chose anyway:** the bottleneck. An unverified notice not shown is a
student who missed something; an unverified notice shown is a student misled by
GradTools. The second is worse, and it is the failure that destroys the reason
to use the app at all.

**Decision needed:** before a source is enabled — not before, since with no
source there is nothing to verify.

### OQ-034 — Who classifies a document as a question paper · **opened by M8**

**Why unresolved:** `document_kind` defaults to `unknown` and nothing infers
it, so a paper is invisible to the library until a person says what it is and
which subject and sitting it belongs to. That was the right default — the
alternative is guessing a year out of a filename — and it makes classification
a manual step nobody has been assigned.

**What this costs today:** nothing, because there are ten demo papers. It
becomes the bottleneck the moment a source is enabled, in the same shape as
announcement verification (`OQ-033`).

**Options:** (a) an operator classifies each paper in an admin surface (M11);
(b) a source adapter supplies taxonomy with the document and an operator
confirms it; (c) accept a permanently partial library where unclassified papers
are simply not findable.

**Recommendation:** **(b)** where a source provides structured metadata, with
(a) as the fallback. Never inference from filenames.

**Decision needed:** before a paper source is enabled, not before.

### OQ-035 — What "recently added" means once papers arrive in bulk · **opened by M8**

**Why unresolved:** the library offers "recently added", ordered by
`created_at`. A single bulk import of a few hundred papers would fill that
ordering with one afternoon's work and make the control useless for months.

**What M8 chose anyway:** the honest field. `created_at` is when GradTools got
the document; there is no other timestamp that is not invented.

**Options:** drop the sort once volume arrives; group bulk imports as a batch
and order by batch; or leave it and accept that it answers "what did the
operator do most recently", which is what it literally says.

**Decision needed:** when a bulk import first happens. Not before, and not by
guessing at it now.

### DEC-022 — Google, Apple and email/password, superseding the magic-link decision · **M9**

**Decided by the human.** `11` §11.2 chose an emailed magic link and explicitly
rejected Google OAuth because it "adds a third-party dependency that learns
which students use GradTools". M9 reverses that.

**The cost is recorded rather than argued away.** Google and Apple learn that a
person authenticated to GradTools; that is a real disclosure and §11.2 was right
that it was avoidable. What is gained is sign-in that works on a shared or slow
connection without waiting for an email.

**What did not change:** GradTools stores no password, hashes nothing and runs
no reset flow. Supabase Auth owns the credential entirely (`11` §11.12).

### OQ-036 — Provider configuration · **PARTIALLY RESOLVED in M9.2**

**Email: CLOSED.** Configured on the live project and exercised end to end — a
real sign-in in a real browser, a real token, a real session restored across a
refresh and a second tab (`11` §11.14, `22` §22.19).

**Google and Apple: STILL OPEN, and untouched.** The live project reports
`google: false` and `apple: false`. Google needs an OAuth client in Google Cloud
Console; Apple needs a paid Apple Developer account, a Services ID and a signing
key. Both are external setup a person must perform, and Google's consent screen
cannot be automated in any case. **Neither has ever been exercised.**

**Leaked-password protection: STILL OPEN, and now more pressing.** It is
disabled, Supabase's own advisor flags it, and email/password is now a live
sign-in method. One dashboard toggle.

**Decision needed:** none from engineering. Two dashboard tasks and, for Apple,
a paid account.

---

*The original text of this question follows.*

### OQ-036 — Provider configuration is outstanding · **opened by M9**

**Why unresolved:** the Google and Apple code paths exist and are one function
apart, but neither provider is configured. Google needs an OAuth client and a
redirect allowlist in the Supabase dashboard; Apple additionally needs a paid
Apple Developer account, a Services ID and a signing key.

**Consequence today:** those two buttons reach a provider that is not set up.
**No Google, Apple or email sign-in has ever been performed**, and no claim that
they work appears in this repository (`22` §22.17).

**Also outstanding:** leaked-password protection, which Supabase's own advisor
flags and which matters now that email/password is a supported method.

**Decision needed:** none from engineering. A dashboard task and, for Apple, a
paid account.

### OQ-037 — How a student resolves a conflict · **opened by M9**

**Why unresolved:** conflicts are detected, both versions are shown, and the
student is told to edit the record on the device they want to keep and sync
again. That is honest and it is clumsy.

**What M9 chose anyway:** clumsy over silent. For an attendance count or a
grade there is no arithmetic that is right — 12 and 14 do not average to
anything meaningful — so the alternatives were "ask" or "pick one and hope".

**Options:** a keep-mine / take-theirs control on each conflict; a merge screen
per collection; or leaving it as is until conflicts are observed to happen.

**Recommendation:** wait for evidence. Conflicts need two devices and a real
student, and neither exists yet.

**Status after M9.2: STILL OPEN, and the mechanism is now proven.** A real
conflict was exercised — one device wrote 30→31, a stale device wrote 30→32 with
the same base revision, and the server answered `conflict` carrying its own
value of 31 rather than picking a winner. Two different subjects of one result
updated independently. So the detection works; what remains unknown is whether
"edit it on the device you want and sync again" is good enough for a student,
and that still needs a real student rather than a test.

### OQ-038 — Whether local data should be lockable on a shared device · **opened by M9**

**Why unresolved:** signing out deliberately leaves an account's records on the
device (`12` §12.14), and storage is account-scoped so the next person cannot
read them through the app. But they are still in that browser's IndexedDB, and
somebody with developer tools can read them.

**What M9 chose:** not deleting a student's work on sign-out, because losing
records to a routine action is the worse failure.

**Options:** offer "remove my data from this device" alongside sign-out
(a `clearScope` call already exists); encrypt the scope with a key derived from
the session; or state the limitation and leave it.

**Decision needed:** before any shared-device pilot, such as a college lab.

**Status after M9.2: STILL OPEN, with the app-level half now evidenced.** Two
accounts on one browser were written and read back: each scope holds its own
records and lacks the other's, and signing out left A's data in place for A's
return. That closes the question of whether the *application* leaks between
accounts. It does not touch the original concern — the data is still in that
browser's IndexedDB, and developer tools read it regardless of who is signed in.
**Browser-profile isolation is not physical-device security**, and this question
stays open until either a lock exists or a pilot decides it does not need one.

### DEC-023 — `Panel` is a section, not a box · **M9.3**

**Decided during the redesign.** The single container primitive was used 46
times and drew a background, a border and a radius every time, which gave every
region of every page identical visual weight.

`Panel` now renders a heading and its content with no container. `boxed` opts
into a real one, for a form, an embedded document or a distinct sub-surface.

**The rule this encodes:** a border clarifies a grouping; it does not draw a
box. Where a heading and some space already group things, a border adds weight
and no information.

**What it cost:** eight test assertions had to be rewritten — none weakened —
and the results page grew 3% because subject names were added beside codes.

### OQ-039 — Whether the paper library needs pagination · **opened by M9.3**

**Why unresolved:** the library renders 50 rows per page and, against the
2,008-row synthetic library, that is still 5,031 px of scrolling even after the
rows were compacted from five lines to two.

**What M9.3 chose:** density over paging. Fifty scannable rows are more useful
than ten pages of five, and the search and filters are the intended way to
narrow a large library.

**What would change the answer:** a real library. Ten synthetic papers and 2,008
synthetic papers are the only sizes ever observed, and neither is what a real
collection looks like. `OQ-008` keeps the real one nearly empty.

**Decision needed:** when a real library exists, not before.

### OQ-040 — Whether an SGPA trend chart is worth drawing · **opened by M9.3**

**Why unresolved:** the SGPA/CGPA page could show semester history as a small
line. M9.3 §14 permits one where it is meaningful and forbids one drawn for the
sake of having a chart.

**What M9.3 chose:** not to build it. A student with two completed semesters has
two points, and a line through two points is decoration pretending to be
analysis. The history is already legible as a list.

**What would change the answer:** evidence that students read a trend they
cannot get from four numbers in a column. That needs the pilot.

**Decision needed:** after the Semester 5 pilot, if at all.

### DEC-024 — The viewport decides density; the system decides theme · **M9.4**

**The question.** The M9.4 references are a dark violet desktop product and a
light lavender phone app. The obvious implementation is a media query: dark
above 768px, light below.

**Rejected.** Keying theme to viewport means the product changes colour when a
window is dragged across a breakpoint, a tablet is two different-looking
applications depending on how it is held, and `prefers-color-scheme` — the one
signal that actually states a preference — is overridden by a number that
states nothing about the person.

**Decided.** Dark is the default and the identity at every width. The light
theme is the mobile reference's palette and arrives from the system preference.
The mobile reference's real contribution is structural — large rounded modules,
solid high-contrast pill actions, circular icon buttons, a bottom bar with an
active indicator, tinted chips — and every one of those reads correctly in both
themes.

**Consequence.** Both themes must now pass QA. The full axe/overflow/console
sweep runs twice, and the only defect M9.4 introduced was visible in one theme
only.

### DEC-025 — Two accent tokens, not one · **M9.4**

**Decided** after `.primaryLink` shipped white text on `--accent` at 2.72:1.

`--accent` is a text colour and must clear 4.5:1 on the ground. `--action-bg` is
a fill and must clear 4.5:1 against the text on it. **No single mid-violet
satisfies both**, and a system with one accent token guarantees that somebody
eventually uses it for the wrong one.

`--action-bg` is violet on dark and near-black ink on light. The rule beneath
both is the same — the most confident fill this ground allows — so it stays one
button rather than becoming two.

**Enforcement is by convention, not by tooling.** Every remaining
`background: var(--accent)` in the codebase is a progress-bar fill with no text
on it, and the axe sweep in both themes is what catches a regression.

### OQ-041 — Whether GradTools needs a real typeface · **opened by M9.4**

**Why unresolved:** the references' display type is a light geometric grotesque,
and the hierarchy depends on that lightness. The stack is
`Inter, system-ui, …` with **no `@font-face`**, so on most machines it is not
Inter at all — it is Segoe UI on Windows, San Francisco on macOS. `weight-light`
and negative tracking approximate the reference well enough that the difference
did not show up in visual QA, but the product does not currently control its own
type.

**What M9.4 chose:** not to load a webfont. A self-hosted variable face is
40-120 kB against a 201 kB gzipped bundle, for a difference no student would
name, and §20 forbids spending performance on visuals.

**What would change the answer:** evidence that the system stack breaks the
hierarchy somewhere real — a Linux machine with a poor `system-ui`, or a
rendering that makes `weight-light` illegible at 25px.

**Decision needed:** if a device is found where the hierarchy visibly fails.
Not before.

### OQ-042 — Whether the light theme is a real product or a fallback · **opened by M9.4**

**Why unresolved:** the light theme was built because the mobile reference is
light, and it is complete, tested and AA-clean. But nobody has used it. Every
design judgement in M9.4 — how much ambience, how dark the ink on the pill, how
tinted the chips — was made looking at the dark theme first.

**What M9.4 chose:** ship both, treat dark as the identity, hold the light
theme to the same QA bar rather than to a lower one.

**What would change the answer:** pilot data on what students' phones are
actually set to. If it is overwhelmingly light, the light theme is the product
and the design priority inverts.

**Decision needed:** after the Semester 5 pilot.

### DEC-026 — Navigation is horizontal, in two tiers · **M9.5**

**Rejected: one horizontal row of all eleven destinations.** At a readable size
with icons it is over 1100px before the brand and the actions, so it would wrap
on most laptops — and a navigation bar whose height changes as you move through
it is worse than a sidebar.

**Rejected: a row of seven with the rest behind a menu.** It hides destinations
behind a click, needs focus management and a dismiss behaviour, and puts
Announcements somewhere a student has to learn.

**Decided: two tiers.** Areas on top, the open area's destinations beneath.
Nothing is hidden, the current page is always marked, both rows are a fixed
height, and eleven destinations fit at 320px because both scroll sideways.

**The cost, stated plainly:** reaching a destination in a closed area is two
clicks rather than one. A sidebar's eleven permanent links were one click each
and 232px of every screen; this is the trade that was chosen.

### DEC-027 — `Module` returns, with a test for when to use it · **M9.5**

M9.3 removed the app's only container because it was used 46 times and
flattened every page. **That correction overshot.** With no container at all, a
page became a single column of hairlines with nothing for the eye to rest
against, which is most of why M9.4 still read as "the old app in violet".

The reference application is neither: a main column of content beside a rail of
bordered modules, where the border marks content that is **not part of the main
reading order**.

The rule, so this does not oscillate a third time:

> Would this content still make sense lifted off the page entirely?
> **Yes** → module. **No, it is the next paragraph of the page's argument** →
> section.

### OQ-043 — Whether two clicks to a closed area is acceptable · **opened by M9.5**

**Why unresolved:** `DEC-026` trades one click for a smaller, honest navigation.
Whether that trade is right depends on how often a student crosses areas — from
Dashboard to Question papers, say — and nobody has measured it because nobody
has used the product.

**What M9.5 chose:** the two-tier bar, with the dashboard rail's "Go to" list
and the mobile bottom bar both offering direct routes into Academics as a
partial mitigation.

**What would change the answer:** pilot evidence that cross-area movement is
common. The fix would be a small "recent" or "pinned" row, not a return to the
sidebar.

**Decision needed:** after the Semester 5 pilot.

### DEC-028 — One container primitive, and it draws a surface · **M9.5.1**

**This is the third position the project has taken on containers, so the
history matters.**

| | Position | Why it moved |
|---|---|---|
| Pre-M9.3 | `Panel` draws a box, used 46 times | Every region carried identical weight; a screen of equal boxes has no hierarchy |
| M9.3 | `Panel` draws nothing; `Section` is the default | Overshot: with nothing drawn anywhere a page is a column of hairlines on the page ground, and both references put content ON something |
| **M9.5.1** | **`Panel` draws a surface; `Section` is deleted** | One primitive. Hierarchy comes from size, position and type — not from which regions are allowed a border |

The M9.3 diagnosis was right and its remedy was the wrong lever. Equal weight
was caused by every region being the same *size* in a single-column layout, not
by the border. Two columns, a real type scale and a rail fixed the weight
problem; the border was never the culprit.

**What stops it oscillating again:** the rule is now about what hierarchy comes
*from*, not about what a border is *for*. A future milestone that wants to
remove borders must first say what will carry hierarchy instead.

### DEC-029 — Dense collections get one surface, not fifty · **M9.5.1**

The question `OQ-039` kept circling: the reference's list is made of cards, and
2,008 papers as cards is an absurd page.

**Both horns were false.** The reference's list is not fifty bordered cards — it
is *one* bordered surface with dense rows and hairlines inside it. One border
for the whole library, at the same row height GradTools already had.

Applied to Question papers, Results (one panel per semester) and Attendance.
`OQ-039` (pagination) is unaffected and stays open.

### DEC-030 — No mean SGPA · **M10A**

§6 asks for "average where mathematically appropriate". **It is not
appropriate here**, and the refusal is worth recording because the code to add
it is one line.

CGPA is credit-weighted. An unweighted mean of SGPAs is a different quantity,
and the two diverge whenever semesters carry different credit loads. Shown side
by side, a student has no way to tell which one their college means — and
`cumulativeStanding` already produces the authoritative figure.

`semesterHistory` therefore reports the **observed** extremes, the highest and
lowest actual SGPA, and leaves averaging to the rules engine. A test asserts
that no `mean`, `meanSgpa` or `average` property exists, so re-adding one means
deleting the test that explains why it should not.

**Overrulable.** If the owner wants it, the shape is decided: it belongs beside
CGPA with an explicit label distinguishing it, not in the history panel.

### DEC-031 — No Insights route; extend "My degree" · **M10A**

§34 allows a dedicated intelligence area "if the information architecture
supports it". It does not. "My degree" already holds standing, the eight
semesters, subject strengths, backlogs and graduation progress — the same
question, already answered in one place. A second page would have duplicated
most of it and added a seventh chip to the Academics tier.

**What would change the answer:** enough additional analysis that "My degree"
stops being one page about one question. Attendance intelligence and
question-paper intelligence both live elsewhere already, so that is not close.

### DEC-032 — Change is measured against the immediately preceding semester · **M10A**

A delta is reported only when **both** the semester and the one directly before
it carry a computed SGPA. Across a gap it is `null`.

The alternative — reaching back to the last comparable semester — would report
semester 3 as "+1.0 on the previous semester" when semester 2 was never entered.
That is a comparison the student never made, and §6 forbids comparing
incomparable records. The cost is that a student with a gap sees fewer deltas,
which is the honest outcome.

### OQ-044 — Is "Based on N graded semesters of 8" reassuring or alarming? · **opened by M10A**

**Why unresolved:** the sentence is factually necessary — a CGPA over four
semesters means something different from one over one, and §19 requires saying
so. But nobody has read it. It may land as useful context or as a nag about
incomplete data-entry.

**What M10A chose:** state it plainly, once, on the panel the figures live on,
in the muted colour rather than as a warning.

**What would change the answer:** pilot feedback. If students read it as
pressure, the fix is placement (inside the figure's own explanation) rather than
removal — the fact cannot be dropped.

**Decision needed:** after the Semester 5 pilot.

### DEC-033 — Repetition and similarity are built but not surfaced · **M10B**

The method exists, is tested, and has documented semantics separating exact
repeat from similar question from same topic. **It is not shown to students.**

The corpus is nine current papers covering nine different subjects in one
sitting. No question in it can repeat, so every repetition result would be zero
— and a student reading "found in 0 indexed papers" on every question would
reasonably conclude that VTU does not repeat questions. That is a claim about
the world derived from a limitation of our library (§64).

**What unblocks it:** two or more sittings of the same subject in the corpus.
Nothing about the method needs to change.

### DEC-034 — Search matches the effective text, and says which it is · **M10B**

Reviewed text where a reviewer wrote one, machine text otherwise, with
`isReviewed` on every row. Carrying both through search would be weight without
a use; the flag is what changes how a row should be read.

Zero records in the local corpus carry reviewed text, so in practice every
result today is machine output — which is exactly why the UI says so once, above
the list.

### OQ-045 — When does a corpus become large enough to evaluate similarity? · **opened by M10B**

**Why unresolved:** the honest minimum is not a row count. It is *two sittings of
one subject*, without which precision and recall are both undefined. A second
threshold matters too: 65 of 126 current questions have empty text, so the
usable corpus is half its nominal size.

**What M10B chose:** measure, publish the numbers, and gate the feature.

**Decision needed:** when the library grows, and `OQ-008` (rights) is what
governs whether it can.

### OQ-046 — Should the search UI expose review state as a filter? · **opened by M10B**

The API supports `reviewed=true|false`; the UI does not offer it. With zero
reviewed records the filter would return nothing, and a control that always
returns nothing is worse than an absent one.

**Decision needed:** once human review has produced a meaningful number of
records.
