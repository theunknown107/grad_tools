# 19 — Recommendation and AI Policy

**Status:** Phase 1 draft
**Human decision `DEC-006`:** local embeddings for matching; an optional hosted LLM for explanations only.

---

## 19.1 The governing principle

> **AI is used for language and semantics. It is never the source of truth.**

Everything a student could act on academically — a grade, a GPA, an attendance figure, a required mark, an authorization decision — is produced by deterministic code with a cited rule. AI operates only on the interpretive layer above that: deciding which two questions are similar, which topic a question relates to, and how to phrase an explanation of numbers that were already computed.

If every AI component were switched off, GradTools would lose matching quality and prose polish. It would not lose a single number, and not one screen would become unavailable.

## 19.2 The hard boundary

### AI is PROHIBITED from

| Domain | Why |
|---|---|
| SGPA and CGPA calculation | Deterministic, verified, regulation-cited (`16`) |
| Grade determination from marks | Same |
| Attendance and bunk calculations | Same |
| Marks-needed and target calculations | Same |
| Authorization and access decisions | Non-deterministic authorization is a vulnerability |
| Rate limiting | Explicitly prohibited by the master instruction §9 |
| Input validation | Must be exact and predictable |
| Database integrity and constraints | Must be exact |
| Source authenticity or provenance | Must be verifiable, not inferred |
| Deciding whether data is publishable | Human or deterministic validation only |
| Any number displayed to a student | Every one is computed arithmetically |

**Architecturally enforced, not merely promised:** `packages/academic-rules` has zero dependencies and no network access. There is no code path by which a model could influence a calculation, and adding one would require deliberately breaking the package's dependency rule — which fails a CI check.

### AI is PERMITTED for

| Task | Method | Failure mode | Fallback |
|---|---|---|---|
| Semantic question similarity | Local embeddings (MiniLM) | Wrong grouping | Trigram similarity |
| Question-to-topic mapping | Local embeddings | Wrong topic | Keyword matching; else "unmapped" |
| Question clustering | Embeddings + threshold | Over/under-clustering | Exact and trigram tiers |
| Natural-language explanation of already-computed results | Hosted LLM, optional, flag-off | Wrong or fabricated wording | The deterministic evidence view, which is always sufficient on its own |
| Summarising a set of retrieved questions | Hosted LLM, optional | Hallucination | The question list itself |

Note that the first three are **embeddings**, not generative models: they produce vectors, follow no instructions, and cannot hallucinate a fact. This is why the local-model decision covers the majority of AI use with the lowest risk profile.

## 19.3 Local versus hosted

| | Local embeddings | Hosted LLM |
|---|---|---|
| Model | `all-MiniLM-L6-v2` (ONNX, 384-dim) | Claude API |
| Runs | In the API container | External |
| Used for | Similarity, mapping, clustering | Explanations only |
| Data sent externally | **None** | Question text and syllabus text only |
| Student data involved | **Never** | **Never** |
| Cost | Zero per query | Per token |
| Alpha default | **Enabled** | **Disabled** |
| If unavailable | Deterministic fallbacks | Feature hidden entirely |

**Binding constraint:** no student’s marks, grades, attendance, USN, name or email is ever sent to any AI service, local or hosted. The LLM feature operates exclusively on public academic material — question papers and syllabus content. This is a hard rule, not a configuration default (`12` §8).

## 19.4 Grounding

Any generative output must be grounded in retrieved source material:

```
1  Retrieve the relevant records deterministically (questions, syllabus topics, counts)
2  Build a fixed instruction envelope; source material is inserted as clearly delimited DATA
3  Instruct: use only the provided material; if it is insufficient, say so
4  Generate
5  Validate: does the output reference only entities present in the input?
6  Display alongside the source records, never instead of them
```

Step 6 is the essential one: an AI explanation is always shown **next to** the evidence it describes. A student who distrusts the prose can read the underlying questions and counts, which are the actual product.

**If validation at step 5 fails, the output is discarded and the deterministic view is shown.** No retry loop, no "best effort" prose — the fallback is always fully adequate.

## 19.5 Prompt injection

Question papers and uploaded documents are attacker-controllable text (`13` §T-05).

