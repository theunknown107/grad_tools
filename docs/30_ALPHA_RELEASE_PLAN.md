# 30 — Alpha Release Plan

**Status:** Phase 1 draft
**Definition:** Alpha (`v0.3.0`) is the first release intended for students other than the author, and the artefact shown to a college. It is a **demonstration and testing release**, not an institutional production system, and it says so.

---

## 30.1 What Alpha is and is not

| Alpha is | Alpha is not |
|---|---|
| Stable enough for daily use by real students | A production system with an SLA |
| Correct in every academic calculation | Feature-complete |
| Honest about its limitations | A finished product |
| Presentable to a faculty member | Institutionally endorsed |
| Operated by one person, best-effort | Supported 24×7 |

## 30.2 Scope — committed

Everything at P0 and P1 in `02`, verified against Stage 2 evidence.

### Committed features

| Area | In Alpha |
|---|---|
| **Calculators** | SGPA, CGPA, percentage, class, marks-needed, target CGPA — each with formula, inputs and clause citation |
| **Attendance** | Per-course tracking, percentage, bunk planning, recovery, DX-risk warning, condonation explanation |
| **Results** | Manual entry, semester history, derived SGPA/CGPA, asserted-vs-computed discrepancy display |
| **Backlogs** | Derived from results, with reason (failed / attendance DX / CIE shortfall), attempt counts |
| **Accounts** | Optional, magic link, sync, export, delete |
| **Content** | Syllabus browsing, subject search, and the paper library **at whichever tier `OQ-008` permits** — private corpus always; public library only with verified rights (`DEC-010`) |
| **Announcements** | Public-source ingestion with provenance and freshness |
| **Notifications** | Web Push for announcements, preferences, quiet hours, unsubscribe |
| **Admin** | Source health, job monitor, review queue, corrections, audit |
| **Cross-cutting** | Light/dark themes, offline core, WCAG 2.1 AA, full provenance display |

### Deferred, with the reason stated in-product

| Deferred | Reason |
|---|---|
| Question extraction and module priority | P2 — admitted only if the corpus and extraction quality (`32/OQ-019`) support it |
| Timetable | P2 — admitted based on Stage 2 evidence |
| Marks analytics | P2 |
| Attendance and class notifications | P2 — strong candidates for promotion |
| Model papers | P3 |
| Email/Telegram channels | P3 |
| AI explanations | **Disabled by default** (`19` §3) |
| Automated result retrieval | **Never** (`15` §5) |
| Multiple schemes, autonomous colleges | Post-Alpha |

## 30.3 Feature freeze

Freeze occurs at the end of Stage 2 (`31` M13), driven by evidence rather than ambition.

**Promotion criteria for a P2 feature:**
- Requested or used by ≥ 30% of the Stage 2 cohort, **and**
- Implementable and testable to Alpha standard within the freeze window, **and**
- Adding no unresolved privacy, security or licensing question.

**Cut criteria — a committed feature is removed if:**
- It cannot meet its accuracy target
- It depends on an unresolved decision in `32`
- It cannot be made accessible
- Stage 2 shows it is being *misused* (the dormant-topic feature is explicitly named here — if students use it as a "skip these" list, it is removed, per `18` §7)

After freeze: bug fixes, copy, accessibility and performance only. No new features.

## 30.4 Supported scope (stated explicitly in the product)

Alpha ships a **Supported Scope** page, linked from the footer. Stating limits precisely is what makes the supported parts credible.

| Dimension | Supported | Not supported |
|---|---|---|
| University | VTU | All others |
| Scheme | 2022 (`22OB`) | 2018, 2021, 2025 — rules differ and are unverified |
| Degree | B.E. / B.Tech | M.Tech, MBA, MCA, B.Arch, diplomas |
| College type | Non-autonomous affiliated | **Autonomous colleges** — they set their own internal rules |
| Branches | Those with verified subject and credit data | Others: calculators work, subject auto-fill does not |
| Results | Student-entered | Automatic retrieval — never |
| Attendance | Student-entered | College portal integration — none exists |
| Papers | Public-tier documents with verified rights; a student's own uploads | Redistribution of documents whose rights are unverified |
| Languages | English | Others |

**The autonomous-college row is the most important**, because a student at such a college could otherwise get plausible but wrong figures. The product warns at profile setup if an autonomous college is selected and explains why the rules may not apply.

## 30.5 Known limitations (published)

Honest, specific, and shipped with the release:

1. Results must be entered manually. We do not fetch them, and we explain why.
2. Attendance is self-reported. GradTools has no connection to any college attendance system.
3. Only the VTU 2022 scheme is supported.
4. Autonomous colleges may have different rules; figures may not apply.
5. The paper library is incomplete and grows as papers are contributed.
6. Question analysis (if enabled) is based on a small corpus and is historical, never predictive.
7. Announcement checks run every 6 hours, not continuously.
8. iOS push requires installing the app to the home screen.
9. Operated by one student, best-effort. There is no SLA.
10. Alpha software: bugs exist, and data loss, while guarded against, is possible.

