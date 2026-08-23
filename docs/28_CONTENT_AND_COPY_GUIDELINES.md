# 28 — Content and Copy Guidelines

**Status:** Phase 1 draft
**Why this is an engineering document:** in a product whose value proposition is trustworthiness, a single overconfident sentence can do more damage than a bug. The phrase "Your results are out!" in a push notification would, if wrong even once, cost more credibility than a week of downtime.

---

## 28.1 Voice

**Plain, precise, unexcited.** GradTools speaks like a competent tool, not a marketing campaign or a friend.

**Canonical one-line description** (`DEC-012`), used verbatim in the product, documentation and institutional conversations:

> GradTools is a student-facing academic utility layer that brings routine academic workflows and information into one place.

Never describe it as a result scraper, a result checker, or a VTU app.

| Principle | Example |
|---|---|
| Say what is true | "Retrieved from vtu.ac.in at 14:32" |
| Say what is uncertain | "This may be out of date — the source has been unreachable since 09:14" |
| Say what is unknown | "Not enough papers to show reliable frequency" |
| Never manufacture urgency | No "Hurry", no countdowns, no exclamation marks |
| Never flatter | No "Great job!", no "You're crushing it!" |
| Respect the reader | They are an engineering student; they can read a formula |

**No emoji in product copy.** Not in notifications, empty states or errors. They read as unserious in a product being shown to faculty, and they carry inconsistent meaning across cultures and screen readers.

## 28.2 Terminology

Use VTU's own terms, because students already know them and inventing synonyms creates confusion.

| Use | Not | Note |
|---|---|---|
| CIE | internals, IA marks | Continuous Internal Evaluation — expand on first use |
| SEE | externals, finals, university exam | Semester End Examination |
| SGPA | semester GPA | |
| CGPA | overall GPA, aggregate | |
| Grade point | point value | |
| Credits | credit hours | |
| Backlog | arrear, KT, supplementary | "Backlog" is VTU's usage |
| DX | detained, debarred | The regulation's grade; always explained |
| Scheme | syllabus year, batch | 2022 scheme |
| Module | unit, chapter | Modules 1–5 |
| USN | roll number, register number | University Seat Number |

**Abbreviations are expanded on first use per page**, with the abbreviation in parentheses afterwards.

## 28.3 The prohibited-claims register

These are hard rules. Each has a specific failure it prevents.

### Institutional claims

| Never | Because | Instead |
|---|---|---|
| "Official VTU results" | We hold none; results are entered by the student | "Enter your result to calculate SGPA and CGPA" |
| "VTU-approved" / "Approved by VTU" | No approval exists | "Built for students following the VTU 2022 scheme" |
| "In partnership with VTU" | No partnership exists | (say nothing) |
| "Integrated with VTU" | No integration exists | "Uses publicly published VTU documents, with sources shown" |
| "Official university app" | False | "An independent student project" |
| "Endorsed by \<college\>" | Not without a written agreement | Nothing, unless documented |

**Permanent footer, on every page:**
> GradTools is an independent student project. It is not affiliated with, endorsed by, or connected to Visvesvaraya Technological University.

### Result and data claims

| Never | Because | Instead |
|---|---|---|
| "Your results are out" | We cannot know this | "A change was detected in the VTU announcements page" |
| "Results declared" | Same | "New item published on vtu.ac.in" |
| "Live results" | Nothing is live | "Retrieved at ⟨timestamp⟩" |
| "Real-time" | Polling every 6 hours is not real-time | "Checked ⟨N⟩ minutes ago" |
| "Verified marks" | We verify nothing about a student's marks | "As entered by you" |
| "100% accurate" | Nothing is | State the actual method |

### Scope claims about result retrieval (`DEC-011`)

The boundary is **scope**, not incapacity. Overstating it in either direction is wrong.

| Never | Because | Instead |
|---|---|---|
| "GradTools can never retrieve VTU results" | Untrue — an authorized integration would flow through the same provider interface | "Automated retrieval of individual VTU result records is outside the current scope unless an official or authorized integration becomes available" |
| "Results coming soon" / "Integration in progress" | Nothing is in progress and none is promised | Say nothing about future integration |
| "We're working with VTU on this" | No relationship exists | "Enter or paste your result — everything else works from there" |

