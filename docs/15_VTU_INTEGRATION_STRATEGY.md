# 15 — VTU Integration Strategy

**Status:** Phase 1 draft
**Rule governing this document:** nothing about VTU's systems, policies or willingness is invented. Verified facts carry a source; everything else is marked **NOT VERIFIED**.

---

## 15.1 The two tracks, kept separate

| | Track A — Public data (now) | Track B — Institutional integration (someday) |
|---|---|---|
| Basis | Publicly published information | A formal agreement that does not exist |
| Access | Adapters over public pages, robots-respecting | Official feeds or an API |
| Status | **Buildable now**, within the limits in §15.3 | **Not available. Not requested. Not promised.** |
| Data | Announcements, syllabus, scheme documents, papers | Results, enrolment, attendance, official notices |
| Risk | Source changes, ambiguous terms | None yet — nothing has been built or claimed |

**These tracks are never conflated in code, UI, documentation or conversation.** Track A data is labelled with its public source. No screen implies Track B exists.

## 15.2 Verified facts about VTU

Everything in this section was retrieved and verified during Phase 1 (2026-08-23).

### Regulations — VERIFIED

**Source:** *Visvesvaraya Technological University, Regulations Governing the Award of Bachelor of Engineering/Technology Degree, 2022 (`22OB`)*
**URL:** `https://vtu.ac.in/wp-content/uploads/2023/05/Regulations-Clr-BE-BTECH-2022-611-02052023.pdf`
**Retrieved:** 2026-08-23 · **Method:** direct download, text extracted with `pdftotext -layout`

The academic rules extracted from it are recorded with clause citations in `16_ACADEMIC_RULES_ENGINE.md`. Summary of what is verified: attendance requirement and condonation (22OB 3.7), CIE/SEE structure and weights (22OB 4.1–4.2), passing standards (22OB 6.3), grade table (22OB 6.1), special grades (22OB 6.2), SGPA and CGPA formulas (22OB 6.6), percentage conversion (22OB 6.7), class equivalence (22OB 6.8), SEE question-paper structure (22OB 4.x).

### robots.txt — VERIFIED

| Host | Content | Date |
|---|---|---|
| `results.vtu.ac.in` | `User-agent: *` / `Disallow: /` | 2026-08-23 |
| `vtu.ac.in` | `Disallow: /wp-admin/` · `Allow: /wp-admin/admin-ajax.php` | 2026-08-23 |

Re-verified automatically every 7 days by the ingestion subsystem (`14` §4). A change to either invalidates the corresponding decision here.

### Public materials — PARTIALLY VERIFIED

Scheme and syllabus documents are published on `vtu.ac.in` (e.g. `https://vtu.ac.in/pdf/2022syll/csesch.pdf` and the B.E./B.Tech pages). Their existence is verified; the completeness and current-version status of any particular file is **NOT VERIFIED** and must be checked per document at ingestion time.

## 15.3 What is NOT verified — and must never be assumed

| Claim | Status |
|---|---|
| VTU offers any public or partner API | **NOT VERIFIED.** No evidence of one was found. No GradTools design may assume it. |
| VTU permits automated access to `vtu.ac.in` beyond robots.txt | **NOT VERIFIED.** robots.txt permits crawling; the site's terms of use have not been reviewed (`32/OQ-006`). |
| VTU would consider an institutional partnership | **NOT VERIFIED.** No contact has been made and none is planned before Stage 5. |
| Result data may be redistributed | **NOT VERIFIED**, and the question is moot — GradTools does not retrieve result data. |
| Question papers may be redistributed | **NOT VERIFIED.** Genuinely unclear; see `32/OQ-008`. |
| The target college follows VTU 2022 regulations without local amendment | **NOT VERIFIED.** Requires a college document (`32/OQ-011`). |
| Any endorsement, affiliation or approval | **DOES NOT EXIST.** Stating otherwise is prohibited (`28`). |

**Rule:** if a design decision requires any row above to be true, the design is wrong and must be reworked to not need it.

## 15.4 Track A — what is actually built

