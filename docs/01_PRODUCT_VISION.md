# 01 — Product Vision

**Status:** Phase 1 draft, pending human approval
**Owner:** Project lead (solo founder/student)
**Last updated:** 2026-08-23

---

## 1.1 The problem

A VTU undergraduate performing routine academic tasks in a single week touches, typically:

| Task | Where it lives today |
|---|---|
| Check whether results are out | University results portal + WhatsApp rumours + Telegram groups |
| Compute SGPA for the semester | A third-party calculator website, often with an unverified formula |
| Compute CGPA across semesters | A second, different calculator site |
| Work out marks needed in SEE to pass or hit a grade | Mental arithmetic or a spreadsheet |
| Track attendance and decide whether a class can be skipped | College portal (if any) plus guesswork |
| Find previous-year question papers | Ad-hoc search, Telegram file dumps, seniors |
| Find the syllabus and module breakdown | A PDF someone forwarded, of uncertain scheme year |
| Know the exam timetable | Circular screenshots forwarded through groups |

None of these is individually hard. The cost is **fragmentation**: eight tools, eight interfaces, eight levels of trustworthiness, and no shared notion of "this student, this scheme, this semester."

The secondary problem is **correctness drift**. Third-party calculators reproduce each other's assumptions. During research for this document set we found that the widely-published VTU percentage conversion `(CGPA − 0.75) × 10` **contradicts the official 2022 regulation**, which specifies `M = CGPA × 10` (clause 22OB 6.7). Students are making decisions on numbers nobody verified.

## 1.2 The product promise

> **GradTools is a student-facing academic utility layer that brings routine academic workflows and information into one place.**

It consolidates work students currently spread across many tools: academic calculations, attendance, timetable, marks, backlog tracking, result organisation, academic notifications, syllabus, previous and model papers where permitted, academic analytics, historical question analysis and recommendations — with institutional integrations as a possible later addition.

**Result handling is one component among many, not the product** (`DEC-012`). GradTools is not "a VTU result scraper with a UI"; it does not automate individual result retrieval today (`15` §5), and every other capability listed above works regardless. A reader who takes results out of the product still finds most of its value intact — which is the design intent, not a consolation.

Two commitments distinguish it from the existing tools:

1. **Every academic number is traceable to a cited clause of an official regulation.** Not "trust the calculator" but "here is the rule, here is the source, here is the arithmetic."
2. **Every piece of externally-sourced data carries provenance and freshness.** GradTools never says "your result is out." It says "a change was detected in the configured public source at 14:32 today," or it says nothing.

## 1.3 What GradTools is not

This section is load-bearing for institutional credibility and is restated in `28_CONTENT_AND_COPY_GUIDELINES.md`.

- **Not a replacement for VTU systems.** The official result, grade card and transcript remain the university's. GradTools is a convenience layer over information the student already has a right to.
- **Not officially endorsed.** No claim of VTU approval, partnership, API access or affiliation may appear anywhere in the product, marketing or pitch until a signed, documented agreement exists. As of this document: **no such relationship exists.**
- **Not a credential proxy.** GradTools never asks for, stores, transmits or proxies a student's university portal password. See `13_SECURITY_THREAT_MODEL.md`.
- **Not a prediction oracle.** Historical question-frequency analysis is presented as historical evidence, never as a guarantee about a future paper. See `19_RECOMMENDATION_AND_AI_POLICY.md`.
- **Not a social network.** No feeds, no follower counts, no public student profiles. Every social-adjacent feature is a future consideration requiring a fresh privacy review.

## 1.4 Target users

### Persona A — "Ravi", 3rd-semester CSE student (primary)

Uses a mid-range Android phone on patchy 4G. Checks his phone between classes. Wants: *"Am I short on attendance? What do I need in the exam? Are results out?"* Will abandon anything that takes more than about 20 seconds to answer that. Does not care about architecture, does not want an account, and is suspicious of sites that ask for his USN.

**Design consequence:** mobile-first, calculators usable with zero signup, sub-2s first meaningful paint on 4G.

### Persona B — "Anita", 6th-semester student preparing for SEE (primary)

Two weeks before exams. Wants previous-year papers for a specific subject code, wants to know which modules repeat, wants to know the minimum marks to convert a B+ into an A. Uses a laptop.

**Design consequence:** subject-code-first navigation, module heatmaps, target-marks calculator, downloadable papers.

### Persona C — "Prof. Kulkarni", department faculty and college representative (institutional gatekeeper)

Sees GradTools in a 10-minute demo. Asks three questions, in this order: *Where does the data come from? What student data do you store? What happens when it's wrong?* If any answer is vague, the pilot does not happen.

