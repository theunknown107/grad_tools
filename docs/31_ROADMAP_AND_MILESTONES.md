# 31 — Roadmap and Milestones

**Status:** Phase 1 draft
**Estimates:** part-time solo development with AI assistance. Every duration is a planning estimate, not a commitment.

---

## 31.1 Milestone overview

| # | Milestone | Effort | Gate |
|---|---|---|---|
| M0 | Discovery and tooling | 1–3 sessions | ✅ **Complete** |
| M1 | Documentation (these 32 files) | 1–2 sessions | ✅ **Complete — awaiting human approval** |
| M2 | Architecture approval and backlog | 1–3 sessions | Human approval + decisions resolved |
| M3 | Experimental foundation | 1–2 weeks | Site loads, navigation works |
| M4 | Core academic utilities | 1–2 weeks | Calculations pass all tests |
| M5 | Academic content | 1–3 weeks | Corpus passes the pipeline |
| M6 | Result/notice ingestion | 1–3 weeks | Safe monitoring, graceful failure |
| M7 | Intelligence | 1–2 weeks | No prediction claims; evidence shown |
| M8 | Admin and data quality | 1 week | Operator can diagnose any failure |
| M9 | Hardening | 1–2 weeks | Alpha readiness review passes |
| M10 | Experimental user test | 1–3 weeks | Evidence-based feature freeze |
| M11 | Alpha release | 1 week | Shareable Alpha |
| M12 | College demonstration prep | 1–2 weeks | Presentation-ready |

**Total: roughly 3–5 months part-time**, dominated by M5 and M6, whose durations depend on external factors outside the developer's control.

## 31.2 Dependency graph

```
M0 ──► M1 ──► M2 ──┬──► M3 ──┬──► M4 ──────────────┬──► M9 ──► M10 ──► M11 ──► M12
                   │         │                     │
                   │         └──► M5 ──► M7 ───────┤
                   │              ▲                │
                   └──► M6 ───────┘                │
                        (independent, can run      │
                         in parallel with M5)      │
                                                   │
   M8 ◄─── depends on M5 + M6 ─────────────────────┘
```

**Critical path:** M2 → M3 → M4 → M9 → M10 → M11 → M12. M4 is the highest-value work and should not be delayed by M5 or M6, which are riskier and less certain.

**Parallelism:** M5 (document pipeline) and M6 (ingestion) are independent of each other and of M4. If M6 stalls on an external blocker, M5 continues.

## 31.3 Milestone detail

### M2 — Architecture approval *(gate: human)*
Resolve the open decisions in `32`; revise the documents accordingly; freeze the initial architecture; convert `02`'s requirements into an issue backlog; initialise the repository and CI skeleton.

**Exit:** human approval of the architecture and of the Alpha scope; every blocking decision in `32` answered.

### M3 — Experimental foundation
Monorepo, React SPA, Express API skeleton, Postgres with initial migrations, design-system tokens and the ~15 components from `05`, routing and the app shell, seeded demo data (labelled), test harness, deployment of the experimental environment.

**Exit:** the site loads under 2 s on 4G, navigation works, CI is green, demo data is unmistakably labelled.
**Explicitly out:** accounts, real data, ingestion.

### M4 — Core academic utilities *(highest value)*
`packages/academic-rules` in full: grade mapping, SGPA, CGPA, percentage, class, marks-needed, target CGPA, attendance and bunk calculations. Result entry, backlog derivation, attendance UI, timetable. Local-first persistence.

**Exit:** 100% branch coverage; the regulation's Annexure-I example passes; property-based tests pass; **validated against real grade cards**; client and server agree.

**This milestone alone delivers a genuinely useful product.** If everything after it stalled, GradTools would still be worth using — which is the intended property.

### M5 — Academic content
Syllabus data model and seeding (manual, verified); document upload and validation pipeline with every security control from `17` §3; extraction (pdftotext, OCR fallback); question segmentation using the structural module mapping; paper library UI.

**Exit:** a test corpus passes end to end; security fixtures rejected correctly; the review queue works.
**Risk:** depends on receiving papers and on whether they carry a text layer (`32/OQ-019`).

### M6 — Result/notice ingestion
Source registry, adapter framework, the VTU announcements adapter, change detection, provenance, health monitoring, notification fan-out.

**Blocked on:** the terms-of-use review (`32/OQ-006`) — a **human task**, not a code task. The framework can be built and fixture-tested with the source disabled; enabling it requires that review.

**Exit:** monitoring runs safely at 4 requests/day; failures are graceful; publishing is blocked while unhealthy; no notification is sent from unvalidated data.

### M7 — Intelligence
Local embeddings, similarity ladder, clustering, topic matching, frequency analysis, evidence-first presentation.

**Exit:** the evaluation in `18` §8 is run and its results recorded; no output below 4 papers; no prediction language anywhere; every score carries its evidence.

