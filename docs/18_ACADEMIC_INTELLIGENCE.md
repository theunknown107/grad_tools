# 18 — Academic Intelligence

**Status:** Phase 1 draft
**Governing constraint:** every output in this document is **historical evidence**, never a prediction. The boundary is enforced in `19_RECOMMENDATION_AND_AI_POLICY.md` and in the copy rules in `28`.

---

## 18.1 What this subsystem is, and is not

**Is:** a set of deterministic statistics computed over a corpus of past question papers, presented with the evidence that produced them.

**Is not:** a prediction engine. The source concept behind this feature was called an "SEE Prediction Engine". That name is abandoned deliberately. GradTools cannot know what will be on the next paper, and a product that implies otherwise is both dishonest and, at the moment a student's exam contradicts it, self-destructive.

**The reframing:** students do not actually need a prediction. They need to know where to spend limited revision time. "Module 3 has appeared in 8 of the last 8 papers, worth an average of 20 marks" is more useful *and* more defensible than "Module 3 is 87% likely to appear."

## 18.0a What the source text can and cannot support (M5A.2)

Everything in this document assumes trustworthy question text. The OCR
qualification measured how far that assumption holds, and it holds unevenly.

| Field | Descriptive papers | MCQ papers | Confidence |
|---|---|---|---|
| Page boundaries | reliable | reliable | **high** |
| Module (1–5) | recovered and propagates | n/a — no modules | **high** |
| Question number | recovered | recovered | **high** |
| Marks | recovered | n/a — uniformly 1 | **high** |
| Bloom's level / CO | recovered together with marks | n/a | **high** |
| Sub-question letter (a/b/c) | **3–4 of 15–20 rows** | n/a | **low** |
| Question text (prose) | readable, noisy | readable | medium |
| Question text (mathematics) | **destroyed** | n/a | **none** |

> **UPDATED IN M5A.4.** The table above measured FLATTENED text. Positional
> extraction changes two rows materially (docs/17 §17.16):
>
> | Field | Flattened | Positional (native) | Positional (OCR) |
> |---|---|---|---|
> | Sub-question letter | 3–4 of 15–20 | **essentially complete** | partial, far better |
> | Marks / Bloom's / CO | by regex, fragile | **by column position** | by column position |
>
> Sub-question identity is no longer the blocker it was for native-text papers,
> and is substantially improved for scans. The two consequences below still
> hold, and one is now sharper: **positional extraction is a descriptive-paper
> technique**. An MCQ paper is a single-column flow where geometry adds little.

> **M5A.5 UPDATE — the structure is now DURABLE, and its trust level is
> explicit.** Extracted questions are stored with page, bounding box, structural
> confidence and a human review state (docs/17 §17.17). Anything built on this
> dataset can therefore ask a question it could not ask before:
>
> ```sql
> WHERE confidence = 'high' AND review_state <> 'rejected'
> ```
>
> **Nothing downstream should treat unreviewed low-confidence rows as fact.**
> They are kept, not deleted, precisely so a person can look — but frequency
> analysis, topic clustering or any later intelligence must filter on
> confidence, or it will measure the parser's mistakes and report them as
> academic patterns.
>
> Three separate trust signals, never to be blended into one score: how well the
> ENGINE read (OCR), how much the GEOMETRY agreed (structural confidence), and
> what a HUMAN concluded (review state).

> **M5A.6 UPDATE — the trust filter now has measured meaning, and it is not
> the one you would guess.** On 71 adjudicated records (docs/17 §17.18):
>
> - `low` / `medium` are dependable warnings: 10% and 0% accepted as-is.
> - **`high` was accepted only 50% of the time.** It means the geometry agreed,
>   not that the text is right — most high-confidence corrections were truncated
>   question text.
>
> So `WHERE confidence = 'high'` is **not** a correctness filter. For anything
> that reads question TEXT — frequency analysis, clustering, similarity — the
> only defensible filter today is `review_state IN ('accepted','corrected')`,
> and the reviewed corpus is small.
>
> **Structural fields are the dependable part.** Module 100%, sub-question label
> 97%, MCQ item number 100%. Question number is layout-dependent: 9/9 where it
> sits on the first row of its cell, 0/15 where it is vertically centred.

