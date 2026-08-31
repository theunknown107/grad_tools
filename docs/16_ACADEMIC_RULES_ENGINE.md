# 16 — Academic Rules Engine

**Status:** Phase 1 draft — **rules verified against the primary source**
**Implemented by:** `packages/academic-rules` (pure functions, zero dependencies, zero I/O)
**Authority:** this document is the canonical source for every academic calculation in GradTools. No other document, screen or module may define these rules.

---

## 16.1 Provenance

| Field | Value |
|---|---|
| Document | *Regulations Governing the Award of Bachelor of Engineering / Technology Degree, 2022* |
| University | Visvesvaraya Technological University, Belagavi |
| Regulation code | `22OB` |
| URL | `https://vtu.ac.in/wp-content/uploads/2023/05/Regulations-Clr-BE-BTECH-2022-611-02052023.pdf` |
| Retrieved | 2026-08-23 |
| Extraction | `pdftotext -layout` (poppler); clause text read directly |
| Scope | B.E./B.Tech, 2022 scheme, VTU-affiliated **non-autonomous** colleges |
| Verification status | **VERIFIED** for every rule in §16.3–§16.8 unless individually marked otherwise |

**Scope limits, stated explicitly:**
- Autonomous colleges may define different internal rules. This rule set **must not** be applied to them (`08` §College, `09` `is_autonomous`).
- Other schemes (2018, 2021, 2025) are **not covered**. Their rules differ and require their own verified rule set.
- The target college's adherence to these regulations without local amendment is **NOT VERIFIED** (`32/OQ-011`).

## 16.2 Engineering rules

1. **Every function cites its clause** in a doc comment.
2. **No I/O, no dependencies, no clock, no randomness.** Identical results in browser and server.
3. **Rules are data, not code.** Thresholds, bands and formulas come from a `RuleSet` (`08`, `09`), so a different scheme is a different row, never a different code path.
4. **Rounding happens once, at the end.** Intermediate values keep full precision.
5. **No silent clamping.** An impossible input returns an explicit impossibility, never a plausible-looking number.
6. **No `NaN`, no `Infinity`, no `null` leaking to the UI.** Every function returns a discriminated result type.

## 16.3 Grade scale — VERIFIED (22OB 6.1)

> *"The total marks obtained by the student in CIE and SEE of a course is expressed as a percentage to compute the grade points and the letter grade is awarded as indicated in the table below."*

| Letter | Descriptor | Grade point | Marks % |
|---|---|---|---|
| O | Outstanding | 10 | 90–100 |
| A+ | Excellent | 9 | 80–89 |
| A | Very Good | 8 | 70–79 |
| B+ | Good | 7 | 60–69 |
| B | Above Average | 6 | 55–59 |
| C | Average | 5 | 50–54 |
| P | Pass | 4 | 40–49 |
| F | Fail | 0 | 0–39 |

**Note the irregular bands:** B is a 5-point band (55–59) and C is a 5-point band (50–54), while the others are 10-point. A calculator that assumes uniform 10-point bands is wrong at exactly these boundaries — a common defect in third-party tools.

**Boundary semantics:** bands are inclusive at both ends on integer percentages. A percentage of 89.5 requires a defined policy; GradTools uses the total marks as reported (VTU reports integer totals out of 100), so fractional percentages do not arise in practice. Where a fractional value is entered manually, the value is **truncated toward zero** before band lookup, never rounded up — rounding 89.5 to 90 would award an O grade the student did not earn. *(This truncation policy is an engineering decision, not a clause; recorded as assumption `A-16.1`.)*

**Additional rule (22OB 6.1(3)):** *"If there is no SEE for a course, then the CIE marks alone will be the basis for the determination of letter grade."* Modelled by `subjects.has_see` (`09` §9.4).

## 16.4 Special grades — VERIFIED (22OB 6.2)

| Letter | Points | Counts in CGPA? | Meaning |
|---|---|---|---|
| `DX` | 0 | **No** | Attendance below 75%; repeat the course |
| `AU` | 0 | No | Satisfactory in an audit course |
| `AB` | — | Treated as F for progression | Absent from the examination |
| `PP` | 0 | No | Passed a non-credit course |
| `NP` | 0 | No | Not passed a non-credit course |
| `IC` | — | No | Incomplete; a placeholder converted later to a grade or to F |
| `W` | — | No | Dropped or withdrawn; must be cleared later |

