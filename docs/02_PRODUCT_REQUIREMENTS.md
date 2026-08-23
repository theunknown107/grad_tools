# 02 — Product Requirements

**Status:** Phase 1 draft
**Traceability:** Every requirement has an ID (`FR-xxx` functional, `NFR-xxx` non-functional). Flows in `03_USER_FLOWS.md` reference these IDs; tests in `22_TESTING_AND_QA.md` reference them again.

---

## 2.1 Priority definitions

| Level | Meaning |
|---|---|
| **P0** | Experimental website cannot ship without it |
| **P1** | Alpha cannot ship without it |
| **P2** | Alpha-desirable; may be cut at feature freeze |
| **P3** | Post-Alpha / roadmap |

## 2.2 Feature catalogue

### Group A — Academic calculators (deterministic core)

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-001 | Compute SGPA from per-course credits and grades using `SGPA = Σ(Ci×Gi)/ΣCi`, rounded to 2 dp | P0 | Source: 22OB 6.6(2a) |
| FR-002 | Compute CGPA across semesters using `CGPA = Σ(Ci×Si)/ΣCi`, rounded to 2 dp | P0 | 22OB 6.6(2b) |
| FR-003 | Convert marks percentage to letter grade to grade point per the 22OB 6.1 table | P0 | O/A+/A/B+/B/C/P/F |
| FR-004 | Convert CGPA to percentage using `M = CGPA × 10` | P0 | 22OB 6.7. **Must not** use the widespread `(CGPA−0.75)×10` |
| FR-005 | Show class equivalence (FCD/FC/SC/Pass) from percentage | P1 | 22OB 6.8 |
| FR-006 | "Marks needed" calculator: given CIE obtained, compute minimum SEE marks for (a) passing and (b) each target grade | P0 | Must respect all three thresholds simultaneously — see `16` §4 |
| FR-007 | Target-CGPA calculator: given current CGPA and credits, compute SGPA required in remaining semesters | P1 | Must report infeasible targets explicitly, never clamp silently |
| FR-008 | Every calculator can show its formula, inputs and cited clause on demand | P0 | Core trust feature |
| FR-009 | Calculators work with zero account and zero server round-trip | P0 | Pure functions from the shared rules package |

### Group B — Attendance and bunk planning

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-020 | Record per-course attendance as (attended, conducted) counts | P0 | Manual entry; no college portal integration exists |
| FR-021 | Compute current attendance percentage per course and in aggregate | P0 | |
| FR-022 | "Can I bunk?" — maximum classes skippable while staying at or above threshold | P0 | Default threshold **85%** (22OB 3.7) |
| FR-023 | "Recovery" — classes that must be attended consecutively to return to threshold | P0 | Must report "not recoverable this semester" when true |
| FR-024 | Expose the condonation nuance: 85% required, up to 10% condonable by the VC, DX below the resulting floor | P1 | Two-threshold UI; see `16` §5 |
| FR-025 | Warn when a course is at DX risk (barred from SEE) | P1 | Highest-consequence attendance state |
| FR-026 | Attendance history and timeline per course | P2 | |

### Group C — Results and backlogs

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-040 | Manually enter or paste a semester result (subject, code, CIE, SEE, total, grade) | P0 | Primary results path — see FR-045 |
| FR-041 | Store result history per semester and derive SGPA/CGPA from it | P1 | Account holders only |
| FR-042 | Track backlogs: courses with F / DX / AB, attempt count, cleared status | P1 | 22OB 6.2, 6.3(9) |
| FR-043 | Marks analytics: per-semester trend, per-subject strength, CIE vs SEE split | P2 | Must avoid meaningless statistics (`05` §Anti-patterns) |
| FR-044 | Import result from pasted grade-card text or PDF, with human confirmation before saving | P2 | Parsed values shown for review; never silently trusted |
| FR-045 | **Automated retrieval of individual VTU result records is outside the current scope** unless an official or authorized integration becomes available | P0 (constraint) | `robots.txt` = `Disallow: /` on the results host. See `14` §7, `32/DEC-004` |
| FR-046 | All results enter through a **`ResultProvider` interface**, with `authority` (`student_asserted` \| `official`) and `parserVersion` recorded per result | P0 | Manual entry and paste-parse are two implementations today; keeps a future authorized provider a swap, not a rewrite. See `15` §15.5.1 |

### Group D — Announcements and notifications

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-060 | Ingest public VTU announcements and circulars from `vtu.ac.in` via a source adapter | P1 | robots.txt permits; conservative rate limit |
| FR-061 | Detect changes in a watched source and record a change event with provenance | P1 | |
| FR-062 | Notify subscribed users of new announcements via Web Push | P1 | |
| FR-063 | Notification wording must never assert an official result release | P0 | "A change was detected in the configured public source" |
| FR-064 | Per-category notification preferences, quiet hours, one-click unsubscribe | P1 | |
| FR-065 | Timetable and class reminders | P2 | |
| FR-066 | Attendance-risk alerts | P2 | |
| FR-067 | Email or Telegram delivery channel | P3 | |