**Two consequences for anything built on top.**

*Sub-question identity is the weak link.* Marks, module and CO attach reliably
to a row, but which of `a`, `b`, `c` a row belongs to is recovered only about a
fifth of the time — the letter merges into the text or is lost at the column
edge. Any feature keyed on "question 3(b)" is building on the least reliable
field available; features keyed on module and marks are on solid ground.

*Mathematics is searchable, not reconstructable.* `x²p² + xyp − 6y²` came back
as `x’p? + xyp-6y7 4S`. Frequency analysis over maths topics can work from the
prose stems; presenting a reconstructed equation to a student cannot, and must
not be attempted from this text.

Nothing in this document is implemented. This section exists so that the first
intelligence feature is designed against measured input quality rather than an
assumed one.

## 18.2 Prerequisites

Every feature here depends on inputs that do not yet exist:

| Requirement | Minimum | Status |
|---|---|---|
| Papers per subject | **4** for any ranking to be shown | Depends on the corpus (`DEC-007`) |
| Syllabus modules per subject | 5, with topics | Manual data entry — critical path (`02` §2.6) |
| Question extraction quality | Structural mapping working | Depends on whether papers have a text layer (`32/OQ-019`) |

**Below 4 papers, nothing is shown.** Not a ranking with a caveat — nothing. A frequency computed over 2 papers is noise wearing the costume of data, and displaying it with a disclaimer does not stop a student acting on it.

## 18.3 Module frequency analysis (the primary feature)

The core statistic, and deliberately simple:

```
For subject S with papers P₁..Pₙ (n ≥ 4):

  For each module m in 1..5:
    appearance_count = number of papers containing ≥1 question mapped to m
    question_count   = total questions mapped to m across all papers
    marks_total      = sum of marks of those questions
    marks_avg        = marks_total / n
    years_appeared   = [list of years]

  frequency = appearance_count / n
```

**A caveat GradTools states in the UI, because it is the honest one:** VTU SEE papers are *structurally required* to include two questions from every module (22OB 4.x, verified in `17` §5). So in a well-formed paper, every module appears — and `frequency` will be 1.0 for all five modules.

This makes raw module frequency nearly useless for standard papers, and pretending otherwise would be exactly the kind of fake analytics this project's design principles prohibit (`05` §Anti-patterns). The genuinely informative signals are finer-grained:

| Signal | What it actually tells a student | Useful? |
|---|---|---|
| Module appearance frequency | Almost always 1.0 by regulation | **Low** — shown for completeness, with the structural explanation |
| **Topic frequency within a module** | Which topics inside a module recur | **High** |
| **Repeated questions across years** | Questions that have literally reappeared | **Highest** |
| Marks distribution across topics | Where the marks concentrate | High |
| Question-type distribution (derive/explain/numerical/compare) | What kind of preparation a subject rewards | Medium |
| Rare/dormant topics | Syllabus topics that have never appeared | Medium — with a strong caveat |

**This is the most important analytical finding in Phase 1**, and it reshapes the feature: the value is at the *topic* level, not the module level. The UI leads with repeated questions and topic frequency, and shows module frequency only as context with its structural explanation.

## 18.4 Topic-level analysis

```
For each syllabus topic t in module m:
  matched_questions = questions in module m whose text matches t
      tier 1: keyword/phrase match against the topic name and its aliases
      tier 2: embedding cosine similarity ≥ 0.75 (fallback for paraphrasing)

  topic_frequency = papers containing ≥1 question matched to t  /  n
  topic_marks     = mean marks of matched questions
```