**Critical implementation consequence:** `DX` credits are **excluded** from CGPA (22OB 6.2(1) states credits are not included). `F` credits are **included** — an F is a real attempt at a registered course with 0 grade points, and excluding it would inflate CGPA. Getting this backwards is the highest-impact single bug available in this system.

## 16.5 Assessment structure — VERIFIED (22OB 4.1)

> 22OB 4.1(4): *"CIE and SEE to carry 50% weightage each, to enable the course to be evaluated for a total of 100 marks, irrespective of its credits."*

| Component | Conducted out of | Weight in the total |
|---|---|---|
| CIE — Continuous and Comprehensive Evaluation (CCE) | 25 | part of CIE's 50 |
| CIE — Internal Assessment Tests (IAT) | 25 | part of CIE's 50 |
| **CIE total** | **50** | **50** |
| **SEE** | **100** | **50** (scaled by ½) |
| **Course total** | | **100** |

The SEE is written for 100 marks and contributes 50 to the course total. Every formula below is stated in terms of the raw SEE score out of 100, because that is the scale the regulation's thresholds are written against.

> **CORRECTED IN M4, against a real grade card (`32/OQ-024`).** This paragraph
> previously justified the raw-100 scale by claiming it is "the number a student
> actually sees on a grade card". **That claim was false.** A real VTU
> provisional result prints three columns — `Internal`, `External`, `Total` —
> and the printed relationship is a plain sum:
>
> ```
> Total = Internal + External          e.g.  44 + 36 = 80
> ```
>
> so the printed `External` is the SEE's **contribution out of 50**, not the raw
> script mark out of 100. An external of 36 on the document is a raw SEE of 72.
>
> The evidence is unambiguous. One row shows external 19 with a result of **P**.
> Read as a raw SEE out of 100 that is 19%, below the 35% SEE minimum, and the
> course would have to be a fail — but VTU printed a pass. Read as a contribution
> out of 50 it is 38%, and it passes. The printed scale is therefore 50.
>
> **No calculation was wrong**: `36` and `72/2` are the same contribution, and
> the engine's arithmetic already matched the regulation. What was wrong was the
> stated justification, and the interface hazard it invited — `calculateRequiredMarks`
> returns `requiredSee` on the **raw 100 scale**, which is *twice* the number a
> student reads off their own document. That function is not yet surfaced in any
> screen; when it is, it must either be converted to the printed scale or
> labelled unmistakably. Recorded as `A-16.7`.
>
> `validateCourseMarks` (`packages/academic-rules/src/marks.ts`) works in the
> **printed** scale and rejects a raw SEE pasted into the external column.


## 16.6 Passing standards — VERIFIED (22OB 6.3)

Three **independent, simultaneous** thresholds:

| # | Threshold | Clause | Expressed concretely |
|---|---|---|---|
| 1 | CIE ≥ 40% of CIE maximum — required to be *eligible* for the SEE | 6.3(1) | CIE ≥ 20 / 50 |
| 2 | SEE ≥ 35% of the SEE maximum — required to pass the SEE head | 6.3(2) | SEE ≥ 35 / 100 |
| 3 | CIE + SEE ≥ 40% of the course maximum — required to pass the course | 6.3(3) | CIE + SEE/2 ≥ 40 / 100 |

Minimum passing grade is **P** (grade point 4) — 22OB 6.3(3).

**On the wording of 6.3(2):** the clause reads *"The maximum weightage of SEE marks shall be 50 and marks to be secured for passing shall be 35% of the maximum marks of SEE."* Whether "maximum marks of SEE" denotes 100 (the paper) or 50 (the weightage) is textually ambiguous — but the two readings are **proportionally identical** (35% of 100 = 35/100; 35% of 50 = 17.5/50 = 35%). GradTools therefore implements the threshold as a **percentage of the SEE scale**, which is correct under either reading. *(Recorded as assumption `A-16.2`; no student-visible number depends on the ambiguity.)*

