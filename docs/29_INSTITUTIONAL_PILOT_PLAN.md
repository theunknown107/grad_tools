# 29 — Institutional Pilot Plan

**Status:** Phase 1 draft — planning only. **No college has been approached and none has agreed to anything.**
**Stage:** 4 of 5 (`01` §1.6). Prerequisites are a working Alpha and Stage 2 evidence.

---

## 29.1 Objectives

**Primary:** obtain institutional feedback on whether GradTools is useful and appropriate for students at the college.

**Secondary:** identify college-specific academic rules the product has assumed rather than verified; establish whether the privacy posture satisfies a real reviewer; gather evidence for a possible future VTU conversation.

**Explicitly not objectives:** obtaining data access, obtaining an endorsement to advertise, or obtaining institutional adoption. Pursuing any of these in a first conversation converts a low-stakes demonstration into a negotiation, which is how student projects get declined.

## 29.2 Preconditions

The pilot does not begin until **all** are true:

| # | Precondition | Evidence |
|---|---|---|
| 1 | Alpha released and stable for 4+ weeks | Release notes, error rate |
| 2 | Stage 2 testing complete with 10+ students | Usage evidence, feedback |
| 3 | **Academic calculations validated against real grade cards** | `22` §3 |
| 4 | Security review complete | `13`, `31` M9 |
| 5 | Accessibility manual pass complete | `27` §13 |
| 6 | Privacy documentation reviewer-ready | `12` |
| 7 | Question-paper licensing question resolved | `32/OQ-008` |
| 8 | Known limitations documented honestly | `30` |
| 9 | No demo data in the Alpha environment | `25` §1 |

**Precondition 3 is the one that must not be waived.** Demonstrating a CGPA calculator to a faculty member without having checked it against a real grade card is an unforced error with no recovery.

**Precondition 7 similarly:** demonstrating a library of question papers whose redistribution rights are unknown invites exactly the objection that ends the conversation.

## 29.3 Approach

Bottom-up, through the department, never top-down through administration.

```
1  Use it personally for a full semester
2  Share with classmates informally (Stage 2)
3  Collect evidence: usage, feedback, corrections made
4  Approach ONE faculty member with existing rapport
5  Show, do not pitch — 10 minutes, on a phone
6  Ask for feedback, not permission
7  If interested: propose a small supervised pilot
8  If not: thank them, keep building, revisit later
```

Step 4 matters: a single interested faculty member is a far better entry point than a formal request to a department head, and they will tell you honestly what the objection will be.

Step 6 is deliberate. Asking "would you approve this?" invites a risk assessment and a default no. Asking "does this look useful to your students, and what's wrong with it?" invites engagement.

## 29.4 The demonstration

**10 minutes. On a phone. No slides until asked.**

| Min | Content |
|---|---|
| 0–1 | The problem: eight tools for routine tasks; show the fragmentation |
| 1–3 | SGPA calculation, then **"How this was calculated"** with the regulation clause |
| 3–4 | The percentage discrepancy: our figure, the common one, the clause. **This is the credibility moment** |
| 4–6 | Attendance and bunk planning, including the DX warning and the condonation nuance |
| 6–7 | Marks needed, including the ineligible case |
| 7–8 | Papers and repeated-question evidence — the source questions, not a "prediction" |
| 8–9 | Privacy: what is stored, the export button, the delete button, live |
| 9–10 | Data sources: robots.txt respected, results not fetched and why, provenance shown |

**The demonstration leads with correctness and ends with boundaries.** Both are the parts a faculty member will actually evaluate. A feature tour would be less persuasive than the three minutes spent showing the clause citation and the delete button working.

**The three questions to answer before being asked** (`01` §1.4, Persona C):

| Question | Answer, on screen |
|---|---|
| Where does the data come from? | Students enter their own results; reference data from published VTU documents with sources shown; announcements from the public site, robots-respecting. Results are never fetched. |
| What student data do you store? | Nothing at all unless they create an account. Then: email, and whatever they choose to add. Show the export and the delete. |
| What happens when it's wrong? | Rules cite clauses; calculations are tested against the regulation's own worked example and real grade cards; a wrong number is a Sev-1 with a notification obligation; corrections are visible, not silent. |

## 29.5 Pilot structure, if agreed

| Parameter | Proposal |
|---|---|
| Duration | 4–6 weeks, ideally spanning a CIE cycle |
| Participants | 20–40 students, one or two sections, **voluntary** |
| Faculty involvement | One or two observers; **no faculty access to student data** |
| Support | Direct channel to the operator |
| Feedback | Structured survey at start and end, plus open reports |
| Success review | A joint session at the end |