| Data | Source | Method | Status |
|---|---|---|---|
| Announcements / circulars | `vtu.ac.in` public pages | Adapter, 6-hour interval, robots-permitted | Buildable at Milestone 6, after terms review |
| Scheme and syllabus documents | `vtu.ac.in` published PDFs | **Manual download + operator import**, not scheduled crawling | Buildable now |
| Subject and credit tables | Scheme PDFs, hand-verified | Manual data entry with per-subject source URL | Critical path (`02` §2.6) |
| Academic rules | Regulation PDF, clause-cited | Manual, verified, versioned | **Done in Phase 1** (`16`) |
| Question papers | Mixed public and contributed | Manual/operator import, per-document provenance | Milestone 5, subject to `OQ-008` |
| Per-student results | — | **None.** Student enters or pastes their own | Permanent design position |

Note that four of the six rows are **manual**, not scraped. This is deliberate: for data that changes once per scheme revision, a scheduled crawler is more machinery, more risk and more failure modes than a person downloading a PDF once a year.

## 15.5 The results question

Results are the feature students want most and the one GradTools does not automate today. The position, in full:

**Automated retrieval of individual VTU result records is outside the current scope, unless an official or otherwise authorized integration becomes available.** This is a scope boundary set by the conditions that exist today, not a claim that GradTools is permanently incapable of consuming result data.

GradTools does not retrieve results from `results.vtu.ac.in`. Three independent reasons, any one of which would be sufficient:

1. **robots.txt disallows all automated access to that host** (verified, §15.2).
2. **Per-student retrieval would require submitting a student's identifiers to the portal on their behalf** — an automated action against a university system using a student's identity. GradTools does not do this (`14` §7).
3. **Such portals commonly employ CAPTCHA and similar controls.** GradTools never bypasses them, so the path is closed regardless.

**What GradTools does instead:**
- The student enters or pastes their own result (FR-040, FR-044) — their data, their action, no intermediary.
- Everything downstream works identically: SGPA, CGPA, backlogs, analytics, targets.
- The announcements adapter can surface *that* a results-related notice was published on the public site, described accurately as a change detected in a public source — never as "your result is out" (FR-063).

**How this is communicated** (`03/UF-08b`): plainly, as a deliberate choice, in the product. Handled well it reads as integrity rather than limitation, and it is the answer to the first of Persona C's three questions.

### 15.5.1 The Result Provider abstraction

The scope boundary is a **policy** decision about which providers exist, not a **structural** decision that welds manual entry into the domain layer. GradTools therefore ingests results through a provider interface from the first line of code.

**Today:**
```
Student result import (manual entry / paste / file)
        ↓
   ResultProvider interface
        ↓
   Normalizer → Validator → Result records → GradTools
```

**If an authorized integration ever exists:**
```
VTU (or college) — approved / authorized integration
        ↓
   ResultProvider interface          ← same interface, new implementation
        ↓
   Normalizer → Validator → Result records → GradTools
```

```
interface ResultProvider {
  key: string                      // 'manual-entry' | 'paste-parse' | future authorized providers
  kind: 'user_supplied' | 'authorized_integration'
  authority: 'student_asserted' | 'official'
  parserVersion: string

  fetch(ctx): Promise<RawResultPayload>       // for manual entry this is the submitted form/text
  parse(raw): ParsedSemesterResult            // pure
  normalize(parsed): NormalizedSemesterResult // pure
  validate(normalized): ValidationResult      // pure
}
```

**Properties this buys, all of which matter now rather than hypothetically:**

| Property | Why it pays off today |
|---|---|
| Manual entry and paste-parsing share one contract | Both already exist (FR-040, FR-044); without the interface they would be two divergent code paths |
| `authority` is recorded on every result | The `sgpa_asserted` vs `sgpa_computed` distinction (`08`) already depends on knowing whether a value is student-asserted |
| Validation is uniform | A result is validated identically regardless of origin — the same guarantee `14` gives external sources |
| Provenance is uniform | Every result records how it entered the system |
| A future provider is an implementation, not a rewrite | Adding an authorized integration touches one module |

**Constraint, binding:** implementing a `ResultProvider` whose `kind` is `authorized_integration` requires a documented authorization. The interface's existence is **not** permission to build a scraping provider — the prohibitions in `14` §7 apply to every provider without exception, and a provider that scraped a disallowed host would violate them exactly as a source adapter would.

**Do not describe GradTools as unable to ever retrieve VTU results.** The accurate statement, used in documentation, product copy and any institutional conversation, is: *"Automated retrieval of individual VTU result records is outside the current scope unless an official or authorized integration becomes available."*