**Further verified rules:**
- 6.3(7): a student meeting attendance but failing the CIE minimum is **not eligible for the SEE**, is treated as failed, and is marked **DX**.
- 6.3(8): such a student may register afresh for CIE in a later semester, then sit the SEE.
- 6.3(9): *"Each appearance to SEE or absence after completing CIE and attendance requirements to complete a course shall be treated as an attempt."*
- 6.3(6): grade assignment — fails conditions → `F`; absent → `AB`; attendance shortage → `DX`; incomplete → `IC`.

## 16.7 Attendance — VERIFIED (22OB 3.7)

> *"a student shall obtain a minimum attendance of 85% in each of the courses registered. However, if the attendance is below 85%, the shortage upto a maximum of 10% of the attendance may be condoned by the Vice Chancellor on the specific recommendations of the Dean/Principal…"*

> 22OB 6.2(1): `DX` — *"Attendance below 75%"*

> 22OB 3.7(5): *"A student who does not satisfy the attendance requirement … shall not be permitted to appear for the Semester End Examinations of those courses. The grade card for such courses shall be marked as DX. The candidate shall repeat those courses whenever offered next."*

| Value | Figure | Nature |
|---|---|---|
| Required attendance | **85%** | The rule |
| Maximum condonation | **10 percentage points** | **Discretionary** — Vice Chancellor, on Dean/Principal recommendation, with documented grounds |
| Effective floor | **75%** | Below this, `DX` |
| Basis | Per course, per the academic-calendar period | 3.7(1)–(2) |

**Product implication (FR-024).** GradTools presents **85% as the target**, because that is the rule. It presents 75% as the point at which `DX` applies. It never presents condonation as automatic or expected — it is discretionary, requires documented grounds (medical, NSS/NCC, national-level parades, university/state/national/international sports and cultural events, seminars and paper presentations of significant value) and requires a recommendation submitted before the last day of the semester.

A bunk planner that silently targets 75% would be giving students academically dangerous advice. The default threshold is 85%, adjustable only through an explicit disclosure control that states what condonation actually involves.

## 16.8 SGPA, CGPA, percentage, class — VERIFIED (22OB 6.6–6.8)

### SGPA — 22OB 6.6(2a)

> *"The SGPA is the ratio of sum of the product of the number of credits with the grade points secured by a student in all the courses taken by him and the sum of the number of credits of all the courses undergone by a student"*

```
SGPA = Σ(Ci × Gi) / Σ(Ci)
```
where `Ci` is the credits of course *i* and `Gi` its grade point.

### CGPA — 22OB 6.6(2b)

> *"The CGPA is also calculated in the same manner considering all the courses undergone by a student over all the semesters of a programme"*

```
CGPA = Σ(Ci × Si) / Σ(Ci)
```
where `Si` is the SGPA of semester *i* and `Ci` the total credits of that semester.

### Rounding — 22OB 6.6(2b)

> *"the SGPA and CGPA shall be rounded off to 2 decimal points and reported in the grade cards"*

Applied **once, at the end**. Half-up at 2 decimal places. Intermediate values retain full precision.

### Percentage — 22OB 6.7 · **the correction**

> *"Percentage of marks secured, M = CGPA Earned x 10"*
> *"E.g.: Illustration for a CGPA of 8.20; Percentage of marks secured, M = 8.20 × 10 = 82.0 %"*

```
M = CGPA × 10
```

**This contradicts the formula published by essentially every third-party VTU calculator**, which use `(CGPA − 0.75) × 10`. For a CGPA of 8.20 the difference is 82.0% versus 74.5% — 7.5 percentage points, enough to change a class classification and to matter for a job application.

`(CGPA − 0.75) × 10` is associated with other universities' conversion conventions and with earlier VTU practice; **it does not appear in the 2022 regulation.** GradTools implements the clause as written, cites it in the UI, and explicitly notes the discrepancy so a student who compares tools understands why the numbers differ (`03` §UF-05).

This finding is the clearest justification for the master instruction's rule against relying on model memory for academic rules.

#### Formula identity, not a hard-coded expression

The percentage conversion is **never written inline**. It is selected by `RuleSet.percentage_formula`, an identifier resolved against a formula registry:

| `percentage_formula` | Expression | Applies to |
|---|---|---|
| `cgpa_x_10` | `M = CGPA × 10` | **VTU 2022 (`22OB`) — the only formula in use today** |
| `cgpa_minus_0_75_x_10` | `M = (CGPA − 0.75) × 10` | **Not assigned to any active rule set.** Registered only so that, if a future scheme is verified to use it, it is a data value rather than a code branch |

