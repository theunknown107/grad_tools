# 08 — Data Model

**Status:** Phase 1 draft
**Relationship:** this is the conceptual domain model. Physical tables, types, indexes and constraints are in `09_DATABASE_SCHEMA.md`; the two must not diverge.

---

## 8.1 Modelling principles

1. **Academic reference data is versioned; student data is owned.** A scheme's rules change over time and old results must still compute correctly under the rules that applied then.
2. **Provenance is a first-class attribute**, not a log line. Any record derived from an external source carries where it came from, when, by which parser, and whether it validated.
3. **Separate asserted from derived.** What the student typed and what GradTools computed are different columns with different trust levels.
4. **No entity without a current use.** Entities listed in the master instruction that earn no place in Alpha are recorded in §8.9 with the reason.
5. **Minimise identity.** The model is built so that a student with no account still gets full local functionality; server-side personal fields are the exception, not the default.

## 8.2 Domain map

```
                    ┌────────────┐
                    │ University │  (VTU)
                    └─────┬──────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌────────────┐   ┌──────────┐
    │  Scheme  │   │  College   │   │  Branch  │
    │ (2022)   │   │ (pilot)    │   │ (CSE…)   │
    └────┬─────┘   └─────┬──────┘   └────┬─────┘
         │               │               │
         │      ┌────────┴───────┐       │
         │      │ RuleSet        │       │      versioned academic rules
         │      │ (per scheme/   │       │      (grades, thresholds, formulas)
         │      │  college)      │       │
         │      └────────────────┘       │
         └──────────────┬────────────────┘
                        ▼
                 ┌─────────────┐         ┌──────────────┐
                 │   Subject   │────────►│ SyllabusModule│  (5 per subject)
                 │ (code,cred) │         └──────┬───────┘
                 └──────┬──────┘                │
                        │                       │
                        ▼                       ▼
              ┌──────────────────┐      ┌──────────────┐
              │  QuestionPaper   │─────►│   Question   │
              │  (year, session) │      │  (text, marks)│
              └────────┬─────────┘      └──────┬───────┘
                       │                       │
                       ▼                       ▼
                ┌────────────┐         ┌────────────────┐
                │  Document  │         │ QuestionCluster│ (semantic grouping)
                │  (PDF blob)│         └────────────────┘
                └────────────┘

    ┌─────────┐        ┌───────────────┐        ┌──────────────────┐
    │ Student │───────►│ SemesterRecord│───────►│ SemesterSubject  │
    │(optional│        │ (sem, SGPA)   │        │ (CIE,SEE,grade)  │
    │ account)│        └───────┬───────┘        └────────┬─────────┘
    └────┬────┘                │                         │
         │                     └────────────────────────►│
         │                                               ▼
         ├──► AttendanceRecord (per course offering)  ┌────────┐
         ├──► TimetableSlot                           │ Backlog│
         ├──► NotificationSubscription                └────────┘
         ├──► UserPreference
         └──► Session

    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
    │ ExternalSource│──►│ IngestionJob │──►│ ChangeEvent  │──► Announcement
    └──────────────┘    └──────────────┘    └──────────────┘
                                                   │
                              ┌────────────────────┘
                              ▼
                        ┌────────────┐
                        │ AuditRecord│ (all privileged/corrective actions)
                        └────────────┘
```

## 8.3 Reference entities (academic metadata)

### University
Exists to make the model honest about scope rather than to support multi-tenancy today. One row: VTU.
`id, name, short_name, country, created_at`

### Scheme
A regulation version, e.g. "2022 scheme (22OB)". **The anchor for all rule versioning.**
`id, university_id, code ("2022"), regulation_code ("22OB"), name, effective_from, effective_to?, source_url, source_verified_at, notes`

`source_url` and `source_verified_at` are mandatory: every scheme must point at the document its rules came from.

### College
`id, university_id, name, code, is_autonomous, city, active, notes`

`is_autonomous` is present from day one even though only non-autonomous colleges are supported in Alpha (`01` §1.5). An autonomous college's rules differ, and the flag is what makes the rules engine refuse to silently apply VTU defaults to them.

### RuleSet
**The most important reference entity.** A versioned bundle of the academic rules applying to a (scheme, college?) pair. Made explicit so that two schemes cannot silently share calculation logic — a requirement from the master instruction.

```
RuleSet {
  id
  scheme_id
  college_id            NULL = applies to all colleges under the scheme
  version               integer, incremented on any change
  effective_from, effective_to?

  grade_bands           [{ letter, points, min_pct, max_pct }]
  special_grades        [{ letter, points, counts_in_cgpa, meaning }]  // DX, AB, PP, NP, IC, W, AU
  cie_max               50
  cie_min_pct           40      // to be eligible for SEE
  see_max               100
  see_min_pct           35      // to pass the SEE head
  overall_min_pct       40      // to pass the course
  attendance_required_pct        85
  attendance_condonable_pct      10
  attendance_dx_floor_pct        75
  sgpa_formula_id       'credit_weighted_gp'
  cgpa_formula_id       'credit_weighted_sgpa'
  percentage_formula    'cgpa_x_10'
  class_bands           [{ label, min_pct, max_pct }]
  rounding              { dp: 2, mode: 'half_up', stage: 'final_only' }

  source_url, source_clause, verified_at, verified_by
}
```

Every field carries a clause citation in `16_ACADEMIC_RULES_ENGINE.md`. A RuleSet with no `verified_at` **cannot be marked active** — an unverified rule set may exist for drafting but never computes a student-facing number.

### Branch
`id, university_id, code ("CS"), name, active`

### Subject
A course as defined by a scheme, branch and semester.
`id, scheme_id, branch_id, semester, code ("BCS304"), title, credits, category (core|elective|lab|mandatory|non_credit), cie_max, see_max, has_see, module_count, source_url, verified_at`