**Design consequence:** provenance surfaces are a product feature, not an internal debug tool. `21_ADMIN_AND_DATA_OPERATIONS.md` and `12_PRIVACY_AND_DATA_GOVERNANCE.md` exist substantially to answer Persona C.

### Persona D — the operator (the project lead)

One person, part-time, no on-call rotation. Every operational decision is constrained by this: if a subsystem cannot survive a week of inattention, it is over-engineered for this project. See `23_PERFORMANCE_AND_SCALING.md`.

## 1.5 Initial scope

Confirmed by human decision (`DEC-003`):

- **University:** Visvesvaraya Technological University (VTU), Belagavi
- **Regulation:** 2022 scheme, `22OB` regulations, B.E./B.Tech
- **College type:** non-autonomous affiliated college (VTU syllabus, VTU exams, VTU results)
- **Branches:** 1–2 to begin with, expanding once subject and credit tables are verified

Autonomous colleges are **explicitly out of scope for Alpha** because they set their own internal marks split and sometimes their own grade bands; supporting them without their regulation documents would produce silently wrong CGPA values. The data model is nonetheless college-versioned from day one so adding them later is a data change, not a rewrite (`08_DATA_MODEL.md`).

## 1.6 The five-stage strategy

| Stage | Name | Goal | Exit signal |
|---|---|---|---|
| 1 | Experimental website | Prove workflow consolidation is actually valuable | Lead uses it daily by preference over the alternatives |
| 2 | Small real-user testing | 10–30 students, observe real usage | Evidence of which features are used and trusted |
| 3 | Alpha | Stable, tested, documented, presentable | Alpha readiness review passes (`30_ALPHA_RELEASE_PLAN.md`) |
| 4 | College demonstration / pilot | Institutional feedback and legitimacy | Department agrees to a supervised pilot |
| 5 | Potential VTU discussion | Only with a working product and pilot evidence | Out of scope for this document set |

**The product must be fully useful at Stage 3 even if Stages 4 and 5 never happen.** Every architectural decision is tested against this: if a feature only pays off given official VTU integration, it is deprioritised.

## 1.7 Definition of success

Success is *not* measured in features shipped.

**Stage 1 success:** the project lead stops using third-party calculators and Telegram paper dumps, because GradTools is faster.

**Stage 2 success:** at least 60% of the test cohort returns unprompted in a second week, and at least one student reports acting on a calculation (changed a bunk plan, targeted a specific SEE mark).

**Stage 3 (Alpha) success:** a full semester cycle — mid-semester attendance tracking through results — completes without a wrong academic number reaching a student, and with every external data point carrying valid provenance.

**Stage 4 success:** a faculty member's three questions (§1.4, Persona C) are answered from the product itself, not from the founder's explanation.

## 1.8 Anti-goals for the first version

Deliberately excluded, with reasons, to prevent scope creep:

- **Placement and company data** — unverifiable, high liability, no source of truth.
- **Peer comparison and leaderboards** — turns academic records into a social pressure surface; severe privacy escalation.
- **Faculty or college ratings** — reputational liability that would end an institutional conversation immediately.
- **Monetisation of any kind in Alpha** — introduces payment-data compliance scope for zero learning value. Revisit post-pilot.
- **Native mobile apps** — a responsive web app answers Persona A adequately; two more build pipelines do not.
- **Multi-university support** — until the VTU rule set is verified end to end, generalising the rules engine is speculative abstraction.

## 1.9 Strategic risks to the vision

| Risk | Impact | Where addressed |
|---|---|---|
| A wrong SGPA/CGPA reaches a student | Fatal to credibility; unrecoverable with faculty | `16`, `22` |
| Results portal is robots-disallowed (confirmed) | The "result watcher" feature cannot be built as originally imagined | `14`, `15`, `32/DEC-004` |
| PYQ corpus has unclear redistribution rights | Blocks the papers feature at pilot stage | `17`, `29`, `32/OQ-008` |
| Stored identity data creates a breach target | Regulatory and reputational | `12`, `13`, `32/DEC-002`, `32/DEC-008` |
| Solo operator burnout | Project stalls between stages | `23`, `24`, `31` |

## 1.10 Assumptions

- **A1.** The target college is non-autonomous and follows VTU 2022 regulations without local amendment. *NOT VERIFIED* — requires confirmation from a college document. See `32/OQ-011`.
- **A2.** Students are willing to enter attendance manually. Unproven; Stage 2 must test it. If false, the attendance feature's value collapses and the roadmap reprioritises.
- **A3.** Public VTU announcement pages are stable enough for change detection. Partially evidenced (`vtu.ac.in` robots.txt permits crawling); parser stability is unknown until observed.