Rules enforced by the architecture:

1. **The 2022 rule set's `percentage_formula` is `cgpa_x_10`.** A regression test asserts this by reading the seeded rule set, so a seed edit cannot silently change it.
2. **No calculator function accepts a formula as a literal.** `calculatePercentage(cgpa, ruleSet)` resolves the identifier; there is no code path that computes a percentage without a rule set in hand.
3. **A rule set cannot be active without `verified_at` and a clause citation** (database constraint, `09` §9.4). Assigning the 0.75-offset formula to the 2022 scheme would require falsifying a clause citation, which a reviewer can check against the linked document.
4. **Older or other schemes get their own explicitly versioned rule set**, with their own verified provenance, if they are ever supported. They never inherit or share the 2022 values (`16` §13).

The obsolete formula is therefore not "avoided by being careful". It is structurally unable to reach a 2022 calculation without an explicit, verifiable, test-breaking change.

### Class equivalence — 22OB 6.8

| Class | Condition |
|---|---|
| First Class with Distinction (FCD) | M ≥ 70 |
| First Class (FC) | 60 ≤ M < 70 |
| Second Class (SC) | 50 ≤ M < 60 |
| Pass Class (P) | 40 ≤ M ≤ 50 |

*Note: the regulation's own bands overlap at exactly M = 50 (Second Class states 50 ≤ M < 60; Pass Class states 40 ≤ M ≤ 50). GradTools resolves M = 50 to **Second Class**, the higher classification, and records this as assumption `A-16.3`. The overlap is in the source text, not an extraction error.*

Class equivalence applies **after successful completion of the programme** (22OB 6.8), so it is shown as provisional for a student still enrolled.

## 16.9 Derived calculators

These are GradTools' own compositions of the verified rules. They are marked as derived, not quoted.

### Marks needed in the SEE

Given CIE obtained `C` (out of 50) and a target total percentage `T` (out of 100):

```
Eligibility:   if C < 20            → INELIGIBLE for the SEE  (22OB 6.3(1), 6.3(7))
SEE head:      S ≥ 35                                          (22OB 6.3(2))
Overall:       C + S/2 ≥ T   ⟹   S ≥ 2 × (T − C)               (22OB 6.3(3))

Required S = max(35, 2 × (T − C))

if Required S > 100 → UNREACHABLE
```

The result always names the **binding constraint**, because that is the actionable information.

| C (CIE/50) | Target | 2(T−C) | Required SEE /100 | Binding constraint |
|---|---|---|---|---|
| 20 | Pass (40) | 40 | **40** | Overall 40% |
| 30 | Pass (40) | 20 | **35** | SEE minimum 35% |
| 45 | Pass (40) | −10 | **35** | SEE minimum 35% |
| 40 | A (70) | 60 | **60** | Overall target |
| 35 | O (90) | 110 | **UNREACHABLE** (would need 110) | — |
| 18 | any | — | **INELIGIBLE** (CIE < 20) | CIE minimum |
| 50 | O (90) | 80 | **80** | Overall target |

Row 3 is the one most tools get wrong: with a strong CIE, the overall requirement is already satisfied, and the SEE head minimum of 35 becomes the binding floor.

#### Both scales are returned (M4.1 §4)

`calculateRequiredMarks` returns the requirement on **both** scales, always,
because there are two different numbers for the same performance and they differ
by a factor of two:

| Field | Scale | Meaning |
|---|---|---|
| `rawSeeRequired` / `rawSeeMaximum` | out of 100 | The SEE script. What the regulation's thresholds are written against |
| `printedExternalEquivalent` / `printedExternalMaximum` | out of 50 | What appears in a grade card's `External` column — the only figure a student can read off their own document (`A-16.7`) |

A raw SEE of 58/100 is a printed external of 29/50.

**The mathematics did not change.** The calculation still works in the raw scale,
which is correct. What changed is that the result no longer returns a bare
`requiredSee` that looks like a grade-card number and is not one. The printed
equivalent is deliberately **not** rounded: it is a converted view of
`rawSeeRequired`, and rounding it would produce a second figure that does not
convert back. Regression tests assert the two fields differ and that the
conversion is exactly the SEE's weight in the course total.