`cie_max`/`see_max`/`has_see` are per-subject because the regulation permits courses with no SEE, where CIE alone determines the grade (22OB 6.1(3)). A model that assumes 50/50 universally computes labs and mandatory courses wrongly.

### SyllabusModule
`id, subject_id, module_number (1–5), title, topics[], hours, source_url`

Five modules is a structure **commonly encountered** in VTU 2022 materials, and it matches the SEE paper structure described there (two questions per module). It is **not** a property that may be assumed for any individual subject.

`Subject.module_count` is therefore nullable, and `NULL` means **the syllabus structure has not been verified for this subject** — not zero, and not five. A count is written only when a source has been checked for that specific subject. There is no default, and one must not be reintroduced: a default is a guess wearing the clothes of data (`32/ED-31`).

### As built in M5a

Every entity in §8.3 exists in the database. Three refinements the implementation
forced, recorded so the model and the schema do not drift:

- **Provenance is a shared, non-optional shape**, not per-entity fields.
  `source_url`, `source_clause`, `verification`, `verified_at`, `verified_by` and
  `publication` appear on every **verified reference** entity, and the API
  returns them nested under `provenance`. Such a record cannot be inserted
  without provenance. This does **not** extend to internal taxonomy — see
  §8.3.1, added in M4.2 to remove exactly that ambiguity.
- **`verification` is three-valued** (`draft | unverified | verified`), not a
  boolean. `draft` is "not yet reviewed"; `unverified` is "reviewed and the source
  does not support it". Collapsing them would lose the second state, which is the
  one worth acting on.
- **`SyllabusModule.module_number` allows 1–10**, not 1–5. Five is the norm, and
  the model already says `module_count` exists to allow exceptions — a `CHECK`
  fixed at 5 would have contradicted that.

**Corrected in M4.1:** `Subject.module_count` is **nullable**, and NULL means
*the syllabus structure has not been verified*. It previously defaulted to 5, so
every seeded subject asserted five modules while `syllabus_modules` held zero
rows — a default published as though it were a verified fact. NULL is
deliberately not 0: "verified as having no modules" and "unknown" are different
claims, and collapsing them would repeat the error.

**Also corrected in M4.1:** `College` gained the same provenance and publication
fields every other publishable entity carries. It had none, and was served
filtered on `active` alone. Nothing wrong was ever served — the table is empty —
but the schema permitted an unverified college to reach the public API.

**§8.4 is not implemented at all.** No student entity exists in the database, not
even as an empty table, and the integration suite asserts their absence. Student
records live in the browser (`33` §33.3).

### 8.3.1 Two integrity models, and the test that separates them (M4.2)

§8.3 contains entities of two different kinds. Review found the difference was
implied by the schema but never stated, which left it looking like an
inconsistency. It is stated here so future entities are classified deliberately.

**The test:** *does the row make a checkable claim about the external world that
could change a calculation or mislead a student if it were wrong?*

| | Entities | Controls |
|---|---|---|
| **Verified reference data** — yes | `Scheme`, `College`, `RuleSet`, `Subject`, `SyllabusModule` | `source_url`, `source_clause`, `verification`, `verified_at`, `verified_by`, `publication`; publication gated on verification by database CHECK |
| **Internal taxonomy** — no | `University`, `Branch` | `active` alone. **No** provenance or publication columns, deliberately |

**Why `University` and `Branch` are taxonomy.** `universities` holds one row,
VTU, and exists "to make the model honest about scope rather than to support
multi-tenancy" — it is the product's scope anchor, and "VTU is a university" is
not a claim requiring a clause citation. `branches` rows are join keys the
application chose (`cse`); the set of branches in a scheme *is* a verified fact,
but it is carried by `Subject`, which has provenance.

This is not a new decision. `docs/09` §9.4 already gave `source_url` to
`schemes`, `rule_sets`, `subjects` and `syllabus_modules` while giving none to
`universities` and `branches`, in the same code block — a distinction drawn, not
forgotten. `docs/14` §14.10 scopes the provenance invariant to every published
**external** record, and neither of these is ingested from anywhere.

**Why `College` sits on the other side**, despite `docs/09` §9.4 originally
grouping it with the taxonomy tables: a college's name, affiliation and
especially `is_autonomous` are factual claims about a real institution, and
`is_autonomous` decides whether VTU's rules apply at all. A wrong value silently
corrupts every calculation for that college. M4.1 moved it, and this section
records that the move was a reclassification rather than a schema tidy-up.

**What was actually wrong.** Not the missing columns — the queries.
`listUniversities()` applied no filter while `listBranches()` filtered `active`,
so the two halves of the same model disagreed. `universities` had no `active`
column at all. Migration `0003` adds it; both queries now apply it. Inventing a
source URL for "VTU exists" to make the tables look uniform would have been
fabricated provenance, which is worse than none (`docs/14` §14.10).

## 8.4 Student entities

### Student
Exists **only** for account holders. Anonymous users have no row.

```
Student {
  id                    uuid
  email                 unique, required (the only account identifier)
  email_verified_at
  display_name?         nullable
  authUserId?           nullable      — FUTURE (DEC-014). Always null in Stage 1.
                                        The canonical identity, issued by the auth
                                        provider. NEVER usn/email/name/college.
  usn?                  nullable      — DEC-002: stored plaintext by human decision
  college_id?, scheme_id?, branch_id?, current_semester?
  created_at, last_seen_at
  deleted_at            (see `09` §Soft deletes — personal fields are erased, not just flagged)
}
```

**There is no date-of-birth attribute, by decision `DEC-008`.** No approved feature requires it, and the model does not carry fields on speculation. If a future feature genuinely needs it, it returns as a new product decision with its own privacy review — not as a nullable column added quietly.