## 29.6 Privacy commitments to participants (binding)

Communicated in writing before anyone enrols:

1. **The college receives no individual student data.** Not results, not attendance, not names, not usage.
2. Any reporting to the college is aggregate, with a **minimum cohort size of 10** before any figure is shared.
3. Participation is voluntary, withdrawable at any time, with **no academic consequence**.
4. Every participant can export and delete their data at any moment, self-service.
5. GradTools does not ask for university portal credentials, and never will.
6. Students are told exactly what the college will and will not see, before they enrol.

**If the college asks for individual student data, the answer is no.** The students did not consent to institutional disclosure, and an institution cannot consent on their behalf. Any change requires fresh, explicit consent from each student.

This clause is the most likely point of friction in a real pilot and is deliberately non-negotiable. Conceding it would make every prior privacy claim untrue.

## 29.7 Metrics

| Metric | Method | Target |
|---|---|---|
| Activation | Participants completing one useful action | ≥ 80% |
| Week-2 retention | Returning unprompted | ≥ 50% |
| Feature usage | Aggregate counters (`12` §7) | Ranked, no target |
| Calculation trust | Survey: "Did you trust the numbers?" | ≥ 80% yes |
| Accuracy incidents | Wrong academic values reported | **0** |
| Correction requests | Data corrections needed | Tracked |
| Faculty assessment | Structured interview | Qualitative |

**Zero accuracy incidents is the only hard target.** Everything else is information; that one is a pass/fail on the product's central claim.

Measurement respects `12`: no per-student behavioural tracking. Retention is derived from aggregate daily active counts and voluntary survey responses, not from individual usage traces.

## 29.8 What the pilot must discover

The questions worth running a pilot to answer:

1. Do the calculations match the college's actual practice, or has the college amended anything? (`32/OQ-011`)
2. Is manual attendance entry sustainable over weeks, or does it decay? (assumption `A2` in `01`)
3. Which feature is used most — and is it the one we expected?
4. Does the provenance and freshness display mean anything to students, or is it ignored?
5. What do students expect that GradTools deliberately does not do, and how do they react to the explanation?
6. Does a faculty member's evaluation differ from a student's, and where?

Question 5 is the important one for Stage 5: if students consistently expect automatic result fetching and reject the explanation, the product's positioning needs work before any VTU conversation.

## 29.9 Risks

| Risk | Mitigation |
|---|---|
| A wrong academic value during the pilot | Preconditions 3 and 4; real-grade-card validation; Sev-1 process |
| The college requests student data | Position stated in §29.6, in writing, before the pilot |
| The college assumes VTU endorsement | Explicit disclaimer in every material and in the product footer |
| Question-paper licensing challenged | Resolved before the pilot (precondition 7); takedown path exists |
| Low participation | Voluntary and small by design; 20 engaged students beat 200 indifferent ones |
| Faculty sees it as circumventing official systems | Positioning: a utility layer over information students already have; results are never fetched |
| Operator cannot support the load | Small cohort; expectations set; the product is stable before the pilot begins |
| The pilot succeeds and expectations outrun capacity | Say what the next stage realistically is; do not promise features to sustain enthusiasm |

## 29.10 What GradTools will not do to get a pilot

| Not done | Why |
|---|---|
| Claim endorsement it does not have | Ends the relationship when discovered |
| Overstate usage or accuracy | Same |
| Promise institutional integration | None is available |
| Agree to share student data | Breaks a commitment to students |
| Add a requested feature that harms students | Peer comparison, faculty visibility into individual records |
| Enable a data source outside its permitted boundary | The boundary is enforced by a database constraint, not by discretion |

## 29.11 After the pilot

**If positive:** incorporate feedback; fix what the pilot found; consider a wider college rollout; **only then** consider whether a VTU conversation is warranted, with the college's introduction rather than a cold approach.

**If mixed:** the pilot has done its job — it produced information at low cost. Fix and revisit.

**If negative:** understand precisely why. If the objection is product quality, that is fixable. If it is institutional posture, GradTools remains a useful direct-to-student product (`01` §1.6) and the institutional track pauses without the product failing.

**Stage 5 (VTU) is not planned in this document.** It requires evidence that does not exist yet, and planning it now would be speculation. The only commitment made here is the ordering: college first, university much later, never a cold approach, never a claim before an agreement.