### Attendance calculations

```
current_pct   = attended / conducted × 100

# How many more classes can be missed and still hold the threshold,
# assuming no further classes are conducted beyond those missed:
can_miss      = floor( (attended × 100 / threshold) − conducted )
can_miss      = max(0, can_miss)

# With a projection of R further classes to be conducted:
can_miss_proj = floor( ((attended + R) × 100 / threshold) − (conducted + R) )
                # i.e. attend all R, then how many of them could be missed

# Consecutive classes that must be attended to reach the threshold:
must_attend   = ceil( (threshold × conducted − 100 × attended) / (100 − threshold) )
must_attend   = max(0, must_attend)
```

`must_attend` is undefined for `threshold = 100` and returns UNREACHABLE where the semester's remaining classes are fewer than the requirement. It never returns a negative number and never silently clamps.

| Attended | Conducted | Threshold | Current | Can miss | Must attend |
|---|---|---|---|---|---|
| 45 | 50 | 85% | 90.0% | 2 | 0 |
| 42 | 50 | 85% | 84.0% | 0 | 4 |
| 40 | 50 | 85% | 80.0% | 0 | 17 |
| 30 | 50 | 85% | 60.0% | 0 | 84 (likely unreachable — flagged) |
| 38 | 50 | 75% | 76.0% | 0 | 0 |

The fourth row shows why the "unreachable" report matters: telling a student to attend 84 consecutive classes in a semester with 20 remaining is not advice, it is noise. The engine returns `{ reachable: false, max_attainable_pct }` and the UI states the condonation position (`16` §7).

### Target CGPA

Given current CGPA `Ccur` over credits `Kcur`, and remaining credits `Krem`, the SGPA required to reach target `Ctgt`:

```
required_sgpa = (Ctgt × (Kcur + Krem) − Ccur × Kcur) / Krem

if required_sgpa > 10 → UNREACHABLE (report the maximum attainable CGPA instead)
if required_sgpa < 0  → already achieved
```

Always reports the maximum attainable CGPA when a target is unreachable, which is the useful answer.

## 16.10 Result-type contract

Every function returns a discriminated union, so an impossible case cannot be mistaken for a number:

```ts
type RuleResult<T> =
  | { ok: true;  value: T; explanation: Explanation }
  | { ok: false; reason: 'insufficient_input' | 'ineligible' | 'unreachable' | 'invalid_input';
      detail: string; explanation: Explanation }

type Explanation = {
  formula: string          // "SGPA = Σ(Ci × Gi) / Σ(Ci)"
  clause: string           // "22OB 6.6(2a)"
  source_url: string
  inputs: Record<string, number>
  steps: { label: string; value: number }[]
  rule_set_version: number
}
```

`Explanation` is returned on **every** call, success or failure. This is what makes "show how this was calculated" (FR-008) a property of the engine rather than a UI feature bolted on afterwards — the UI cannot display a number without also having its derivation.

## 16.11 Test strategy

The rules engine carries the highest test standard in the repository.

### Golden tests from the regulation
The worked example in the regulation's Annexure-I is encoded as a golden test. If our SGPA/CGPA disagrees with VTU's own published example, the implementation is wrong. *(The Annexure example must be transcribed from the source PDF during implementation — noted as a Milestone 4 task.)*

### Boundary tests
Every grade band boundary: 39/40, 49/50, 54/55, 59/60, 69/70, 79/80, 89/90, 100. Every threshold: CIE 19/20/21, SEE 34/35/36, total 39/40/41, attendance 74.9/75/85/85.1.

### Property-based tests (`fast-check`)
| Property | Statement |
|---|---|
| SGPA range | For any valid course set, 0 ≤ SGPA ≤ 10 |
| SGPA monotonicity | Raising any grade point never lowers the SGPA |
| Credit weighting | Doubling every credit leaves the SGPA unchanged |
| CGPA consistency | With one semester, CGPA = that semester's SGPA |
| DX exclusion | Adding a DX course never changes the CGPA |
| F inclusion | Adding an F course never *raises* the SGPA |
| Attendance non-negativity | `can_miss ≥ 0` and `must_attend ≥ 0` always |
| Attendance inverse | After attending `must_attend` classes, the threshold is met |
| Marks-needed soundness | Scoring the returned SEE value always achieves the target |
| Marks-needed minimality | Scoring one mark less never achieves it |

