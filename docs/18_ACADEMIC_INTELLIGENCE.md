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

> **M5A.7 UPDATE — the text defect is fixed, so the filter advice changes.**
> Parser v2 no longer truncates question text at the marks column (docs/17
> §17.19), which was the cause of most `high`-confidence corrections in M5A.6.
>
> **This does NOT retroactively validate `high`.** The 50%-accepted figure was
> measured on v1 output; v2 has not been adjudicated at all. Until it is, the
> honest filter for anything reading question TEXT is unchanged:
> `review_state IN ('accepted','corrected')`.
>
> What v2 does change is which records are worth reviewing. Question numbers on
> a centred-number layout went from 1 to 10 of 10, and `1BPHYS102` went from 15
> numberless fragments to 5 correctly numbered questions — so the structural
> spine that later analysis hangs on is materially better, on that sample.

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

## 18.9 Deterministic subject analytics (M6)

The first analytics in GradTools that a student actually sees — and **none of
it is AI**. Every classification is a rule printed on the same screen, so it can
be applied by hand and disagreed with.

### Subject trend

A direction is reported **only where there is something to compare**: a subject
that appears in more than one completed semester, which in a degree means it was
carried and re-sat. A subject taken once is labelled "Taken once", not
"unchanged" — a single point is not a flat line (M6 §8).

### Strong and weak subjects

```
mean    = the student's own mean grade point across every graded subject
strong  = grade point >= mean + 1
weak    = grade point <= mean - 1
typical = everything between
```

One grade point is exactly one letter band on VTU's ten-point scale, so the rule
reads as "a whole grade above or below your own average".

**Not a percentile** (M6 §9). A percentile ranks a student against nothing but
themselves in a way that always produces a loser: it would call the bottom of a
uniformly excellent set "weak". Distance from the student's own average produces
**no classification at all** when performance is even, which is the honest
answer in that case, and a test pins it.

**Below five graded subjects nothing is classified.** The screen says "Not
enough history yet" and names the number needed. A first-semester student must
not be told what they are bad at on the strength of two grades.

### Graduation progress

Credits earned and semesters completed are real and always shown. **Credits
remaining is not invented.** No verified total exists for a scheme in this
build, so the screen says exactly that rather than putting a fabricated
denominator under a real numerator (M6 §13).

### What is deliberately absent

No projection of a semester still running. No predicted SGPA. No explanation of
*why* a subject went badly — GradTools does not know, and inventing a reason
would be the least defensible sentence in the product.

## 18.10 M8 is not an intelligence milestone

The question-paper library is **deterministic and lexical throughout** (M8 §3,
§46). Nothing in it uses a model.

| Not built in M8 | |
|---|---|
| Semantic search | Search is a case-insensitive substring match over the code, title, sitting and year (§10.15) |
| Embeddings, similarity, clustering | None. No vector is computed or stored |
| Topic classification | Category comes from the source or an operator, never from a classifier |
| Repeated-question analysis, prediction, "important questions" | Absent. Nothing in the interface ranks a paper by importance, usefulness or likelihood |
| AI summaries or recommendations | None |

The ordering a student sees is: their own semester first, then whatever order
they asked the server for. That is the whole of it, and the sort control offers
no option that claims importance — asserted by a test, so a later convenience
cannot quietly add one.

**What M8 does provide the intelligence milestone** is the surface it would need
to be visible on: a paper has a page, that page has a place for structure, and
the distinction between "structural" and "semantically verified" is already
written into the copy. Building on it still requires the corpus ground truth
`OQ-031` describes.

## 18.x M10B — what the corpus actually supports

### The measurement came first

`services/api/scripts/measure-question-similarity.ts` runs against the local
corpus, which stays gitignored. Its output decided everything below.

| | |
|---|---|
| Questions in the **current** extractions | 126 |
| …with text that tokenises to anything usable | **60** |
| …with empty extracted text | **65** |
| Low structural confidence | 59 |
| Carrying reviewed text | **0** |
| Exact normalised duplicate groups | **0** |
| Pairs at Jaccard ≥ 0.30, out of 1,770 | **0** |

### Why zero is not a verdict on the method

The nine current papers are **nine different subjects from one sitting**
(June/July 2024): BESC104C, BMATC101, BPHYS102, BCHEM102, BCIVC103, BCY358A,
BENGK106, BKSKK107, BMATS101. No subject appears twice, so **no question in this
corpus can repeat**. Repetition is not rare here; it is structurally
unobservable.

