# 03 — User Flows

**Status:** Phase 1 draft
**Relationship to other documents:** every flow cites the `FR-` IDs from `02_PRODUCT_REQUIREMENTS.md` it satisfies. Screen-level interaction detail (states, focus, errors) lives in `04_UX_SPECIFICATION.md`.

---

## 3.1 Flow index

| ID | Flow | Stage | Requirements |
|---|---|---|---|
| UF-01 | First visit (cold, anonymous) | 1 | FR-009, FR-100, FR-106 |
| UF-02 | Student setup (profile creation) | 1 | FR-100 |
| UF-03 | Dashboard glance | 1 | FR-021, FR-041 |
| UF-04 | Compute SGPA | 1 | FR-001, FR-003, FR-008 |
| UF-05 | Compute CGPA | 1 | FR-002, FR-004, FR-005 |
| UF-06 | Marks-needed calculation | 1 | FR-006 |
| UF-07 | Attendance entry and bunk planning | 1 | FR-020–025 |
| UF-08 | Enter a semester result | 1 | FR-040, FR-041 |
| UF-09 | Backlog tracking | 3 | FR-042 |
| UF-10 | Create an account and sync | 3 | FR-101 |
| UF-11 | Announcement notification | 3 | FR-060–064 |
| UF-12 | Browse and download a past paper | 3 | FR-081 |
| UF-13 | Browse syllabus | 3 | FR-080 |
| UF-14 | Upload a paper | 3 | FR-083 |
| UF-15 | View module priority / heatmap | 3 | FR-087, FR-088 |
| UF-16 | Timetable setup | 3 | FR-102 |
| UF-17 | Export my data | 3 | FR-103 |
| UF-18 | Delete my account | 3 | FR-104 |
| UF-19 | Recover access to an account | 3 | FR-101 |
| UF-20 | Operator investigates a failed source | 3 | FR-120–124 |

---

## UF-01 — First visit (cold, anonymous)

**Goal:** the visitor understands what GradTools is and completes one useful action within 60 seconds, without an account.

```
Landing (/)
  │  Headline states the promise in one sentence.
  │  Three primary actions, no carousel, no marketing scroll:
  │     [ Calculate SGPA ]  [ Attendance check ]  [ Marks needed ]
  │
  ├─ visitor taps a calculator ──> UF-04 / UF-06 / UF-07 (works immediately, no signup)
  │
  └─ visitor taps "Set up my profile" ──> UF-02
```

**Design constraints**
- No modal, cookie wall, or signup prompt before first value. The signup prompt appears only after a completed useful action, at most once per session.
- If demo/seeded data is displayed anywhere, a persistent, non-dismissible label reads **"Sample data — not live results"** (FR-106).
- The landing page must state, above the fold, that GradTools is not affiliated with or endorsed by VTU.

**Failure states:** none — this flow has no network dependency. If the API is down, all three primary actions still function (they are pure client-side computations).

---

## UF-02 — Student setup

**Goal:** capture the minimum needed to personalise: scheme, branch, current semester. Optionally name, USN.

```
Setup (3 steps, progress visible, every step skippable)

Step 1  College & scheme
        College        [ select — pre-filled with the pilot college ]
        Scheme         [ 2022 ]  (only supported value in Alpha; others shown disabled with
                                  "not yet supported" rather than hidden)
        Branch         [ select ]
        Semester       [ 1–8 ]

Step 2  Identity (ALL OPTIONAL — each field states why it is asked)
        Name           [ ____ ]  "Only used to greet you. Stored on this device."
        USN            [ ____ ]  "Used to label your saved results. Stored on this device."

Step 3  Confirm
        Summary + "Everything above is stored in this browser only.
                   Nothing has been sent to a server."
        [ Finish ]
```

**Privacy behaviour (binding):**
- Steps 1–2 write to browser storage only. No network call occurs during setup.
- Every identity field is skippable, and skipping degrades nothing except the greeting and result labelling.
- **Date of birth is not collected anywhere in GradTools.** No approved feature requires it, so it is not requested, not stored and not present in any schema. See `12` §4 and `32/DEC-008`.
- The only two identity fields that exist are name and USN, both optional and both local-first.

**Edge cases**
- Browser storage unavailable (private mode, storage disabled): the app runs in ephemeral mode with a persistent banner — "Your browser is blocking storage; nothing will be saved between visits." Calculators still work.
- User picks a semester inconsistent with entered results later: results view flags it, does not block.

---

## UF-03 — Dashboard glance

**Goal:** Persona A's three questions answered in one screen without scrolling on a phone.