### Group E — Papers, syllabus, intelligence

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-080 | Browse syllabus by scheme, branch, semester, subject, module | P1 | |
| FR-081 | Browse and download previous-year question papers by subject code and year | P1 | **Public tier only** — requires verified rights (`DEC-010`). Private-tier documents are never served to another user |
| FR-082 | Operator bulk import of paper PDFs with provenance metadata | P1 | Imports to the **private tier** by default; promotion to public requires a recorded rights determination |
| FR-083 | Student upload of a paper PDF, quarantined pending validation and review | P2 | Hostile input — see `13` §6, `17` §3 |
| FR-084 | Extract individual questions from a paper PDF with per-question confidence | P2 | |
| FR-085 | Map extracted questions to syllabus modules | P2 | SEE papers are structurally 2 questions per module across 5 modules |
| FR-086 | Repeated-question detection across years | P2 | |
| FR-087 | Module frequency heatmap per subject with underlying counts always visible | P2 | |
| FR-088 | Any ranking or priority output must display supporting evidence and never claim prediction | P0 (constraint) | `19` |
| FR-089 | Model question papers | P3 | |
| FR-090 | Documents carry a `publication_tier` (`private` default, `public` gated on verified rights); analysis over privately-held documents is permitted, redistribution is not | P1 (constraint) | `DEC-010`, `09` §9.6 |

### Group F — Profile, timetable, settings

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-100 | Local profile: college, scheme, branch, current semester — stored client-side, no account | P0 | |
| FR-101 | Optional account via emailed magic link, for sync and push | P1 | No passwords stored — see `11` |
| FR-102 | Weekly timetable with slots mapped to courses | P2 | |
| FR-103 | Export all my data as JSON | P1 | Privacy requirement, not a nice-to-have |
| FR-104 | Delete my account and all associated data, irreversibly, self-service | P1 | |
| FR-105 | Light, dark and system theme | P1 | |
| FR-106 | Clearly label all demo and seeded data as not-live | P0 | `15` §Experimental data labelling |

### Group G — Operator and admin

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-120 | Source health dashboard: last success, last failure, consecutive failures, parser version | P1 | |
| FR-121 | Ingestion job list with status, duration and error | P1 | |
| FR-122 | Review queue for low-confidence extractions and student uploads | P2 | |
| FR-123 | Manual correction of a published record, with audit trail | P1 | |
| FR-124 | Audit log of every privileged action | P1 | |
| FR-125 | Admin access restricted to a hard-coded operator allowlist in Alpha | P1 | No self-service admin signup |

## 2.3 Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-001 | First contentful paint, mid-range Android, 4G | < 2.0 s |
| NFR-002 | Calculator interaction latency | < 50 ms (client-side, no network) |
| NFR-003 | API p95 read latency | < 300 ms |
| NFR-004 | Initial JS bundle, gzipped | < 200 KB |
| NFR-005 | WCAG conformance | 2.1 AA |
| NFR-006 | Keyboard operability | 100% of interactive flows |
| NFR-007 | Uptime target (Alpha) | 99%, best-effort, single operator, stated plainly to users |
| NFR-008 | Backup | Nightly Postgres dump; restore rehearsed before Alpha |
| NFR-009 | Data export | Completes within 30 s, machine-readable |
| NFR-010 | Deletion | Immediate from live DB; backups aged out within the stated retention window |
| NFR-011 | No secret, USN, name or session token in any log line | Enforced by a redaction layer plus a test |
| NFR-012 | Every external data record carries source, fetch timestamp, parser version, validation state | 100% |

## 2.4 Scope by stage

**Experimental website (Stage 1) — P0 only:**
FR-001–009, FR-020–023, FR-040, FR-045, FR-063, FR-088, FR-100, FR-106, plus NFR-001/002/004/011.

Explicitly: no accounts, no server-side student data, no notifications, no PYQ pipeline. Data is local or seeded and labelled as such. This is deliberately small — its job is to answer the seven experiment questions in `29`/`30`, not to impress.

**Alpha (Stage 3) — P0 + P1**, with P2 items admitted individually at feature freeze based on Stage 2 evidence.

## 2.5 Acceptance criteria (representative)

Full criteria live with each feature's test plan in `22`. Three examples establish the required rigour.

**FR-001 (SGPA)**
- Given the Annexure-I worked example from the 2022 regulation, computed SGPA matches to 2 dp.
- Given a course graded F (0 points), the course's credits **are** included in ΣCi.
- Given a course graded DX, the course is **excluded** from CGPA (22OB 6.2(1)).
- Given zero courses, the function returns an explicit "not applicable" result — not `NaN`, not `0.00`.

**FR-006 (Marks needed)**
- Given CIE = 20/50 and a pass target, required SEE is the maximum of 35% of SEE (35/100) and the SEE marks needed to reach 40% overall; the binding constraint is named in the output.
- Given CIE = 18/50, the tool reports the student is **ineligible for SEE** (CIE below 40% of 50) rather than computing a target.
- Given an arithmetically unreachable target grade (>100 SEE), the tool says so explicitly.

**FR-022 (Bunk)**
- Given attended=40, conducted=50, threshold=85%: reports 0 skippable and a deficit, since 80% is below 85%.
- Never returns a negative skippable count.
- States the assumption that remaining conducted classes are unknown, and offers a projection mode where the student supplies expected remaining classes.

## 2.6 Dependencies between features

```
FR-003 (grade mapping) ──> FR-001 (SGPA) ──> FR-002 (CGPA) ──> FR-004/005
                       └──> FR-006 (marks needed)
FR-040 (result entry) ─────> FR-041 ──> FR-042 (backlogs), FR-043 (analytics)
FR-080 (syllabus model) ───> FR-085 (module mapping) ──> FR-087 (heatmap)
FR-081/082 (papers) ───────> FR-084 (extraction) ──> FR-086 (repeats) ──> FR-087
FR-060 (announcement ingest) ──> FR-061 (change detect) ──> FR-062 (push)
```

**Critical path for Alpha:** the syllabus model (FR-080) gates all paper intelligence. It requires verified subject and credit data per branch and semester, which is manual data-entry work rather than code. This is the most commonly underestimated dependency in the plan — see `31` §Risks.