Two of the nine (BENGK106, BKSKK107 — the language papers) produced **zero
questions** at all.

That has three consequences, and they are the substance of M10B:

1. **Similarity and repetition cannot be evaluated on this corpus.** Reporting
   an accuracy figure would be a fiction, and there is no labelled ground truth
   either — the 71 historical adjudications were agent-made, not human (§44).
2. **Neither may be shipped as a student feature.** "Found in 0 papers" on every
   question would state something about VTU exams that is actually a fact about
   a nine-paper corpus.
3. **Embeddings cannot be justified.** Deterministic matching has not been shown
   insufficient — it has not been *testable*.

### Normalisation, versioned

`question-normalization-v1` produces a **matching key, never a corrected
question**. Machine text and reviewed text stay exactly as the parser and the
reviewer left them.

| Does | Does not |
|---|---|
| Collapses newlines, tabs, repeated spaces | Repair equations |
| Folds typographic quotes, dashes, ellipsis, exotic spaces | Correct spelling |
| Closes space before punctuation, after an opening bracket | Close space *after* a comma — that would join words OCR split |
| Collapses runs of `- _ = * ~` | Collapse runs of `.` — that destroys an ellipsis |
| Strips C0/C1 controls, zero-width joiners, bidi overrides | Strip markup — that is escaped at render, not removed here |
| Lowercases, last | Touch operators, digits, units, question numbering |

Two defects were caught by test rather than by review:

- Including `.` in the run-collapse turned an ellipsis into a single dot,
  because the `…` fold runs first.
- Tokenising on `\p{L}\p{N}` **shatters Kannada**: its vowels are combining
  marks, not letters, so a word became fragments and the single-character filter
  discarded most of them. `\p{M}` is now in the class (§22).

### Duplicate semantics are three things, kept apart (§12)

`EXACT / NEAR-EXACT REPEAT`, `SIMILAR QUESTION` and `SAME TOPIC` are not
collapsed. Jaccard is length-sensitive by design, so a short question contained
in a long one scores **low** — containment is not equality. Tests pin a
same-topic pair below 0.5 and a re-typeset repeat at 1.0.

**No thresholds are shipped as product behaviour**, because the corpus cannot
validate one. The method is a tested library capability awaiting a corpus with
two sittings of one subject.

### Search is what shipped

`GET /api/v1/questions/search` — deterministic ILIKE over the **effective** text
(reviewed where one exists, machine otherwise), with filters for subject,
semester, year, module, marks, format and review state.

- **Library visibility**, identical to the paper listing. A question from a
  private, blocked or unvalidated document is absent, not forbidden (§42).
- **Current extraction only.** Both parser versions coexist; searching across
  them would return a question twice and let a superseded record answer for
  today's (§24).
- **Bounded**: capped limit, capped search length, capped offset, and an ordering
  ending in the row id so paging cannot duplicate or drop.
- **No student context.** No profile, semester or account is sent; relevance is
  decided on the device (§42).

### No prediction, anywhere (§14)

Nothing counts occurrences, ranks importance or suggests what an exam will
contain. Frequency is historical evidence and would not license a forecast even
if the corpus could produce one.

## 18.y The AI decision gate (M10B §62)

| Question | Answer |
|---|---|
| 1. Is deterministic search sufficient? | **Yes.** 60 usable questions; ILIKE with structured filters answers "where has this been asked" |
| 2. Is deterministic similarity sufficient? | **Unknown, and unknowable on this corpus.** Zero repeats are possible in it |
| 3. Are embeddings justified? | **No.** Nothing has shown deterministic matching failing |
| 4. Would local embeddings materially improve the product? | **No evidence either way.** They would find semantic neighbours among 60 questions across nine unrelated subjects — neighbours a student has no use for |
| 5. Memory cost | A MiniLM-class model is ~90 MB of weights plus runtime. Not measured, because measuring the cost of something unjustified is theatre |
| 6. Latency cost | Not measured, same reason |
| 7. Quality evidence | **None exists.** No labelled ground truth; the 71 historical adjudications were agent-made (§44) |
| 8. Privacy | A local model keeps data on device; a hosted API would send question text to a third party and is prohibited (§3, §28) |
| 9. What stays deterministic | Normalisation, search, filtering, duplicate detection, and every academic calculation — permanently |

**RECOMMENDATION: D — AI not yet justified.**