**Privacy posture (`DEC-002` as amended by `DEC-008`):** server-side storage of USN, name and academic records is accepted for account holders. The compensating controls, which are binding:
- USN and name are only collected when a feature needs them, never during onboarding (`03/UF-02`).
- Neither appears in any log, metric, error report or analytics event.
- Anonymous local-first use remains fully functional without any of these fields.
- `12_PRIVACY_AND_DATA_GOVERNANCE.md` records the option to downgrade USN to a salted hash if a pilot reviewer objects.

### Session
`id, student_id, token_hash (sha256 of an opaque random token), created_at, expires_at, last_used_at, user_agent_hash, revoked_at`

The raw token exists only in the cookie. The database stores a hash, so a database leak does not yield usable sessions.

### SemesterRecord
```
SemesterRecord {
  id, student_id, semester, scheme_id
  sgpa_computed         numeric(4,2)   — derived by the server
  sgpa_asserted?        numeric(4,2)   — what the grade card said, if entered
  total_credits, earned_credits
  provider_key          which ResultProvider produced this ('manual-entry','paste-parse',…)
  authority             enum: student_asserted | official
  parser_version        the provider version that parsed it
  source                enum: manual | pasted_parsed | imported
  rule_set_id           the RuleSet used for computation
  created_at, updated_at
}
```

`sgpa_computed` vs `sgpa_asserted` is a deliberate pair. If they disagree, GradTools shows both and flags the discrepancy rather than picking a winner — a disagreement usually means either our rules are wrong or the entry has a typo, and both are worth surfacing.

`rule_set_id` is stored so that a later rule change never retroactively alters a historical semester.

`provider_key`, `authority` and `parser_version` implement the `ResultProvider` contract (`15` §15.5.1). `authority` is `student_asserted` for every result today. It exists now, rather than being added later, because the UI must be able to distinguish a student-entered figure from an authoritatively-sourced one the moment such a source exists — and retrofitting that distinction onto historical rows would be impossible.

### SemesterSubject
```
SemesterSubject {
  id, semester_record_id
  subject_id?           nullable — links to reference data when recognised
  subject_code, subject_title, credits   — denormalised, because a student may
                                           enter a subject not in our tables
  cie_marks?, see_marks?, total_marks?
  grade_letter, grade_points
  grade_source          enum: derived | user_override
  result_status         enum: pass | fail | absent | dx | incomplete | withdrawn
  attempt_number        default 1
}
```

Denormalised subject fields are intentional: reference data will be incomplete for a long time, and a student must never be blocked from recording their own result because we haven't seeded their subject yet.

### AttendanceRecord
```
AttendanceRecord {
  id, student_id, semester, subject_id?, subject_code, subject_title
  classes_attended, classes_conducted
  threshold_pct         copied from the RuleSet at creation, overridable by the
                        student if their college states a different figure
  updated_at
}
```

Counts, not per-class events, for Alpha. Per-class event logging (`AttendanceEvent`) is deferred: it multiplies write volume and storage for a feature students have not yet asked for. Recorded as a future entity in §8.9.

### Backlog
```
Backlog {
  id, student_id, subject_code, subject_title, credits
  origin_semester, reason enum: failed | attendance_dx | cie_shortfall | absent | incomplete
  attempts, status enum: active | cleared, cleared_in_semester?, cleared_grade?
}
```

`reason` is distinguished because the remedy differs: an attendance DX requires repeating the course, while a CIE shortfall permits fresh CIE registration then SEE (22OB 6.3(7)–(8)).

### TimetableSlot
`id, student_id, day_of_week, start_time, end_time, subject_code, subject_title, room?, slot_type (lecture|lab|tutorial)`

### UserPreference
`student_id, theme, density, notification_prefs (jsonb), quiet_hours_start/end, timezone`

### NotificationSubscription
`id, student_id, endpoint, p256dh, auth, categories[], created_at, last_success_at, failure_count, revoked_at`

Web Push subscription material. `failure_count` drives automatic pruning of dead endpoints.

## 8.5 Content entities

### Document
The stored file, separate from what was extracted from it.
```
Document {
  id, storage_key, sha256, byte_size, page_count, mime_type
  kind enum: question_paper | model_paper | syllabus | circular | other
  origin enum: operator_import | student_upload | source_fetch
  uploaded_by_student_id?     nullable
  status enum: quarantined | validated | published | rejected
  rejection_reason?
  source_url?, retrieved_at?, license_note?
  created_at
}
```

`sha256` gives free deduplication: the same paper uploaded by twenty students stores once.

`license_note` exists because redistribution rights for question papers are genuinely unclear (`32/OQ-008`) and the model must be able to record what is known per document rather than assuming.

### QuestionPaper
The academic identity of a document.
`id, document_id, subject_id?, subject_code, scheme_id?, exam_year, exam_session (jan|feb|jun|jul|aug|dec…), exam_type (see|cie|model), total_marks, verified_by_operator, confidence`

### Question
```
Question {
  id, question_paper_id
  question_number ("1a", "5b")
  parent_number?          for sub-questions
  text, marks?
  module_number?          mapped syllabus module (1–5)
  module_mapping_method   enum: structural | embedding | keyword | manual
  module_mapping_confidence  0..1
  extraction_confidence      0..1
  needs_review            boolean
  embedding?              real[384]
  cluster_id?
}
```

`module_mapping_method` is recorded because VTU SEE papers have a **structural** guarantee — questions 1–2 are module 1, 3–4 module 2, and so on — which is far more reliable than any semantic method. When structure is available it wins, and the model records that it did. See `17` §5.

### QuestionCluster
A group of semantically equivalent questions across years — the evidence for repeat detection.
`id, subject_id, representative_question_id, member_count, first_seen_year, last_seen_year, method, created_at`

Clusters are derived data and can be fully recomputed from questions; they are stored for query speed, never as a source of truth.

### Announcement
`id, change_event_id, external_source_id, title, published_at?, url, category, body_excerpt?, first_seen_at, content_hash`

## 8.6 Ingestion entities

