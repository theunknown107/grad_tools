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