The last two are the strongest tests in the suite: they verify the calculator against the definition of correctness rather than against hand-computed examples.

### Differential tests
Client and server compute independently on identical inputs and must agree exactly. A mismatch is a Sev-2 defect (`07` §7.3).

### Real-grade-card tests
Once real grade cards are available, their reported SGPA is compared against ours. Any disagreement is investigated before Alpha — this is the only test that validates our reading of the regulation against VTU's actual practice, and it is the most valuable one. Recorded as a Milestone 4 requirement.

**Status after M4 (`32/OQ-024`, PARTIALLY VERIFIED).** One real artifact has been
validated: a semester-4 provisional result carrying 9 courses.
`packages/academic-rules/test/real-grade-card.test.ts` runs against it.

| Validated by the artifact | Not validated — the artifact does not print it |
|---|---|
| Subject-code format, including elective suffixes | Credits |
| Internal, external and total marks | Letter grades |
| `Total = Internal + External`, all 9 rows | Grade points |
| Per-subject result status (`P`) | **SGPA** |
| The three passing thresholds, 8 of 9 rows | **CGPA** |
| A course with no SEE (22OB 6.1(3)) | Percentage and class |
| The printed external scale (`A-16.7`) | `AB` / `IC` / `W` behaviour (`OQ-018`) |

**The SGPA and CGPA formulas remain validated only against the regulation, not
against VTU's output.** A provisional result carries no aggregate. Closing
`OQ-024` requires a consolidated marks card or a grade card that prints credits,
letter grades and SGPA.

## 16.12 Assumptions register