### ExternalSource
```
ExternalSource {
  id, name, base_url, kind enum: announcements | results | syllabus | papers | calendar
  adapter_key                which code module handles it
  enabled                    boolean — default FALSE
  robots_checked_at, robots_allows_path, terms_reviewed_at, terms_note
  poll_interval_seconds, rate_limit_per_hour
  health enum: healthy | degraded | unhealthy | disabled
  consecutive_failures, last_success_at, last_failure_at
  parser_version
  official boolean           — is this an official university source or a third party?
}
```

`enabled` defaults to **false** and `robots_checked_at` must be non-null before a source can be enabled. This makes the legal/ethical gate a data constraint rather than a promise in a document. See `14` §7.

`official` prevents the product from ever describing third-party data as official.

### IngestionJob
`id, external_source_id, started_at, finished_at, status (pending|running|success|failed|skipped), http_status?, bytes?, duration_ms, error_class?, error_message?, parser_version, raw_snapshot_key?, records_found, records_published`

### ChangeEvent
`id, external_source_id, detected_at, previous_hash, current_hash, change_kind (new_item|modified|removed), payload jsonb, validated boolean, published boolean`

The **only** thing that may trigger a notification is a validated, published ChangeEvent.

### Provenance (embedded, not a table)
Every published external record carries: `source_id, source_url, retrieved_at, extraction_method, parser_version, validation_state, content_hash`. Embedded on the record rather than joined, because provenance must survive even if the source row is later removed.

## 8.7 Operational entities

### AuditRecord
`id, actor_type (student|admin|system), actor_id?, action, entity_type, entity_id, before jsonb?, after jsonb?, reason?, ip_hash?, created_at`

Written for: admin corrections, source enable/disable, publish/unpublish, document review decisions, account deletion, role changes. **Not** written for ordinary student CRUD — that would be a surveillance log, contradicting the privacy stance in `12`.

`before`/`after` are redacted of personal fields before storage.

### Job
Generic queue row backing the deferred-Redis decision (`06` §6.3).
`id, kind, payload jsonb, run_after, attempts, max_attempts, locked_at?, locked_by?, status, last_error?, created_at`

### RecommendationScore (derived)
`id, subject_id, module_number, score, evidence jsonb, computed_at, method_version`

`evidence` is mandatory and holds the actual counts driving the score — the UI never shows a score without it (`19`).

## 8.8 Key relationships and cardinality

| Relationship | Cardinality | Notes |
|---|---|---|
| University → Scheme | 1:N | |
| Scheme + College → RuleSet | 1:N versions | Exactly one active per (scheme, college, time) |
| Scheme + Branch + Semester → Subject | 1:N | |
| Subject → SyllabusModule | 1:5 (typically) | |
| Student → SemesterRecord | 1:N | One per semester per student |
| SemesterRecord → SemesterSubject | 1:N | |
| Student → Backlog | 1:N | Derived from SemesterSubject, stored for query speed |
| Document → QuestionPaper | 1:1 | A document is one paper |
| QuestionPaper → Question | 1:N | ~10 questions plus sub-parts |
| Question → QuestionCluster | N:1 | |
| ExternalSource → IngestionJob | 1:N | |
| IngestionJob → ChangeEvent | 1:N | |

## 8.9 Entities considered and deferred

Recorded with reasons, so the omission is a decision rather than an oversight.

| Entity | Status | Reason |
|---|---|---|
| `CourseOffering` (subject × college × academic year × section) | **Deferred** | Alpha has one college and no section-level data. `Subject` + student's semester is sufficient. Adding it now would put an empty join in every academic query. Adopt when multi-college or section timetables arrive. |
| `AttendanceEvent` (per-class) | **Deferred** | Counts satisfy every attendance requirement in `02`. Per-class events multiply writes for an unvalidated feature. Adopt if Stage 2 shows students want per-class history. |
| `Grade` as an entity | **Rejected** | Grades are RuleSet configuration, not a table. Making them rows invites a grade row that disagrees with its scheme's rule set. |
| `DataVersion` as a global entity | **Rejected** | Versioning is per-domain (`RuleSet.version`, `parser_version`, `method_version`). A single global version number would be meaningless. |
| `Notification` (delivered-message log) | **Minimal** | Only delivery attempts and failures are logged, with no message body retained past the announcement itself. A full per-user message archive is unnecessary personal data. |
| `Recommendation` as user-specific | **Deferred** | Alpha recommendations are per-subject and identical for all students (module frequency). Personalised recommendations require behavioural tracking, which needs a fresh privacy decision. |
| `College admin` role | **Deferred** | No college has agreed to a pilot yet. Designing an institutional role hierarchy before an institution exists is speculative. `32/OQ-009`. |

## 8.10 Data classification

Drives retention, encryption, logging and export in `12`.

| Class | Entities/fields | Handling |
|---|---|---|
| **Sensitive personal** | USN, name, email | Never logged, exportable, hard-deletable. Date of birth is **not collected** (`DEC-008`) |
| **Personal academic** | Results, marks, attendance, backlogs, timetable | Never logged, exportable, hard-deletable, never shown to any other user |
| **Pseudonymous** | Session tokens (hashed), IP hashes, push endpoints | Short retention, never joined to academic data in analytics |
| **Public reference** | Schemes, subjects, syllabus, rule sets | Freely readable, cacheable |
| **Public content** | Question papers, announcements | Readable, but subject to the licensing question in `32/OQ-008` |
| **Operational** | Jobs, source health, audit | Operator-only, no personal fields |

---

## 8.11 Source, rights and documents (M5)

Three entities, and one distinction that must not be collapsed.

**PROVENANCE ≠ RIGHTS.** Provenance answers *where did this come from*; rights
answer *may we store, display or redistribute it*. Knowing the first tells you
nothing about the second: a VTU question paper has impeccable provenance and
completely unknown rights. They are separate fields, so attribution can never
quietly stand in for permission.