**Limitation 10 is stated plainly** — and mitigated by the local-first architecture and the export button, both of which are pointed at from the same page.

## 30.6 Onboarding for Alpha users

```
Landing → clear promise + independence disclaimer
   → try a calculator immediately (no signup)
   → optional profile setup (local only)
   → optional account, explained honestly
   → known limitations linked from the footer, not buried
```

Alpha users additionally receive: a short "what this is and is not" note, the bug-report route, and an explicit statement that their feedback shapes the product.

## 30.7 Feedback and bug reporting

| Channel | Purpose |
|---|---|
| In-app "Report a problem" | Primary; pre-fills app version, route and a request reference — no personal data |
| Email | Direct line to the operator |
| Structured survey | At 2 weeks and at end of cohort |

**Bug reports include a mandatory field: "Was an academic number wrong?"** A yes routes it to Sev-1 (`24` §9). This single field is the fastest path from a student noticing a wrong CGPA to it being treated with the urgency it warrants.

## 30.8 Release checklist

### Correctness
- [ ] Rules engine: 100% branch coverage
- [ ] Regulation's Annexure-I worked example passes as a golden test
- [ ] **Validated against ≥ 5 real grade cards** (anonymised)
- [ ] All boundary tests pass
- [ ] Property-based tests pass
- [ ] Client/server differential tests agree
- [ ] Every active rule set has `verified_at` and a clause citation

### Security
- [ ] Security review complete (`13`)
- [ ] Authorization matrix: 100% of student-scoped endpoints
- [ ] Upload validation tests pass, including bomb and active-content fixtures
- [ ] Headers verified on the live deployment
- [ ] Rate limits verified live
- [ ] Secret scan clean; no secret in the client bundle
- [ ] Dependency audit clean at high/critical
- [ ] Log redaction test passes

### Privacy
- [ ] Export returns complete data
- [ ] Deletion verified end to end
- [ ] No PII in logs, metrics or error reports
- [ ] `12` accurate and reviewer-ready

### Quality
- [ ] All CI green
- [ ] E2E journeys pass on Chromium and WebKit, desktop and mobile
- [ ] Zero automated accessibility violations
- [ ] **Manual screen-reader pass complete**
- [ ] Lighthouse: Performance ≥ 90, Accessibility 100
- [ ] Bundle < 200 KB gzipped
- [ ] Load test passed

### Data
- [ ] Every enabled source has a recorded robots **and terms** review (`32/OQ-006`)
- [ ] Question-paper licensing resolved (`32/OQ-008`)
- [ ] All published records carry provenance
- [ ] **No demo data in the Alpha environment** (startup check)
- [ ] Data-quality checks passing

### Operations
- [ ] Backups running; **restore rehearsed**
- [ ] Alerts firing to a monitored channel
- [ ] Status page live
- [ ] Rollback rehearsed
- [ ] Runbooks written (`21` §10)

### Documentation
- [ ] Release notes with version, scope, changelog, known issues, **data-source status**, test status, rollback plan
- [ ] Supported Scope page live
- [ ] Known Limitations page live
- [ ] Privacy summary live
- [ ] All 32 documents updated to match shipped behaviour

## 30.9 Rollback criteria

Immediate rollback, without deliberation, on any of:

| Trigger | Severity |
|---|---|
| A wrong academic value confirmed | **Sev-1** |
| Data loss or corruption | **Sev-1** |
| Any cross-student data exposure | **Sev-1** |
| Sign-in broken | Sev-2 |
| Error rate > 5% for 10 minutes | Sev-2 |
| A wrong notification sent | Sev-2 |

Procedure in `25` §8. Rules-engine defects additionally trigger the notification obligation in `24` §9.

## 30.10 Post-release

| When | Activity |
|---|---|
| First 24 h | Watch errors closely; respond to reports same-day |
| Week 1 | Daily health check; triage feedback |
| Weeks 2–4 | Weekly patch releases; survey at week 2 |
| Week 4 | Alpha review: is it stable enough for the college demonstration (`29` precondition 1)? |

**Alpha is not the end of anything.** It is the artefact that makes the Stage 4 conversation possible, and its success is measured by whether that conversation can happen with confidence — not by user numbers.

## 30.11 Alpha success criteria

| Criterion | Target |
|---|---|
| Wrong academic values reported | **0** |
| Students using it in week 4 | ≥ 10 |
| Week-2 retention | ≥ 50% |
| Sev-1 incidents | 0 |
| Sev-2 incidents | ≤ 2, each resolved within 24 h |
| Uptime | ≥ 99% |
| Students reporting they trust the calculations | ≥ 80% |
| Ready for the college demonstration | Yes |

Only the first is pass/fail. A single wrong academic number reaching a student means Alpha has failed at the thing it exists to prove, regardless of every other metric.