The student-facing wording is the short form: *"GradTools doesn't fetch results from the university portal. That site asks automated tools not to access it, and we respect that."* The longer scope sentence is for documentation and institutional conversations.

### Prediction and AI claims

| Never | Because | Instead |
|---|---|---|
| "Predicted questions" | We do not predict | "Appeared in 7 of the last 8 papers" |
| "87% chance of appearing" | No basis for a probability | "7 of 8 papers" |
| "Important questions" | Implies authority we lack | "Frequently repeated questions" |
| "Sure-shot", "must-do", "guaranteed" | Dangerous and false | "Most frequently repeated" |
| "AI predicts" | The AI predicts nothing | "Ranked by historical frequency" |
| "AI-powered" as a selling point | Technology is not a benefit; and it invites exactly the scepticism we want to avoid | Describe what it does |
| "Skip these topics" | Could directly harm a student | "No question matching this topic was found in our 8 papers — our corpus is incomplete" |

The "AI-powered" prohibition is strategic as much as ethical. To a faculty member, "AI-powered exam prediction" is a red flag; "here are the questions that repeated, and here they are in the source papers" is a conversation.

## 28.4 Uncertainty language

A tiered vocabulary matched to actual evidence strength:

| Evidence | Language | Example |
|---|---|---|
| Deterministic, rule-cited | Direct statement | "Your SGPA is 8.43." |
| Observed fact | Direct statement with the observation | "This question appeared in 2019, 2021 and 2024." |
| Statistical over adequate data | Count and denominator | "Appeared in 7 of the last 8 papers." |
| Statistical over thin data | Withhold | "Not enough papers to show reliable frequency (2 available)." |
| Machine-inferred | Hedge plus evidence | "Possibly related to Module 3 — based on similarity to these questions." |
| Externally sourced | Source + time | "Published on vtu.ac.in, retrieved 22 Aug at 14:32." |
| Stale | Explicit staleness | "This may be out of date — last checked 6 hours ago." |
| Unknown | Say so | "We don't have papers for this subject yet." |

**"We don't know" is always an acceptable answer** and is preferred to a confident guess.

## 28.5 Result and calculation copy

```
SGPA 8.43
Based on 6 courses · 28 credits
[ How this was calculated ]
```

Expanded:
```
SGPA = Σ(Ci × Gi) / Σ(Ci)
     = 236 / 28
     = 8.43

Source: VTU Regulations 2022, clause 22OB 6.6(2a)  [ view the document ]
```

**Every academic number can show its formula, its inputs and its clause.** This is the product's differentiator expressed as copy.

### The percentage discrepancy

Because GradTools' percentage will differ from other calculators, the explainer addresses it directly rather than letting students discover a discrepancy and assume we are wrong:

> **Percentage = CGPA × 10**
> Your CGPA of 8.24 gives 82.4%.
>
> Some calculators use `(CGPA − 0.75) × 10`, which would give 74.9%. The VTU 2022 regulation states `M = CGPA × 10` in clause 22OB 6.7, with a worked example. We follow the regulation. [ View the clause ]

This turns a potential complaint into a demonstration of exactly the rigour the product claims.

## 28.6 Attendance copy

The highest-stakes copy in the product, because it can influence a decision with academic consequences.

| Situation | Copy |
|---|---|
| Safe | "You're at 91% in Mathematics III. You can miss 3 more classes and stay above 85%." |
| Below requirement | "You're at 82% in DBMS. The requirement is 85%. Attending the next 7 classes would bring you back." |
| DX risk | "You're at 71% in DBMS. Below 75%, you may be marked DX and barred from the SEE for this course (clause 22OB 3.7)." |
| Unreachable | "85% is not reachable this semester — the maximum you can now reach is 82%. Shortage up to 10% may be condoned by the Vice Chancellor on the Principal's recommendation, with supporting documents. This is not automatic." |

**GradTools never advises skipping a class.** "You can miss 3 more and stay above 85%" is arithmetic. "You should skip tomorrow" is advice, and the product does not give it. The distinction is enforced in review.

Condonation is always described as **discretionary and document-supported**, never as an entitlement.

## 28.7 Notification copy