### Source
The single registry both M5 tracks share. `id, kind, publisher, canonical_url,
authority, access_method, robots_status + checked_at + note, terms_status +
reviewed_at + note, rights_status, verification + verified_at, enabled, health,
consecutive_failures, last_checked_at, parser_version, poll_interval_seconds,
notes`.

Documents and announcements both point here rather than each carrying their own
`source_url` and rights fields.

### Document
`id, source_id?, title, sha256, byte_size, mime_type, page_count, storage_key,
original_filename, state, extraction_status, rights_status,
rights_determined_at, presentation, source_url, license_note, rejection_reason`.

`source_id` is nullable: a student's own upload has provenance (they supplied
it) but no external source row. There is deliberately **no uploader identity
column** — Stage 1 has no accounts, and a test asserts the absence.

`presentation` is the user-visible consequence of the rights answer:
`host | link | private | blocked` (§17.11.1).

### SourceChange
`id, source_id, external_id, change_type, title, item_url, payload_hash,
parser_version, detected_at`. Detection is **recorded, never delivered** —
a test asserts the table has no `notified_at`, `delivered_at` or `recipient`
column, so notification cannot be bolted on without a deliberate schema change.

## 8.12 Extracted question structure (M5A.5)

M5A.4 proved that positional extraction recovers question structure
deterministically (docs/17 §17.16). M5A.5 makes that output durable and
reviewable — the difference between a prototype and academic data anything may
be built on.

```
document
   └── extracted_paper          one run of one parser over one document
         ├── extracted_question         (descriptive papers)
         │     └── extracted_sub_question
         └── extracted_mcq_item         (MCQ papers)
```

### A paper is a RUN, not a description of the document

`ExtractedPaper` does not carry the document's title, hash, rights or
presentation. Those belong to the document, are one join away, and duplicating
them would create two answers to the same question — one of which would go
stale. What the paper carries is what is true of the RUN: which parser, which
version, which source of geometry, what it found.