The blocker is not model quality. It is that **the corpus cannot pose the
question**. What would change this is not a better method but more papers: two
or more sittings of the same subject, and OCR that produces text for more than
half the questions it processes.

Until then, adding embeddings would mean building a semantic index over 60
questions, of which none can repeat, to find similarities nobody can validate.

## 18.z M10B.1 — corpus reconciliation, and a parser regression it exposed

### The counts now partition exactly

M10B reported "126 current questions, 60 usable, 65 empty", which sums to 125.
The categories were incompatible, not the data: **"usable" was measured after
tokenising and "empty" was measured on string length**, so a record with text
that tokenises to nothing belonged to neither.

Definitions, now mathematically unambiguous over the **current** extractions:

| Category | Definition | Count |
|---|---|---|
| **A — empty** | `btrim(effective_text) = ''` | **65** |
| **B — tokenisable** | non-empty and `tokenize(normalize(text))` yields ≥ 1 token | **60** |
| **C — non-empty but untokenisable** | non-empty and yields 0 tokens | **1** |
| | **A + B + C** | **126** |

The single category-C record is:

```
"'* 7 / - ' / 7 7"
```

Quotes, digits and slashes. The tokeniser drops single characters as OCR debris,
and nothing here is longer than one character, so it survives as text and
vanishes as tokens. It is a real parser output, not a defect in the count.

### Where the 65 empties actually are

| Extraction source (current) | Questions | Empty |
|---|---|---|
| native | 42 | **42 (100%)** |
| ocr | 84 | 23 |

**Every question from every native paper's current extraction has empty text.**
Their superseded `positional-v1` extractions do not:

| Paper | v2 (current) | v1 (superseded) |
|---|---|---|
| BESC104C | 22 questions, **0 with text** | 20 questions, 20 with text |
| BMATC101 | 10 questions, **0 with text** | 12 questions, 12 with text |
| BPHYS102 | 10 questions, **0 with text** | 21 questions, 21 with text |

`positional-v2` finds the structure on a native PDF — ordinals, modules, marks,
bounding boxes — and captures **no text**. This is an extraction defect, not a
search defect, and it is why question search returns OCR results only. Recorded
as `OQ-047`. **Not fixed here**: M10B.1 §1 forbids touching the parser.

### Consistency check

| | |
|---|---|
| Current extractions | 9 papers (of 18; the other 9 are superseded v1) |
| Questions on current extractions | 126 |
| With reviewed text | **0** |
| Low structural confidence | 59 of 126 — and **46 of the 60 tokenisable** |
| Searchable in the verification database | **47** |

Confidence is *worse* among usable records than overall, because an empty
extraction often carries `high` confidence: the parser was confident about the
box it found, and the box was empty. **A parser-created record is a
parser-created record, not a question.**

## 18.aa M10B.2 — search reads sub-questions

### The fix

`searchQuestions` now unions two record types into one result shape:

| | Question number | Module | Marks | Text |
|---|---|---|---|---|
| Parent question | `q.question_number` | own | own | own |
| Sub-question | `1(a)` — parent's number + label | **parent's** | own | own |

A sub-question has no module of its own; module is a property of the question it
belongs to. Marks and text are its own.

**Concatenation was rejected.** Synthesising `Q1 = a + b + c` would produce text
that exists in no record — the same invention the normaliser and the extractor
both refuse to make. A part is its own result, named so a reader can see which
question it belongs to.

**MCQ items are still excluded.** A different record shape with different
semantics; merging it here would collapse a distinction M10B §20 keeps.

**Labels are never invented.** A part whose label the parser could not read is
`1(?)`, never a fabricated `1(c)` (M10B §19).

### What it changed, measured

| | Before | After |
|---|---|---|
| Searchable records (verification DB) | **47** | **188** |
| Native questions searchable | **0** | **107** |
| Papers with any searchable question | 3 of 9 | 6 of 9 |

### Post-fix reconciliation

| | |
|---|---|
| Current questions | 126 = 42 native + 84 ocr |
| native: non-empty / empty | 0 / 42 |
| ocr: non-empty / empty | 61 / 23 |
| Current sub-questions | 141 = 107 native + 34 ocr, **all non-empty** |
| Visible non-empty questions | 47 |
| Visible non-empty sub-questions | 141 |
| **Total searchable** | **188** — matches the API exactly |

Empty parent questions are still excluded, and that is correct: an empty
container is not a question a student can search for. **A parser-created record
is still only a parser-created record.**