| Control | Detail |
|---|---|
| Data/instruction separation | Document text is inserted as delimited data with an explicit statement that its content is data, not instructions |
| No privileged actions | The model has no tools, no database write, no ability to call anything |
| Output never executed | Never rendered as HTML, never used in a query, never used as a control-flow value |
| Output never stored as fact | Generated text is display-only; it never becomes a database record without human review |
| Entity validation | Output referencing entities absent from the input is rejected |
| Embeddings are structurally immune | A vector cannot follow an instruction; the primary AI use has no injection surface at all |

**Why this is genuinely contained rather than mitigated:** injection is dangerous when a model has authority to act. Here the model's entire output surface is a paragraph displayed next to the data it describes. The worst achievable outcome is misleading prose beside correct evidence — bad, visible, and non-escalating.

## 19.6 Confidence

Confidence is reported only where it is meaningful.

| Output | Confidence | Meaning |
|---|---|---|
| Embedding similarity | Cosine score | Genuinely meaningful, calibrated by threshold tuning against a labelled set |
| Module mapping | 1.0 structural / 0.9 pattern / <0.7 semantic | Method-derived |
| Extraction | Method-derived | Text layer vs OCR |
| LLM explanation | **None displayed** | An LLM's self-reported confidence is not evidence and would be misleading to show |

The last row is a deliberate refusal. Asking a model how confident it is produces a number with no calibration; displaying it would give students false precision.

## 19.7 Model versioning and reproducibility

Every AI-derived record stores: `method` (embedding/keyword/structural/manual), `method_version` (including the model identifier and revision), and `computed_at`.

Changing a model version triggers recomputation and retains the previous version long enough to detect a regression by comparison. Manual corrections always survive recomputation (`17` §10).

## 19.8 Failure behaviour

| Failure | Response |
|---|---|
| Embedding model fails to load at boot | Log an error, start anyway, fall back to trigram matching. **The API must not fail to start because an optional model is unavailable.** |
| Inference times out | Fall back to trigram; record lower confidence |
| Model produces a degenerate vector | Reject the mapping; mark `needs_review` |
| LLM API unavailable | Hide the explanation feature entirely; no error is shown to the student, because the deterministic view is complete on its own |
| LLM returns unvalidatable output | Discard; show the deterministic view |
| LLM returns something that looks like a calculation | Discard — the model has no business producing numbers |

## 19.9 Cost and scale

Local embeddings: zero marginal cost; a one-off ~90 MB model in the container image; inference over a subject's few hundred questions is milliseconds. Recomputation is triggered by corpus changes, which are rare.

Hosted LLM: disabled in Alpha. If enabled later, it requires a per-day cost cap, an outage circuit breaker, and caching of generated explanations keyed by content hash — an explanation of a fixed set of questions does not change and should be generated once.

**Validation still required:** the memory footprint and cold-start time of the ONNX model in a 512 MB–1 GB container is unmeasured (`06` §6.8). If it exceeds budget, the fallback is a Python sidecar or hosted embeddings, which would reopen `DEC-006` as a privacy decision rather than a purely technical one.

## 19.10 What GradTools will never do with AI

1. Compute or adjust any academic figure.
2. Make an authorization, rate-limiting or validation decision.
3. Assert that a topic or question will appear in a future exam.
4. Send student personal or academic data to any model.
5. Present generated text as a source of fact without the underlying evidence beside it.
6. Use an LLM to parse or validate structured data where a deterministic parser is possible.
7. Let a model's output write to the database without human review.
8. Describe a feature as "AI-powered" as a marketing claim — the product describes what it does, not what technology it uses.

Point 8 matters for the institutional case. "AI-powered exam prediction" is precisely the phrase that would end a conversation with a faculty member; "ranked by frequency across 8 past papers, here they are" is the one that continues it.

## 19.11 Recommendation policy (non-AI)

Recommendations shown to students — module priority, repeated questions, attendance warnings — are deterministic and follow the same disclosure rules:

| Rule | Application |
|---|---|
| Evidence precedes conclusion | Counts and source questions shown before any ranking |
| Sample size always visible | "based on 8 papers" |
| Suppressed below the data threshold | Nothing shown under 4 papers |
| Reversible reasoning | The student can always reach the underlying records |
| No urgency or pressure framing | No countdowns, no "students who studied X scored Y" |
| No comparison to other students | No feature exposes any student to another (`12` §11) |

**Attendance recommendations carry the strongest constraint**, because they can cause direct academic harm: GradTools states the arithmetic and the rule, and never advises a student to skip a class. "You can miss 3 more and stay at 85%" is arithmetic. "You should skip tomorrow" is advice, and GradTools does not give it.