| Field | Why it is here |
|---|---|
| `documentId` | The only link back. Everything about the file is read through it |
| `paperFormat` | descriptive · mcq · **unknown**. `unknown` is a real outcome and is stored as one |
| `extractionSource` | `native` (the publisher's own typesetting) or `ocr` (our reading of an image) |
| `parserVersion` | Geometry + grouping + structural rules, versioned as one thing |
| `extractionVersion` | Orders the runs for one document. A new parser adds a version |
| `isCurrent` | Which run a reader is shown. Older runs stay queryable |

### Why sub-questions are their own entity

Sub-question identity is what OQ-019a was about, and what positional extraction
actually recovered (3–4 of 15–20 rows flattened → essentially complete on native
text). A record that can be addressed, reviewed and corrected on its own is the
only shape that lets a person fix the one part the parser misread.

### Why MCQ items are a separate entity

An MCQ paper has no modules, no Bloom's level, no CO and no per-question marks —
the format never contained them (docs/17 §17.11d). Giving MCQ items those fields
and leaving them null would invite something downstream to read "missing" where
the truthful answer is "not applicable to this format". The database enforces
the separation through a composite foreign key on `(paper_id, paper_format)`, so
a descriptive question cannot attach to an MCQ paper at all.

### Machine values and human values are different fields

Every machine column is written once and never updated. A person's correction
goes in a `reviewed_*` column beside it, so the effective value is
`COALESCE(reviewed_x, x)` and the original is always still visible. An audit
trail that cannot show what the machine said is not an audit trail.

### THREE CONFIDENCES, THREE FIELDS

| | Question it answers | Where it lives |
|---|---|---|
| OCR confidence | How well did the ENGINE read characters? | `documents.ocr_*` |
| Structural confidence | How much did the GEOMETRY agree? | `*.confidence` |
| Review state | What did a HUMAN conclude? | `*.review_state` |

Any one can be high while the next is low: a crisp scan of a table the parser
misread; a perfectly parsed row whose mathematics is nonsense. Collapsing any
two would let "the OCR was confident" start to read as "this is correct".

## 8.13 The eight-semester degree (M6)

Three student-owned entities, all local.

| Entity | Holds | Why it is separate |
|---|---|---|
| `SemesterRecord` | number 1–8, `planned` / `in_progress` / `completed` | The degree's shape, independent of whether a result exists |
| `SemesterSubject` | code, title, credits, notes | A subject the student is taking NOW — it exists before any grade does |
| `BacklogRecord` | subject, origin semester, status, attempts | A subject not yet cleared, which is not a semester result |

### A student does not start at semester 1

Someone joining in their third year has four semesters behind them and types
them in. Nothing derives status from a date, and the view always shows all
eight — the shape of the degree does not depend on how much has been entered
(M6 §2). A semester with a saved result counts as completed even if no status
was set, so entering four years of history is not also four status changes.

### `SemesterSubject` is not `ResultSubject`

`ResultSubject` is history: what a result card printed, inside a saved result.
`SemesterSubject` is the present: what the student is taking, before any grade
exists. Attendance and the timetable suggest from this list rather than each
keeping their own copy, so a subject is named once (M6 §14, §16).

### `SemesterResult.ruleSetId` — pinned at entry

New in M6. A semester records the rule set it was graded under, so a later
regulation cannot silently re-grade a semester already sat (M6 §6).

Resolution has **three** outcomes, and they are three different claims:

| `ruleSetId` | Resolves? | Outcome | What happens |
|---|---|---|---|
| set | yes | `pinned` | Graded under its own rules. Authoritative |
| `null` | — | `fallback` | No pin exists, so the scheme's active rule set is used, **and the screen says so** |
| set | **no** | `unavailable` | **Nothing is calculated.** No SGPA, no substitute rule set, and the screen names the missing identifier |

**A PIN IS NOT A HINT.** If a record names a rule set this build does not have,
the current one is *not* used — even though it is sitting right there and would
produce a perfectly plausible SGPA. That number would be a semester re-graded
under a regulation it was never sat under, with nothing on screen to say so, and
it is the exact failure pinning exists to prevent.

A semester in the `unavailable` state is excluded from CGPA, percentage, credits
earned and the strong/weak baseline **in full**. Partial inclusion — counting its
credits while refusing to grade it — would imply the record had been processed
when it had not.

### The backlog model has NO exam date

`active` → carried, not re-attempted · `attempted` → sat, result unknown ·
`cleared` → passed.

`attempted` is deliberately not `cleared`. And there is no date field, nor may
one be added: a re-sit date is a university fact that must come from a verified
source, and a student-entered one would look identical on screen and be trusted
the same way (M6 §10).

## 8.14 The announcement (M7)

An announcement is a piece of published information with **provenance attached**
— it records not only what was said but where it came from, who vouched for it,
and when it was last seen unchanged.

| Field | Meaning |
|---|---|
| `origin` | `external_source` \| `operator_entry` \| `demo_fixture`. The only honest answer to "where did this come from" |
| `source_id` | The registry source it was fetched from. `NULL` for an operator entry — inventing a source row would put a fetch target in the registry that nobody fetches |
| `publisher` | Who issued the notice, as text. Required on every record, including operator entries |
| `external_id` | The source's own identifier, when it has one |
| `content_hash` | SHA-256 over the *normalised* title, body, category, link and dates |
| `verification` | `draft` \| `verified`. A record is invisible to students until this is `verified` |
| `publication` | `unpublished` \| `published`. Gated by verification in a database CHECK, not in application code |
| `first_seen_at` / `last_seen_at` | When it appeared and when it was last confirmed still there |
| `normalizer_version` | Which normalisation produced this record, so a later correction is identifiable |

### Identity and deduplication

Two identities, tried in order:

1. `(source_id, external_id)` — when the source names its own items, that name wins.
2. `(source_id, content_hash)` — when it does not, the content is the identity.

Both are partial unique indexes rather than application checks, so a concurrent
re-fetch cannot produce two rows for one notice.

**The hash covers normalised fields only.** Re-fetching a page whose whitespace
or markup changed is not a new notice. A changed title, body, category, link or
date is, which is exactly when an update should be recorded.

**The audience is excluded from the hash.** Re-targeting an existing notice is
an operator correction, not a new announcement.

### When content changes, verification is withdrawn

An updated announcement returns to `draft` / `unpublished`, and `verified_at`
is cleared. Someone vouched for the text that was there; they did not vouch for
whatever replaced it. The alternative — keeping the "verified" mark across an
edit — would let a source silently change the content of a notice a human had
already approved.

### Audience: two columns per axis, on purpose

| Axis | Stored as |
|---|---|
| Scheme | `scheme_id` (FK) |
| Branch | `branch_id` (FK) **and** `branch_name` (text) |
| College | `college_id` (FK) **and** `college_name` (text) |
| Semester | `semester` (int) |

The ids give referential integrity. The names exist because **the student
profile stores names, not ids** (§8.13), and matching happens in the browser
against the profile — so the name has to travel with the announcement or
relevance could not be computed without asking the server who the student is.

**A NULL axis means "not targeted on that axis", never "unknown".**

## 8.15 Notification state (M7, local only)

A notification is **not stored**. It is derived, per device, at read time:

```
notification = announcement  ×  local record  ×  relevance  ×  priority
```

The only persisted part is a small local record per announcement:

| Field | Meaning |
|---|---|
| `announcementId` | Which announcement |
| `state` | `read` \| `dismissed` |
| `seenUpdatedAt` | The `updatedAt` this device has acknowledged |

Rules that follow from this shape:

- **A read announcement whose content later changes becomes unread again** — the
  acknowledged `updatedAt` no longer matches. A student who read "the exam is on
  the 4th" should not silently keep a read mark when it becomes the 11th.
- **A dismissed announcement stays dismissed across updates.** Dismissal is a
  decision about the notice, not about its current wording.
- **One record per announcement id**, replaced rather than appended, so the store
  cannot grow with every mark-as-read.

Nothing here reaches the server, and there is no server-side notification table
to reach.

## 8.16 A question paper is a document (M8)

No new entity. `documents` gained the two things a library needs and nothing
else.

### The kind

| Column | Meaning |
|---|---|
| `document_kind` | `question_paper`, `syllabus`, `other`, `unknown` |

`documents` was always generic — the source registry knows about question
papers, syllabus documents and results alike — so the library needs to know
which is which. **The default is `unknown`, not `question_paper`.** Every
document that exists today happens to be a question paper, and defaulting to
that would have written a guess into data. An unknown kind is invisible to the
library, which is the safe direction: a paper missing from a list is a smaller
error than a syllabus presented as an examination paper.

### The taxonomy, stated exactly once

Two possible homes, and a CHECK keeps them mutually exclusive:

| When | Where the taxonomy comes from |
|---|---|
| The subject is in the catalogue | `subject_id` → `subjects`, which carries scheme, branch, semester, code and title |
| The subject is not | `subject_code`, `scheme_id`, `branch_id`, `semester` on the document itself |

The catalogue is deliberately incomplete — syllabus content is entered only
where a verified source exists (`OQ-016`, `OQ-025`) — so a real paper for a
subject nobody has transcribed must still be findable. Without the loose
columns such a paper would have to either invent a subject row or carry no
taxonomy at all.

If both could be set they could disagree, and "which semester is this paper
for" would have two answers with nothing to decide between them. Hence
`document_subject_is_stated_once`.

### The sitting

| Column | Meaning |
|---|---|
| `exam_year` | The calendar year printed on the paper |
| `exam_session` | The sitting as the publisher labels it |

**Neither is ever inferred.** `BCS403-2024.pdf` is a claim by whoever named the
file, not a fact about the paper, and a wrong year sends a student to revise the
wrong sitting. The year stays null until a human or a source states it (M8 §7).

`exam_session` is free text rather than an enum because VTU labels sittings
inconsistently — "June/July 2024", "Model Question Paper", "Supplementary" —
and an enum would force every unanticipated label into a wrong bucket.

### Rights are still not provenance

Unchanged and load-bearing (M8 §6):

| Question | Field |
|---|---|
| Where did this come from? | `source_id`, `source_url` — **provenance** |
| May GradTools redistribute it? | `rights_status`, `presentation` — **rights** |

A paper can have excellent provenance and unknown rights. `source_url IS NOT
NULL` never implies `presentation = 'host'`, and no code path treats it as
though it did.

## 8.17 The student cloud (M9)

The local domain types are unchanged. What M9 adds is a cloud representation of
the same entities, plus the metadata that makes syncing them safe.

### Identity is not the profile

```
Supabase Auth user ──► auth_user_id ──► student_profile ──► academic records
```

They are 1:1 and **separate entities** (docs/11 §11.10a), which is what lets an
email change, a provider switch or a provider link happen without touching a
single academic record. `auth_user_id` is the only identity key; never email,
never USN, never name (M9 §7, §12).

### What syncs, and what deliberately does not

| Synced | Not synced |
|---|---|
| Profile, semesters, semester subjects, results, attendance, timetable, backlogs | Notification read state and preferences — per-device by design (§8.15) |
| | Anything derived: SGPA, CGPA, attendance percentages |
| | UI state, cached reference data |

**No computed value is ever stored or accepted from a device** (M9 §29, §30).
`sgpa_asserted` is what the grade card says — a fact the student read off a
document. The computed figure is derived on read by `@gradtools/academic-rules`
from the subjects and the pinned rule set. Storing a client's arithmetic would
create a second engine that disagrees with the first.

### Sync metadata

Every synced row carries three extra columns:

| Column | Why |
|---|---|
| `revision` | Bumped by a database trigger on every write. A client sends the revision it read; a mismatch is a **conflict**, not an overwrite |
| `updated_at` | The pull cursor. Set by the database, never by a device |
| `deleted_at` | A **tombstone**. A row that simply vanished is indistinguishable from one the other device has not seen yet, and would be resurrected on the next pull |

**Timestamps alone cannot detect conflicts.** Two devices with skewed clocks
produce a confident, wrong winner — and for an attendance counter that means a
number silently going backwards.

### Attendance is the hard case

Counts, not events (§8.9). Two devices editing the same subject produce two
absolute states, not two increments: they cannot be added (that double-counts)
and cannot be reconciled by timestamp (a stale device would erase a newer
count). So attendance conflicts are **detected and shown to the student**
(M9 §28).

### Still no date of birth, and USN is still optional

`DEC-008` holds. No feature requires a USN, so nothing makes it mandatory, and
nothing joins on it (M9 §33).

## 8.18 Result subjects sync as their own records (M9.1)

M9 shipped a defect: `result_subjects` existed in the schema and was **not a
synced collection**. A semester result could reach the cloud while the codes,
credits and grades it is made of could not.

That is worse than it sounds. A second device would have shown a result with no
subjects in it — which does not read as missing data, it reads as a record of a
semester in which nothing was taken, and the SGPA derived from it would have
been derived from nothing.

### Nested locally, separate in the cloud

| | Shape |
|---|---|
| Local (`SemesterResult`) | One object with a `subjects` array inside it — how the results screen reads and edits them |
| Cloud (`result_subjects`) | One row per subject, each with its own `revision` |

**Neither side changed shape to suit the other.** The array is flattened on the
way up and reassembled on the way down, in the sync layer alone.

The reason for separate rows: two devices editing *different* subjects of the
same result are not in conflict. Nesting them would give the whole result one
revision and make every such edit look like a collision.

### The ownership invariant

A subject row belongs to the same student as its result, **by construction**:

```
result_subjects (result_id, auth_user_id)
  → semester_results (id, auth_user_id)
```

A composite foreign key, so the database refuses a subject row attached to
another student's result on every write (docs/09 §9.19). RLS would already have
hidden the parent, but "you cannot see it" is a weaker statement than "it cannot
exist".

`result_id` is therefore the one parent a client supplies. Every other
collection's parent is filled in by the server from the session's profile.

## 8.20 Subject identity (M10A.1)

### The code is the identity. The title is not.

The five real artifacts settle this. The same code is printed with different
wording depending on who printed it:

| Code | Timetable | Result card |
|---|---|---|
| `BMATS101` | Mathematics-I for CSE Stream | MATHEMATICS FOR CSE STREAM-I |
| `BPHYS102` | Applied Physics for CSE stream | PHYSICS FOR CSE STREAM |

The second row is the one that decides the design. **No comparison of names**
— case-folded, token-sorted, edit-distance or otherwise — joins "Applied
Physics for CSE stream" to "PHYSICS FOR CSE STREAM" while still keeping
"Mathematics-I" apart from "Mathematics-II". A matcher loose enough for the
first is loose enough to merge the second.

The college timetable adds a third naming layer: the grid cells carry **subject
initials** (`MAT`, `PHY`, `POP`), not codes, and the code appears only in the
legend below. So one subject can legitimately be written three ways on a single
sheet of paper.

### No new stored entity, and no migration

Every student collection **already** keys on the code — results, attendance,
timetable slots, backlogs, planned subjects — as do question-paper documents.
Nothing duplicated identity. What was missing was somewhere to see that they
are the same subject, and one answer for what to call it on a given screen.

That is a read-time question, so `apps/web/src/domain/subjects.ts` answers it at
read time: a pure index built from records the app already holds. No table, no
migration, no sync collection, and nothing new for a device to be offline from.

```
subjectKey(code)   trim, remove inner whitespace, upper-case. Nothing else.
SubjectIdentity    code · canonicalTitle | null · titles[] · credits | null
                   hasSee | null · semesters[] · sources[]
```

`subjectKey` performs **two transformations and no others**. A VTU code contains
no spaces, so `"bcs 301"` and `"BCS301"` are one code typed two ways. There is
no edit distance, no prefix matching and no stripping of trailing letters:
`BESCK104B` and `BESCK104C` are two different electives, and a rule that folded
the suffix would merge subjects a student really took separately.

### Every wording is kept, and attributed

A title is never corrected and never discarded. Each sighting records the source
that used it, and a screen asks for the wording appropriate to it:

1. this source's own title
2. the verified catalogue's title
3. any other source's title
4. the code itself

The catalogue is **second, not first**. It is the most authoritative wording and
the least familiar one; overriding what a student's own result card says would
make the screen harder to check against the paper in their hand, and §8.19's
rule against overwriting source text applies to titles as much as to marks.

Step 4 returns the code, which is honest: a subject with no known name is better
shown as its code than as an empty cell. This is the timetable's ordinary case —
a `TimetableSlot` stores a code and no title at all.

### The canonical title is usually unknown, and that is correct

`canonicalTitle` is non-null **only** when a verified catalogue row supplies it.
Where two catalogue rows for one code disagree — uniqueness is
`(scheme_id, branch_id, code)`, so one code can carry two rows across branches —
it stays null and both wordings are kept. Picking one would invent an answer the
reference data does not give.

Reference `credits` and `hasSee` come from the catalogue, or from a result row
whose `provenance` is `catalogue`. A **hand-typed** credit stays a fact about
the row it was typed into: promoting it would spread one student's guess across
four other screens.

## 8.x What five real academic artifacts showed the model

Structures observed. **No values from the artifacts are reproduced here or in
any fixture** — they carry a real seat number, student name and staff phone
numbers (docs/12, docs/30).

### Results

| Printed | In `ResultSubject` |
|---|---|
| Subject code | ✅ `subjectCode` |
| Subject name | ✅ `subjectTitle` |
| Internal marks | ✅ `internal` |
| External marks | ✅ `external` |
| Total | ✅ `total`, as printed |
| Result status (P/F/A/W/X/NE) | ✅ `resultStatus`, verbatim |
| Announced / updated on | ✅ `announcedOn` |
| — *not printed* — | ○ `gradeLetter`, nullable |
| — *not printed* — | ○ `gradePoint`, nullable |
| — *not printed* — | ○ `credits`, nullable, from the catalogue |
| — *not printed, not inferable* — | ○ `hasSee`, three-valued |

**Closed by OQ-049.** The model previously required two fields a provisional
result does not print and could store none of the five it does, so a student
copying a real card had to invent a grade before anything would save.

Every source field now holds what the card printed and **stays null where the
card is silent**. Null is not a placeholder for a value someone should fill in
later: a credit of `0` says the course carries no weight, a grade of `F` says
the student failed, and neither is what a silent card means.

`hasSee` is the field that cannot be derived from any other. An external of `0`
is equally consistent with *"this course has no semester-end examination"* and
*"sat the SEE and scored nothing"*, and those have opposite outcomes
(`DEC-037`) — so it is three-valued, and unknown propagates to a backlog state
of "not known" rather than to a guess in either direction.

### Source and computed are separate values, always

Nothing writes a calculated figure onto a `ResultSubject`. `domain/results.ts`
returns a `SubjectEvaluation` alongside the row — the total the columns imply,
the grade the rule set implies, the grade point, the three passing heads and
the backlog state — and the screen shows the two side by side, labelled.

Two consequences worth stating, because both are deliberate refusals:

- **A total that does not add up is refused, never repaired.** Where internal,
  external and total are all present the columns must agree; a row that has
  been mistyped or misread makes every figure derived from it wrong. Where one
  side is missing there is nothing to disagree with, and the other side is not
  demanded — that would be demanding a number the card may not have printed.
- **An SGPA needs every subject, or none.** SGPA is credit-weighted across the
  whole semester, so grading the six subjects that carry grades and ignoring
  the three that do not produces a plausible number that is not the student's
  SGPA. `sgpaInputs` reports which rows held it back, so the answer on screen
  is what to finish rather than that the figure is simply unavailable.

### Subject identity is the code, not the name

The same subject appears in both a college timetable and a VTU result with the
**same code and different names** — "Mathematics-I for CSE Stream" against
"MATHEMATICS FOR CSE STREAM-I". Subject identity must key on the code
(docs/16 §8), and a name must never be a join key.

### Subject load varies

Semester 1 carried **8** subjects; Semester 4 carried **9**, including a
laboratory (`…L4…`), two letter-suffixed electives, a common course and a
CIE-only Physical Education course. Nothing in the app assumes a count — every
result renders from `result.subjects` — and a parameterised test now covers both
8 and 9 so a future layout cannot introduce a fixed grid.

### A timetable is a schedule, not academic identity

Two revisions of the same college timetable, R1 and R2:

| Unchanged | Changed |
|---|---|
| 8 subjects, their codes, their L+T+P | Revision marker R1 → R2 |
| Grid content and batches | **`W.E.F` effective date added** |
| Room | Time slots (a late contact hour dropped, lunch lengthened) |
| | One subject's faculty and contact number |

A revision changes the schedule and never the subject. Also observed: the
timetable carries **two different L+T+P values per subject** — the college's
hours/week and "as per VTU scheme" — and they disagree for several subjects.
A single authoritative L+T+P would be wrong.

### One exam timetable spans several schemes and semesters

The VTU draft timetable covers **2022 Scheme III & IV** and **2021 Scheme V &
VI** in one artifact, with **exam time a property of the (scheme, semester)
column**, not of the date row — III/IV sit 2.00–5.00pm, V/VI sit 9.30–12.30pm.

Two further properties any future model must respect:

- Cells hold **patterns, not codes**: `B**301`, `21**51`, `B**456*`. `B**301`
  is not a subject id and must never be stored as one.
- The document is a **draft**. Its status is part of its provenance.