## 15.6 Track B — the migration path, if it ever opens

Recorded so that a future opportunity is not met with an architecture that cannot accept it.

**Prerequisites, all of which must exist first:**
1. A working Alpha with real usage evidence (Stage 3)
2. A completed college pilot with institutional feedback (Stage 4)
3. An introduction through the college, not a cold approach to the university
4. A written agreement defining data scope, purpose, retention and termination

**If official access were ever granted**, the architecture already accommodates it without a rewrite:

```
Today:      ExternalSource(kind='announcements', official=true,  adapter='vtu-html-v3')
Hypothetical: ExternalSource(kind='results',     official=true,  adapter='vtu-official-api-v1')
```

The adapter interface, provenance model, validation gate, publishing rules and health monitoring are all source-agnostic. Adding an official feed is a new adapter plus a registry row. **This is the entire payoff of the adapter architecture** — and it is why the architecture is justified now, before any second source exists.

Additional requirements that would apply to an official source:
- `official = true` and a distinct UI treatment, so students can tell verified data from public-source data
- Its own authentication, held in the secret store, never in code
- A stricter validation profile — official data being wrong is worse than public data being wrong
- A documented termination path: if access is withdrawn, the product degrades to Track A rather than breaking

**Until all of that exists, nothing in the product, the pitch or the documentation may suggest it does.**

## 15.7 Experimental-data labelling

During Stage 1 the product runs on seeded and manually-entered data. The rules:

| Data | Label |
|---|---|
| Demo student data | Persistent, non-dismissible banner: **"Sample data — not live results"** |
| Seeded subjects and syllabus | Source URL and "verified on ⟨date⟩" shown |
| Seeded announcements | **"Example announcement — not live"** |
| Anything the student entered | No label — it is their own data |

Demo records are additionally marked in the data itself (USN prefix `DEMO`, names such as "Sample Student") so a screenshot taken out of context cannot be mistaken for real data (`09` §9.11). Demo data never exists in the Alpha environment (`25`).

**Rationale:** the fastest way to lose institutional credibility is a screenshot of a plausible-looking fake result circulating without context.

## 15.8 If a source changes or closes

| Event | Response |
|---|---|
| `vtu.ac.in` changes page structure | Parser fails → publishing blocked → fixture captured → parser fixed (`14` §9) |
| `vtu.ac.in` robots.txt begins disallowing | Weekly re-check detects it → source auto-disabled → feature removed, honestly explained |
| The site adds terms forbidding automated access | Source disabled; announcements become manual operator entry |
| VTU objects to GradTools | Comply immediately and fully; disable the source; respond directly; document the exchange |
| A source disappears | Serve last valid data with staleness, then retire the feature |

**In every case the product survives**, because no core feature depends on any external source. That property is the reason for the whole design.

## 15.9 What GradTools may and may not say about VTU

Full copy rules in `28`. The load-bearing ones:

| Never say | Say instead |
|---|---|
| "Official VTU results" | "Enter your result to calculate SGPA and CGPA" |
| "VTU-approved" / "Partnered with VTU" | "Built for students following the VTU 2022 scheme" |
| "Your result is out" | "A change was detected in the VTU announcements page" |
| "Integrated with VTU" | "Uses publicly published VTU documents, with sources shown" |
| "Live from VTU" | "Retrieved from vtu.ac.in on ⟨timestamp⟩" |

The product footer states, permanently: **"GradTools is an independent student project. It is not affiliated with, endorsed by, or connected to Visvesvaraya Technological University."**

## 15.10 Open questions

| ID | Question | Needed by |
|---|---|---|
| `OQ-006` | Terms-of-use review for `vtu.ac.in` — does anything address automated access? | Before enabling the announcements adapter (Milestone 6) |
| `OQ-008` | Redistribution rights for VTU question papers | Before the paper library is public (Milestone 5) |
| `OQ-011` | Confirmation that the target college applies VTU 2022 regulations unamended | Before Alpha |
| `OQ-017` | Is the announcements page server-rendered HTML or JS-rendered? Determines whether a DOM parser suffices or a headless browser is needed — the latter is a materially larger dependency and would be reconsidered rather than assumed | Milestone 6 |