```
Dashboard
  ├── Attendance status      "3 courses below 85%" ── tap ──> UF-07
  │                          (or "You haven't added attendance yet" + [ Add ])
  ├── Current CGPA           "8.24 · 4 semesters"  ── tap ──> UF-05
  │                          (or empty state with [ Add a result ])
  ├── Next action prompt     Context-sensitive single item, e.g.
  │                          "DBMS attendance at 76% — 4 more classes to reach 85%"
  └── Announcements          Latest 3, each with source + "checked 22 min ago"
                             (Alpha only; absent in Stage 1)
```

**Anti-requirement:** the dashboard must **not** be a wall of cards with invented metrics. Every element either shows real user data or an honest empty state with a single call to action. No "productivity score", no streaks, no gauges without meaning. See `05` §Anti-patterns.

**Empty dashboard (first visit after setup)** is the common case and must be designed first, not as an afterthought: it shows three empty states, each one tap from being filled.

---

## UF-04 — Compute SGPA

```
SGPA calculator
  │
  ├─ Course rows  [ Subject (optional) ] [ Credits ▾ ] [ Grade ▾ ]
  │               (+ Add course)  — starts with 5 rows for a typical semester
  │
  ├─ Optional: [ Load my semester's subjects ]   (if profile scheme/branch/sem set
  │                                               and the subject table is seeded)
  ├─ Live result   SGPA 8.43
  │                "Σ(Ci×Gi) = 236 · ΣCi = 28"
  │
  └─ [ Show how this was calculated ]  ──> expands to:
           • the formula
           • the per-course products table
           • "Source: VTU Regulations 2022, clause 22OB 6.6(2a)" with a link
           • grade table used, with its clause reference
```

**Rules honoured (see `16`):**
- F-graded courses contribute 0 points but their credits **remain** in ΣCi.
- DX-graded courses are excluded from CGPA; the UI states this when a DX grade is selected.
- Rounding to 2 dp happens once, at the end — never on intermediate values.
- With no rows filled, the result area shows "Add at least one course" rather than `0.00` or `NaN`.

---

## UF-05 — Compute CGPA

```
CGPA
  ├─ Rows: [ Semester ] [ Total credits ] [ SGPA ]
  ├─ Auto-filled from saved semester results where available; editable
  ├─ Result: CGPA 8.24  →  Percentage 82.4%  →  Class: First Class with Distinction
  └─ [ Show how ]  → formula, per-semester products, clauses 22OB 6.6(2b), 6.7, 6.8
```

**Critical correctness note surfaced in the UI:** GradTools uses `M = CGPA × 10` per clause 22OB 6.7. Because many popular calculators use `(CGPA − 0.75) × 10`, the explainer explicitly notes the discrepancy and cites the regulation. This turns a potential "your site disagrees with the others" complaint into a demonstration of rigour.

---

## UF-06 — Marks needed

```
Marks needed
  ├─ Inputs:  CIE obtained [ __ /50 ]   Target [ Just pass ▾ | grade P/C/B/B+/A/A+/O ]
  │
  ├─ Guard:  if CIE < 20 (40% of 50)
  │            → "You are not eligible for the SEE in this course
  │               (CIE minimum is 40% of 50 = 20 marks). Clause 22OB 6.3(1)."
  │            → offer the CIE-improvement re-registration explanation (22OB 6.3(8))
  │
  ├─ Output: "You need 42 / 100 in the SEE."
  │          "Binding constraint: overall 40% requirement (not the 35% SEE minimum)."
  │
  └─ Infeasible: "An 'O' grade is no longer reachable — it would require 104/100."
                 (never clamps to 100 and pretends it is achievable)
```

This flow embodies the hardest rule in the system: three independent thresholds apply at once (CIE ≥ 40% of 50, SEE ≥ 35% of 100, total ≥ 40% of 100). See `16` §4 for the full derivation and test matrix.

---

## UF-07 — Attendance entry and bunk planning

```
Attendance
  ├─ Per-course rows: [ Course ] [ Attended ] [ Conducted ] → [ 84% ]
  │
  ├─ Status per course, colour + text + icon (never colour alone):
  │     ≥85%          "Safe"
  │     75–84.9%      "Below requirement — condonation may be needed"
  │     <75%          "DX risk — you may be barred from the SEE"
  │
  ├─ Bunk planner (per course)
  │     "You can miss 3 more classes and stay at or above 85%."
  │     "Assumes no further classes are conducted beyond those you skip."
  │     [ Project with __ classes remaining this semester ]  → refined answer
  │
  └─ Recovery (when below threshold)
        "Attend the next 7 classes consecutively to reach 85%."
        or "85% is not reachable this semester (max attainable: 82%).
            Condonation up to 10% may apply — clause 22OB 3.7(1)."
```