Topic matching is genuinely hard and genuinely uncertain. Controls:
- Every matched question is **listed as evidence** so a student can judge the match themselves.
- Match method and confidence are stored per match.
- A topic below 0.6 match confidence is shown as "possibly related", not counted in the frequency.
- Topic names come from the seeded syllabus (`08` §SyllabusModule), so match quality depends on data-entry quality — a dependency stated rather than hidden.

## 18.5 Repeated-question detection

The highest-value output, and almost entirely deterministic (`17` §7):

```
Cluster questions within a subject using the three-tier ladder
(exact → trigram ≥ 0.85 → embedding ≥ 0.88)

For each cluster with member_count ≥ 2:
  years         = distinct years of members
  repeat_count  = |years|
  span          = last_seen_year − first_seen_year
  last_seen     = max(years)
```

Presented as: *"This question has appeared in 2019, 2021 and 2024 — 3 times in 8 papers."* with every member question and its source paper linked.

**No probability is attached.** "Appeared 3 times in 8 papers" is a fact. "37% likely to appear" is a fabrication built by dividing that fact by nothing meaningful.

## 18.6 Scoring and ranking

Where a ranking is shown, the score is transparent and deterministic:

```
score = w₁ × topic_frequency
      + w₂ × normalized_marks_weight
      + w₃ × recency_weight
      + w₄ × repeat_signal

recency_weight = Σ over appearances of 0.85^(current_year − appearance_year), normalised
```

| Property | Requirement |
|---|---|
| Weights | Fixed constants, published in the API response and in this document; not learned, not tuned per user |
| Determinism | The same corpus always yields the same score |
| Explainability | Every component value is returned alongside the score |
| Evidence | `evidence` is a **`NOT NULL`** column (`09` §9.7) — a score cannot physically exist without it |
| Versioning | `method_version` stamped; changing weights creates a new version and recomputes |

Initial weights: `w₁ = 0.35`, `w₂ = 0.20`, `w₃ = 0.20`, `w₄ = 0.25`. These are a **starting judgement, not a validated model**, and they are labelled as such. Any future tuning requires the evaluation in §18.8.

## 18.7 Dormant-topic detection

Syllabus topics with zero matched questions across the corpus.

**Presented with a deliberately strong caveat**, because this is the output most likely to be misused: a student reading "never appeared" as "will not appear" and skipping a topic that then appears is the concrete harm this feature can cause.

> "No question matching this topic was found in the 8 papers we have. Our corpus is incomplete and our matching is imperfect — this does not mean the topic will not appear."

It is shown **last**, in muted styling, never as a "skip these" list. If Stage 2 feedback shows students are using it as a skip list, the feature is removed. That trigger is recorded in `30` as an Alpha cut criterion.

## 18.8 Evaluation methodology

Any claim about quality requires measurement. The methodology, defined before any claim is made:

| Metric | Method | Target |
|---|---|---|
| Extraction accuracy | 20 hand-labelled papers; correct question count and text | ≥ 95% |
| Module mapping accuracy | Same set; correct module per question | ≥ 98% structural, ≥ 80% semantic fallback |
| Topic matching precision | Manual review of 100 matches | ≥ 85% |
| Topic matching recall | Manual review of 50 questions against expected topics | ≥ 70% |
| Repeat detection precision | Manual review of 50 clusters | ≥ 90% |
| Repeat detection recall | Hand-labelled repeat set | ≥ 75% |

**Held-out evaluation for any predictive claim:** if a forward-looking claim is ever made, it must be validated by withholding the most recent paper, computing rankings from the remainder, and measuring against what actually appeared — reported with the sample size and confidence interval.

**Until such an evaluation exists and is published, no forward-looking claim is made at all.** This is the honest position and also the safe one.

**Precision is prioritised over recall** throughout: a wrong "this repeated" claim is worse than a missed one, because the first is a false statement in the product and the second is only an absence.

## 18.9 Presentation rules (binding)