| ID | Assumption | Risk | Resolution |
|---|---|---|---|
| `A-16.1` | Fractional mark percentages truncate toward zero before band lookup | Low — VTU reports integer totals | **Premise corroborated** (`32/OQ-024`): all 9 rows of a real card are integers out of 100, so fractional percentages do not arise. The truncation *policy* itself remains untested, as no card has yet shown a fractional total |
| `A-16.2` | The SEE 35% threshold is proportional and reading-independent | None — both readings coincide | Settled |
| `A-16.3` | M = 50 resolves to Second Class (the regulation's bands overlap there) | Low | Confirm with a college source if it ever matters |
| `A-16.4` | `AB` is treated as `F` for progression and as 0 points for SGPA | Medium — the regulation does not state a grade point for `AB` | **NOT FULLY VERIFIED.** `32/OQ-018` |
| `A-16.5` | The target college applies these regulations unamended | Medium–high | `32/OQ-011` — requires a college document |
| `A-16.6` | Non-credit courses (`PP`/`NP`) are excluded from SGPA and CGPA | Low — consistent with 22OB 6.2 and the activity-points clause | Confirm against a real grade card |
| `A-16.7` | A grade card prints the SEE **contribution out of 50**, not the raw script mark out of 100 | Was High as an unstated confusion; now **VERIFIED** against a real grade card (`32/OQ-024`) | **Settled.** Enforced by `validateCourseMarks` and its tests |

## 16.13 Versioning

- Every `RuleSet` carries a `version` and `effective_from`/`effective_to`.
- Every `semester_records` row stores the `rule_set_id` used at write time (`09` §9.5), so a later rule correction never retroactively alters a student's stored history.
- Changing a rule creates a **new version**; it never edits an existing one.
- A `RuleSet` cannot be marked active without `verified_at` — enforced by a database constraint.
- Adding a scheme (2021, 2025) means adding a rule set with its own verified provenance. **Two schemes never share calculation logic by default** — this is the master instruction's requirement, implemented as data separation rather than as branching code.

## 16.12 M10A — the intelligence layer sits ON the rules, never beside them

M10A adds analysis. It adds **no arithmetic**. Every figure it reports is
either produced by `@gradtools/academic-rules` or is a comparison of two
figures the rules produced.

| Reported by M10A | Where the number comes from |
|---|---|
| SGPA per semester | `calculateSGPA` |
| CGPA, percentage | `calculateCGPA` and the rule set's own percentage formula |
| Grade points | `resolveGrade` |
| Change between semesters | Subtraction of two `calculateSGPA` outputs |
| Highest, lowest | `Math.max`/`min` over those same outputs |

There is no second grading path, no cached SGPA, and no rule table in the
analysis module.

### What it deliberately does not compute

**A mean SGPA.** It would be one line and it would look useful. It would also be
a second aggregate sitting beside CGPA that no regulation defines: CGPA is
credit-weighted, an unweighted mean of SGPAs is not, and the two differ whenever
semesters carry different credit loads. A student seeing both would have no way
to tell which one their college means.

`cumulativeStanding` already produces the authoritative aggregate. `semesterHistory`
therefore reports what was **observed** — the highest and the lowest actual
SGPA — and leaves averaging to the rules engine. A test asserts the property is
absent, so it cannot be added back without deleting the test that explains why.

### Exclusion, not substitution

A semester takes no part in the comparison when it has no result, when its
pinned rule set is unavailable, or when the rules refused to grade it. In every
case the figure is `null` and the reason is named. **None of the three is
treated as a zero**, none is re-graded under a substitute, and none is counted
towards highest, lowest or any delta — the M6 correction, re-pinned by test.

## 16.13 `evaluateCourseResult` — did this course pass?

Added after inspecting five real academic artifacts (two college timetables,
two VTU provisional results, one VTU draft examination timetable). **The images
are not committed**: they carry a real seat number, name and staff contact
numbers, and are gitignored.

### The question a real result card actually poses

A VTU provisional result prints **Subject Code · Subject Name · Internal ·
External · Total · Result · Announced on**. It prints **no grade letter, no
grade point, no credits, no SGPA and no CGPA.**

`validateCourseMarks` checked a row was well formed and `calculateRequiredMarks`
answered what was still needed, but nothing answered *what already happened*.
That gap is where a hard-coded threshold ends up in a component.

### The three heads (22OB 6.3)

| Head | Rule | Under VTU 2022 |
|---|---|---|
| CIE eligibility | `internal >= cieMinPct% of CIE max` | 40% of 50 = **20** |
| SEE | `external >= seeMinPct% of SEE scale` | 35% of 50 = **17.5** |
| Overall | `total >= overallMinPct% of course max` | 40% of 100 = **40** |

All three must hold; failing any one carries the course.

### The product's "below 18" is this rule, not a new one

The requirement was stated as *"a backlog if the external is below 18"*. That is
**35% of the 50-mark printed SEE scale = 17.5**, so 18 is the smallest whole
mark clearing it. The number is derived from `seeMinPct`, never written down,
and two tests pin the boundary at 17 and 18 so the engine and the product
statement cannot drift apart.

**Corroborated by a real artifact**, whose row sitting exactly on this
boundary is printed `P`. The marks themselves are not reproduced here: the
threshold is derived from the rule, and a student's own score is not needed to
state it.

### The case that makes a bare threshold dangerous

A real card carries a Physical Education row with **an internal above the
ordinary CIE maximum of 50, an external of 0, and a printed `P`**. Both of those
are impossible under the ordinary CIE + SEE structure, and together they are the
signature of a CIE-only course.

Illustrative — **these numbers are synthetic**, chosen to show the same shape
without reproducing a real student's marks:

```
internal 72 · external 0 · total 72 · Result: P
```

Read as *"external below 18 means a backlog"*, such a row is a failure. **It is
not.** The course is assessed on CIE alone over the whole course maximum
(22OB 6.1(3)): there is no SEE to fall short of, and the external column is
structurally zero.

So the SEE head returns **`not_applicable`**, a third outcome distinct from
`passed` — collapsing the two would make "passed every head" true of a course
never examined. `hasSee`, which `validateCourseMarks` already carried, is what
separates them.

**`hasSee` is reference data and is never inferred from the marks.** An external
of 0 is equally consistent with "no SEE" and with "sat the SEE and scored
nothing", and those have opposite outcomes. A test pins both readings of the
same mark row.

Getting this wrong would tell a student they have a backlog in a subject the
university has passed them in.

### Coverage

100% statements, branches, functions and lines — the standard this package
holds. One defensive branch for non-finite minima was **removed rather than
tested**: it is unreachable, and unreachable code is what that standard exists
to surface.