**Rule nuance made visible (FR-024):** the regulation requires 85%, permits the Vice Chancellor to condone up to 10% on specific recommendation, and marks attendance below 75% as DX. GradTools presents 85% as the target and 75% as the hard cliff, and never implies condonation is automatic — it is discretionary and document-supported.

---

## UF-08 — Enter a semester result

```
Add result
  ├─ [ Semester ▾ ]
  ├─ Method:  ( • ) Enter manually    ( ) Paste grade-card text  [Alpha, FR-044]
  │
  ├─ Manual: rows of [ Subject code ] [ Subject ] [ Credits ] [ CIE ] [ SEE ] [ Total ] [ Grade ]
  │          — grade auto-derives from total via 22OB 6.1; user may override,
  │            and an override is flagged and stored as user-asserted
  │
  ├─ Paste: parsed rows shown in a REVIEW table, every field editable,
  │         with "Parsed from your pasted text — check before saving."
  │         Nothing is saved until the student confirms. (FR-044)
  │
  └─ Save  → local storage; also to server if the user has an account (UF-10)
             → recomputes SGPA/CGPA → dashboard updates
```

**Explicitly out of this flow:** any automated retrieval of the result from the university portal. See UF-08b.

### UF-08b — Why results are entered rather than fetched

Students will ask. The product answers in-line, in plain language:

> "GradTools doesn't fetch results from the university portal. That site asks automated tools not to access it, and we respect that. We also never ask for your portal password.
>
> Enter or paste your result once, and everything else — SGPA, CGPA, backlogs, analysis — works from there."

**Wording constraint:** the product says results are *not fetched today* and why. It does **not** claim GradTools could never consume result data — that would be untrue, since an authorized integration would flow through the same `ResultProvider` interface the manual path already uses (`15` §15.5.1). The accurate framing is scope, not incapacity.

This is a product flow, not just an engineering constraint: handled well it becomes a trust signal for Persona C. See `14` §7 and `32/DEC-004`.

---

## UF-09 — Backlog tracking

```
Backlogs
  ├─ Auto-derived from saved results: any course graded F, DX, AB or IC
  ├─ Per backlog: course, semester of origin, grade, attempts, status
  ├─ Attempt counter: each SEE appearance or absence after satisfying CIE+attendance
  │                   counts as an attempt (22OB 6.3(9))
  ├─ DX backlogs show the reason (attendance shortage vs CIE shortfall) because the
  │  remedy differs: DX-attendance requires repeating the course; DX-CIE permits
  │  fresh registration for CIE then SEE (22OB 6.3(7),(8))
  └─ [ Mark cleared ] on a later result entry
```

---

## UF-10 — Create an account and sync

```
Anywhere:  [ Save across devices ]
   │
   ├─ Enter email  →  "Check your email for a sign-in link."
   │                   (no password is ever created — see `11`)
   ├─ Click link   →  session established (httpOnly cookie)
   │
   └─ Merge decision (explicit, never automatic):
         "You have local data on this device and data in your account.
          [ Keep this device's data ] [ Keep account data ] [ Review both ]"
```

**Binding:** local-first data is never silently uploaded on sign-in. The upload is a distinct, consented step, because it changes the privacy posture from "on my device" to "on their server."

---

## UF-11 — Announcement notification

```
Ingestion worker detects a change in a watched public source
   → creates a change_event with provenance (source, fetched_at, hash, parser version)
   → validation passes
   → notification fan-out to subscribers of that category
   → Web Push delivered

Student taps the push
   → Announcement detail
        Title, date
        "Source: vtu.ac.in — retrieved 22 Aug 2026, 14:32"
        [ Open the original ]   ← the original is always one tap away
```

**Copy constraint (FR-063):** the notification says *"New item detected in VTU announcements"*, never *"Your result is out"* or *"VTU has released results"*. See `28`.

**Failure behaviour:** if the source is unreachable or the parser fails validation, **no notification is sent** and the source is marked unhealthy for the operator (UF-20). Silence is the correct failure mode; a wrong result notification is not recoverable.

---

## UF-12 — Browse and download a past paper

```
Papers  →  [ Subject code or name search ]
   ├─ Subject page: papers grouped by year and exam session
   ├─ Each paper card: year, session, source label, "Added 12 Jun 2026"
   ├─ [ View ] (in-browser PDF)  [ Download ]
   └─ Provenance line: where this document came from, and its verification status
        e.g. "Uploaded by a student · verified by operator" or
             "Collected from a public source · unverified"
```

---

## UF-13 — Browse syllabus

