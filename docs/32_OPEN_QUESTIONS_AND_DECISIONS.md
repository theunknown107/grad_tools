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
| ED-36 | `universities` and `branches` are **internal taxonomy**, not verified reference data; no provenance columns added | The test: does the row make a checkable claim about the external world that could change a calculation? VTU is the product's scope anchor; `cse` is a join key. `docs/09` §9.4 already drew this line. Inventing a source URL for "VTU exists" would be fabricated provenance, which is worse than none. The real defect was the queries — `listUniversities()` filtered nothing — fixed by adding `universities.active` in `0003` |
| ED-37 | One shared `sources` registry for both M5 tracks, rather than per-subsystem source fields | Documents and announcements ask the same two questions: where is this from, and may we show it. Two answers drift, and rights end up duplicated on every table that holds material |
| ED-38 | Terms review is part of the enable CONSTRAINT, not a note beside it | robots and terms answer different questions and can disagree. VTU proves it: `vtu.ac.in` robots permits announcements while its terms are unreviewed. A robots-only gate would have let that source be enabled on the strength of a check that does not address reuse |
| ED-39 | Four presentation modes (`host`/`link`/`private`/`blocked`) rather than a two-tier public/private flag | While `OQ-008` is open, "we know where it is" is the useful state and a flag cannot express it. `link` additionally refuses to store bytes: holding a file we may not redistribute is the risk, not the metadata |
| ED-40 | Storage keys derived from the content hash, never from a filename | Path traversal is designed out rather than filtered. With no attacker-controlled input reaching a path there is nothing to escape, and deduplication comes free from the same decision |
| ED-41 | `fetch` is not a method on `SourceAdapter` | An adapter describes how to read a source; it does not carry permission to read it. Separating them makes `parse`/`normalize`/`validate` pure and fixture-testable, and makes the permission check impossible to forget |
| ED-42 | `ocr_required` is reported, never acted on | Silently OCR-ing every scan would make a document whose text was guessed indistinguishable from one whose text was read, and everything downstream depends on that difference |
| ED-43 | Migration runner takes a `pg_advisory_lock` | Two processes migrating concurrently both see a pending migration and the second fails on a duplicate type, which is exactly what a rolling deploy does. Found by two test files racing |

Any of these may be reversed; each names the condition under which reversal would make sense.

---

## Part C — Open questions

Every entry states why it is unresolved, the options, a recommendation, and exactly what decision is needed.

### OQ-006 — Terms-of-use review for `vtu.ac.in` · **BLOCKING M6 — remains open**
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

### OQ-008 — Redistribution rights for question papers · **NARROWED — blocks public library only**
**Why unresolved:** whether a third party may host and redistribute VTU question papers is genuinely unclear. **NOT VERIFIED.**
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

### OQ-019 — Do real VTU papers carry a text layer?
**Why unresolved:** unknown until papers are supplied. Determines whether OCR is an edge case or the main path, materially affecting M5's effort and the accuracy of everything downstream.
**Recommendation:** test 10 papers as soon as they arrive, before building the pipeline around either assumption.
**Decision needed:** none — an engineering validation task, but it may change the M5 estimate significantly.

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

### OQ-026 - VTU announcements terms of use - **BLOCKER for M5B activation**
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
| M5 | DEC-021 | M5b and M6 become parallel tracks M5A/M5B over one shared source layer | Human |
| M5 | DEC-022 | Public paper tier stays hard-disabled; rights-unknown material is link-only | Human |
| M5 | DEC-023 | `results.vtu.ac.in` robots re-verified 2026-08-24 and seeded as permanently blocked | Human + verified constraint |
| M5 | DEC-024 | Documents stored via an object-store interface, local driver, outside the repository | Human |
| M5 | ED-37...ED-43 | Source and document engineering decisions in Part B | Engineering |