| Type | Template |
|---|---|
| Announcement | **New on the VTU announcements page** — "⟨title⟩". Detected 14:32. |
| Multiple | **3 new items on the VTU announcements page** |
| Attendance | **A course needs attention** — Open GradTools to see which. |
| DX risk | **Attendance below 75% in one course** — This can affect SEE eligibility. |

Attendance notifications deliberately omit the subject and percentage: a lock-screen notification reading "DBMS attendance 71%" discloses academic information to anyone holding the phone (`20` §11).

Every notification includes the source and time and links to the original where one exists.

## 28.8 Error copy

Pattern: **what happened → is my data safe → what now.**

| Situation | Copy |
|---|---|
| Network | "Couldn't reach GradTools. Your entries are saved on this device. [ Retry ]" |
| Server | "Something broke on our side. Your data wasn't changed. [ Retry ] (Reference: err_8f2a1c9b)" |
| Validation | "Attended (52) can't be more than conducted (48)." |
| Not found | "That paper isn't available any more." |
| Rate limited | "Too many requests. Try again in 30 seconds." |
| Upload rejected | "This file couldn't be accepted. It must be a PDF under 20 MB." |
| Source stale | "This list is from 6 hours ago — we haven't been able to reach the source since then." |

**Never:** "Oops!", "Something went wrong" with no detail, raw error codes, stack traces, or blaming the user ("You entered invalid data" → "Marks must be between 0 and 100").

## 28.9 Empty-state copy

Full table in `04` §4.5. The pattern: what is empty, why that is normal, one action. Never apologetic, never a joke, never fake sample data presented as the user's.

## 28.10 Onboarding and privacy copy

Every personal-data request explains itself at the point of asking:

| Field | Copy |
|---|---|
| Name | "Only used to greet you. Stored on this device." |
| USN | "Used to label your saved results. Stored on this device." |
| Email | "Used to sign you in and sync across devices. We never send anything else." |

Account creation:
> Creating an account lets you use GradTools on more than one device and receive notifications. Everything works without one.

**No dark patterns:** no "No thanks, I don't want to save my progress" decline buttons, no pre-ticked boxes, no interstitial blocking use until an account is made.

Deletion:
> This deletes your profile, results, attendance, timetable and preferences immediately and permanently. Backups containing this data age out by ⟨date⟩. This cannot be undone.
> [ Export my data first ] [ Delete everything ]

## 28.11 The results explanation

The most important paragraph in the product, appearing wherever a student expects automatic result fetching:

> **Why doesn't GradTools fetch my results automatically?**
>
> The VTU results portal asks automated tools not to access it, and we respect that. We also never ask for your login details for any university system.
>
> Enter or paste your result once, and everything else — SGPA, CGPA, backlogs, marks analysis — works from there.

Direct, unapologetic, and it establishes the product's boundaries as a deliberate stance rather than a shortcoming.

## 28.12 Experimental and Alpha labelling

| Stage | Persistent banner |
|---|---|
| Experimental | "Experimental version. Some data shown is sample data, clearly marked. Calculations follow the VTU 2022 regulations." |
| Sample data | "Sample data — not live results" (non-dismissible, on the element) |
| Alpha | "Alpha release. Built and run by one student. Please report anything wrong. [ Known limitations ]" |

The Alpha banner's honesty is deliberate: stating the project's scale sets accurate expectations and makes the quality that *is* there more credible, not less.

## 28.13 Institutional communication

For the college demonstration (`29`), the same rules apply with additional discipline:

| Never say | Say |
|---|---|
| "VTU uses this" | "Built for students following VTU's 2022 scheme" |
| "We have X users" without evidence | The actual number, with how it was measured |
| "Fully accurate" | "Validated against the regulation and against N real grade cards" |
| "Secure" as an adjective | The specific measures, and the known limitations |
| "We could integrate with your systems" | "The architecture supports an official source if one were ever available — none is today" |

**Every claim in a demonstration must be one the product can substantiate on screen.** If a slide says it, the software must be able to show it.

## 28.14 Copy review

- Every user-facing string is reviewed against §28.3's prohibited-claims register before merge.
- Notification templates additionally have an **automated test** asserting no prohibited phrase appears (`22` §10) — templates are edited casually and are the highest-consequence copy in the product.
- New copy patterns are added to this document in the same PR that introduces them.