| Rule | Reason |
|---|---|
| Evidence appears **before** the conclusion in visual order | The student judges the data, not just our summary |
| Raw counts always visible ("7 of 8 papers"), never only a percentage or score | A percentage hides the sample size |
| Corpus size and year range always shown | Context for reliability |
| No output at all below 4 papers | Insufficient data is a state, not a caveat |
| No probability language, ever | We have no basis for one |
| Every claim links to the source questions and papers | Verifiable |
| Module frequency shown with its structural explanation | Otherwise 1.0-everywhere is misleading |
| Dormant topics shown last, muted, with a strong caveat | Highest misuse potential |

**Vocabulary** (enforced in `28`):

| Never | Always |
|---|---|
| predicted, will appear, expected in the exam | appeared in N of M papers |
| important questions, must-do | frequently repeated |
| 87% probability | 7 of 8 papers |
| AI-selected, smart picks | ranked by historical frequency |
| guaranteed, sure-shot | based on the papers we have |

## 18.10 Where AI is and is not used

| Task | Method | AI? |
|---|---|---|
| Question extraction | Structural parsing | No |
| Module mapping (standard papers) | **Structural** — the 10-question/2-per-module rule | No |
| Module mapping (non-standard) | Embedding similarity | Yes, fallback only |
| Exact duplicate detection | SHA-256 / text equality | No |
| Near-duplicate detection | Trigram, then embeddings for the ambiguous band | Partly |
| Topic matching | Keyword, then embeddings | Partly |
| Frequency, counts, scores | Arithmetic | **No** |
| Ranking | Fixed-weight formula | **No** |
| Natural-language summaries | Optional LLM, flag-off in Alpha | Yes, cosmetic only |

**Every number a student sees is computed deterministically.** AI contributes to *grouping and matching* — deciding which questions are similar — never to counting, scoring or concluding.

This extends to any academic figure this subsystem displays alongside its analysis. Where a screen shows a CGPA or percentage next to question analysis, that value comes from `packages/academic-rules` resolved against the active `RuleSet` (`16` §8) — the intelligence subsystem never recomputes, caches or approximates an academic figure of its own, which is how the `cgpa_x_10` conversion stays single-sourced. If every AI component were removed, the feature would still work with reduced matching quality and no change to any displayed number's method.

## 18.11 Computation and freshness

Analysis is recomputed by a background job when a subject's paper set changes, not on request — the corpus changes rarely and the computation is not free. Results are stored in `recommendation_scores` with `computed_at` and `method_version`, and the UI shows when the analysis was last computed and over how many papers.

A method-version change triggers full recomputation for affected subjects. Old versions are retained briefly so a regression is detectable by comparison rather than only by complaint.

## 18.12 Future work (explicitly not in Alpha)

| Idea | Why deferred |
|---|---|
| Personalised recommendations from a student's weak subjects | Requires behavioural tracking; needs a fresh privacy decision (`12` §9) |
| Cross-subject topic relationships | Needs a much larger corpus |
| Difficulty estimation | No ground truth available |
| Answer generation | Far outside scope; enormous accuracy liability |
| Study-plan generation | Would need calendar integration and would be advice, not evidence |
| Genuine predictive modelling | Only after the §18.8 evaluation exists, and only stated with measured accuracy |

---

## Status after M5

**Nothing in this document is implemented.** M5 deliberately stops at
deterministic ingestion: document → text → positioned sections. No question
segmentation, no module mapping, no frequency analysis, no embeddings, no
clustering, no recommendations.

The reason is ordering, not scope aversion. Every technique here consumes
extracted question text, and extracted question text does not exist yet — it has
been proven on synthetic fixtures only. Building analysis on an unvalidated
extractor would produce numbers no one could check, which is the failure mode
this document's own evidence requirements exist to prevent.

`document_sections` is the seam these features will read from. A test asserts
sections carry no question or marks fields today, so nothing downstream can
quietly start depending on a guess.