```
Syllabus  →  scheme → branch → semester → subject
   ├─ Subject header: code, title, credits, CIE/SEE split
   ├─ Modules 1–5, each with topics and hours
   └─ Cross-links: [ Past papers for this subject ] [ Module priority ]
```

---

## UF-14 — Upload a paper (student-contributed)

```
Upload
  ├─ Client-side pre-checks: PDF only, ≤ 20 MB, page count sane
  ├─ Metadata: subject code, year, session (required — an unlabelled file is useless)
  ├─ Consent line: "Only upload documents you are permitted to share."
  │
  ├─ SERVER: quarantine  ──> validation pipeline (`17` §3):
  │      magic-byte check · declared vs actual MIME · size · page count
  │      · decompression-bomb guard · embedded JS/launch-action rejection
  │      · text extraction in a sandboxed process with CPU/memory/time limits
  │
  ├─ PASS → review queue (operator confirms subject/year) → published
  └─ FAIL → rejected with a non-specific reason to the uploader,
            detailed reason to the operator log
```

The uploader never sees their file published instantly. This is deliberate: instant publication makes GradTools a malware and copyright-infringement distribution channel. See `13` §6.

---

## UF-15 — Module priority / heatmap

```
Subject → Module priority
  ├─ Modules ranked, each showing:
  │      • "Appeared in 7 of the last 8 papers"      ← the evidence, always first
  │      • question count, marks weight
  │      • [ See the 12 questions this is based on ]
  │
  ├─ Header copy: "Based on 8 past papers (2019–2026). This is historical
  │                frequency, not a prediction of the next paper."
  │
  └─ If fewer than 4 papers exist for the subject:
        "Not enough papers to show reliable frequency (2 available)."
        — and the ranking is NOT shown at all.
```

**Binding (FR-088):** evidence precedes conclusion in the visual hierarchy. There is no "AI predicts" language anywhere. See `18` and `19`.

---

## UF-16 — Timetable setup

```
Timetable → weekly grid → tap a slot → assign course, time, room
  └─ Mapped to attendance: marking a slot attended/missed updates the counters (FR-020)
```

---

## UF-17 — Export my data

```
Settings → Privacy → [ Export my data ]
   → JSON file downloaded immediately, containing everything:
     profile, results, attendance, timetable, preferences, account metadata
   → Also lists what is NOT in the file and why (e.g. server access logs, retention window)
```

---

## UF-18 — Delete my account

```
Settings → Privacy → [ Delete my account ]
   ├─ Screen states exactly what will be deleted and what is retained, with retention periods
   ├─ Offers [ Export first ] as the adjacent action
   ├─ Confirmation requires typing DELETE (not just a second click)
   ├─ Immediate: session invalidated, records hard-deleted from the live database
   └─ Confirmation screen + email: "Deleted on <date>. Backups containing this data
      age out by <date>."
```

**No soft-delete-and-forget.** Where a soft delete is used internally for referential integrity, the personal fields are erased at once and only non-identifying records persist. See `09` §Soft deletes and `12` §7.

---

## UF-19 — Recover access

Because there is no password, recovery *is* sign-in: the student requests a new magic link at the same email address. If the email itself is lost, the account is unrecoverable — stated plainly at signup. This is an accepted trade-off: the alternative (security questions, or a recovery flow keyed on semi-public identifiers such as a USN) creates a far worse account-takeover surface for a student-records product. See `11` §6.

---

## UF-20 — Operator investigates a failed source

```
Admin → Sources → "VTU announcements" (status: UNHEALTHY, 3 consecutive failures)
   ├─ Timeline of runs: status, duration, HTTP code, bytes, parser version
   ├─ Last successful snapshot vs current fetched content — diff view
   ├─ Failure classification: network / HTTP / parse / validation
   ├─ Actions: [ Re-run now ] [ Disable source ] [ Open the fixture for this failure ]
   └─ Publishing stays BLOCKED while unhealthy — stale-but-valid data continues to be
      served with its original timestamp, and the UI shows the staleness.
```

The workflow when a parser breaks is defined in `14` §9: mark unhealthy → stop publishing → capture the failing response as a fixture → fix parser → the fixture becomes a permanent regression test → restore.

---

## 3.2 Cross-cutting flow rules

1. **No flow requires an account except sync, push, and account management.**
2. **No flow blocks on the network for a deterministic calculation.**
3. **Every destructive action is confirmed and reversible, or explicitly labelled irreversible.**
4. **Every screen showing external data shows its freshness.**
5. **Every empty state contains exactly one primary action.**
6. **Every error state says what happened, whether data was lost, and what to do next.**