### M8 — Admin and data quality
Source health dashboard, job monitor, review queue, corrections with audit, data-quality checks, the one-click fixture capture.

**Exit:** an operator can determine why any piece of data failed, from the admin UI alone.

### M9 — Hardening
Security review, accessibility manual pass, performance tuning, E2E completion, dependency audit, upload security verification, rate limits, error handling, backup/restore rehearsal, observability and alerting.

**Exit:** the Alpha readiness checklist (`30` §8) passes in full.

### M10 — Experimental user test
10–30 students for 1–3 weeks. Observe, survey, fix critical problems, decide the feature freeze from evidence.

**Exit:** feature freeze agreed, based on data rather than preference.

### M11 — Alpha release
Deploy, release notes, known limitations, supported scope, bug-report route, final validation.

**Exit:** a shareable Alpha meeting `30` §11.

### M12 — College demonstration prep
Demo script, evidence pack, privacy explanation, data-source explanation, limitations, pilot proposal.

**Exit:** presentation-ready per `29` §4.

## 31.4 Risk register

| ID | Risk | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-01 | A wrong academic calculation reaches a student | M | **Critical** | **High** | Clause-cited rules, property tests, real-grade-card validation, Sev-1 process | Dev |
| R-02 | Question-paper licensing prohibits redistribution | M | High | **High** | Resolve `OQ-008` before M5 completes; the data model supports link-only and analysis-only fallbacks | Human |
| R-03 | Papers are scanned images, making OCR the main path | M | Med | Med | Validate early (`OQ-019`); OCR is already designed in; extraction failure still leaves the library usable | Dev |
| R-04 | Terms review blocks the announcements source | L | Med | Med | Framework built and testable regardless; manual entry is the fallback | Human |
| R-05 | Syllabus data entry is larger than estimated | **H** | Med | **High** | Start in M3, not M5; begin with one branch; the critical path is acknowledged in `02` §2.6 | Dev |
| R-06 | Students will not enter attendance manually | M | High | **High** | Test in M10; if it fails, reprioritise toward results and papers | Evidence |
| R-07 | The embedding model exceeds the container budget | M | Med | Med | Measure in M2 (`06` §6.8); fall back to a sidecar or hosted, reopening `DEC-006` | Dev |
| R-08 | Solo operator burnout / time | **H** | High | **High** | Milestones are independently valuable; M4 alone ships a useful product; no milestone requires a sprint | Human |
| R-09 | USN storage objected to at pilot | L | Med | Low | Downgrade to salted hash pre-designed (`12` §4); DOB already removed (`DEC-008`) | Human |
| R-10 | A source changes structure repeatedly | M | Low | Low | Fixtures, health monitoring, publish blocking | Dev |
| R-11 | The college declines a pilot | M | Med | Med | The product remains useful direct-to-student (`01` §1.6) | — |
| R-12 | A managed free tier proves unsuitable (DB autosuspend) | M | Low | Low | Validate in M2 (`OQ-020`); budget allows a paid tier | Dev |
| R-13 | Scope creep from Stage 2 feature requests | **H** | Med | Med | Freeze criteria in `30` §3; P2 promotion requires evidence | Human |

**The two highest-attention risks are R-01 and R-08.** R-01 because it is the only failure the product cannot recover from; R-08 because it is the most likely reason a solo project stops.

## 31.5 Human decisions by milestone

| Milestone | Decisions required |
|---|---|
| M2 | Approve architecture and Alpha scope; resolve every blocking item in `32`; confirm hosting; confirm the college and branch |
| M5 | `OQ-008` licensing; supply the paper corpus |
| M6 | `OQ-006` terms review; approve enabling the source |
| M9 | Approve the security review outcome |
| M10 | Approve the feature freeze |
| M11 | Approve the Alpha release |
| M12 | Approve the college approach and the demonstration content |

**No milestone proceeds past its gate without the human decisions listed.** This is the mechanism that keeps the human-in-the-loop rule operative rather than aspirational.

## 31.6 Definition of done

Per feature: the eleven criteria in `22` §13.

Per milestone: every feature done; tests green; documentation updated; the exit criterion demonstrably met; **the human has approved the gate where one exists.**

Per stage: the exit signal in `01` §1.6 observed in reality, not asserted.

## 31.7 Post-Alpha directions (not committed)

| Direction | Depends on |
|---|---|
| Additional schemes (2021, 2025) | Verified rule sets per scheme |
| Additional colleges | Demand, plus per-college verification |
| Autonomous colleges | Access to their regulations |
| Timetable and reminders | Stage 2 evidence |
| Richer marks analytics | Result data volume |
| Model papers | Corpus |
| Telegram delivery | Demand |
| Institutional dashboards | A pilot, plus a fresh privacy decision |
| VTU conversation | Stage 4 success and an introduction |

**None of these is promised.** They are recorded so that the architecture's extension points are deliberate, and so that a request for one can be answered with "here is what it would depend on" rather than a guess.
