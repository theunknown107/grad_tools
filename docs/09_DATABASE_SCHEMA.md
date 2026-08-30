# 09 — Database Schema (PostgreSQL)

**Status:** Phase 1 draft — design only, **no migrations are created in Phase 1**
**Implements:** `08_DATA_MODEL.md`. Every entity there maps to a table here; deviations are noted inline.
**Target:** PostgreSQL 16, managed hosting, `drizzle-orm` + `drizzle-kit`.

---

## 9.1 Conventions

| Convention | Rule |
|---|---|
| Naming | `snake_case`, plural table names |
| Primary keys | `uuid` default `gen_random_uuid()` (pgcrypto). Reference tables use `text` natural keys where genuinely stable (scheme codes, branch codes) |
| Public identifiers | Never expose sequential integers; UUIDs or nanoid slugs |
| Timestamps | `timestamptz`, always UTC. `created_at` default `now()`; `updated_at` maintained by trigger |
| Money/marks | `numeric`, never `float`. GPA `numeric(4,2)`, marks `numeric(5,2)` |
| Enums | Postgres `ENUM` types for closed, stable sets; `text` + `CHECK` where values may grow |
| Deletes | See §9.9 |
| JSON | `jsonb` only, always with a documented shape and, where practical, a `CHECK` |
| Text | `text` with `CHECK (length(...) <= n)` rather than `varchar(n)` |

## 9.2 Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search on subject/question text
-- pgvector: NOT installed initially (see 06 §6.3). Adopted when the measured
-- trigger is hit; embeddings live in real[] until then.
```

## 9.3 Enum types

```sql
CREATE TYPE subject_category   AS ENUM ('core','elective','lab','mandatory','non_credit','project','internship');
CREATE TYPE result_status      AS ENUM ('pass','fail','absent','dx','incomplete','withdrawn','not_applicable');
CREATE TYPE grade_source       AS ENUM ('derived','user_override');
CREATE TYPE record_source      AS ENUM ('manual','pasted_parsed','imported');
CREATE TYPE result_authority   AS ENUM ('student_asserted','official');
CREATE TYPE backlog_reason     AS ENUM ('failed','attendance_dx','cie_shortfall','absent','incomplete');
CREATE TYPE backlog_status     AS ENUM ('active','cleared');
CREATE TYPE document_kind      AS ENUM ('question_paper','model_paper','syllabus','circular','other');
CREATE TYPE document_origin    AS ENUM ('operator_import','student_upload','source_fetch');
CREATE TYPE document_status    AS ENUM ('quarantined','validated','published','rejected');
CREATE TYPE publication_tier   AS ENUM ('private','public');
CREATE TYPE source_kind        AS ENUM ('announcements','results','syllabus','papers','calendar');
CREATE TYPE source_health      AS ENUM ('healthy','degraded','unhealthy','disabled');
CREATE TYPE job_status         AS ENUM ('pending','running','success','failed','skipped');
CREATE TYPE change_kind        AS ENUM ('new_item','modified','removed');
CREATE TYPE mapping_method     AS ENUM ('structural','embedding','keyword','manual','none');
CREATE TYPE actor_type         AS ENUM ('student','admin','system');
CREATE TYPE slot_type          AS ENUM ('lecture','lab','tutorial','other');
```

## 9.4 Reference tables

```sql
CREATE TABLE universities (
  id          text PRIMARY KEY,                       -- 'vtu'
  name        text NOT NULL,
  short_name  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schemes (
  id                 text PRIMARY KEY,                -- 'vtu-2022'
  university_id      text NOT NULL REFERENCES universities(id),
  code               text NOT NULL,                   -- '2022'
  regulation_code    text NOT NULL,                   -- '22OB'
  name               text NOT NULL,
  effective_from     date NOT NULL,
  effective_to       date,
  source_url         text NOT NULL,
  source_verified_at timestamptz NOT NULL,            -- unverified schemes cannot exist
  notes              text,
  UNIQUE (university_id, code)
);

CREATE TABLE colleges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id text NOT NULL REFERENCES universities(id),
  name          text NOT NULL,
  code          text,
  is_autonomous boolean NOT NULL DEFAULT false,
  city          text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id, name)
);

CREATE TABLE branches (
  id            text PRIMARY KEY,                     -- 'cse'
  university_id text NOT NULL REFERENCES universities(id),
  code          text NOT NULL,                        -- 'CS'
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true
);
```

### rule_sets — the versioned academic rules

```sql
CREATE TABLE rule_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id     text NOT NULL REFERENCES schemes(id),
  college_id    uuid REFERENCES colleges(id),         -- NULL = all colleges in scheme
  version       integer NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  active        boolean NOT NULL DEFAULT false,

  grade_bands    jsonb NOT NULL,   -- [{letter,points,min_pct,max_pct}]
  special_grades jsonb NOT NULL,   -- [{letter,points,counts_in_cgpa,meaning}]

  cie_max                   numeric(5,2) NOT NULL,
  cie_min_pct               numeric(5,2) NOT NULL,
  see_max                   numeric(5,2) NOT NULL,
  see_min_pct               numeric(5,2) NOT NULL,
  overall_min_pct           numeric(5,2) NOT NULL,
  attendance_required_pct   numeric(5,2) NOT NULL,
  attendance_condonable_pct numeric(5,2) NOT NULL,
  attendance_dx_floor_pct   numeric(5,2) NOT NULL,

  sgpa_formula_id    text NOT NULL,
  cgpa_formula_id    text NOT NULL,
  percentage_formula text NOT NULL,
  class_bands        jsonb NOT NULL,
  rounding           jsonb NOT NULL,

  source_url    text NOT NULL,
  source_clause text NOT NULL,
  verified_at   timestamptz,
  verified_by   text,

  UNIQUE (scheme_id, college_id, version),

  -- an unverified rule set can never be active
  CONSTRAINT rule_set_active_requires_verification
    CHECK (active = false OR verified_at IS NOT NULL),
  CONSTRAINT rule_set_pct_sane
    CHECK (cie_min_pct BETWEEN 0 AND 100 AND see_min_pct BETWEEN 0 AND 100
       AND overall_min_pct BETWEEN 0 AND 100
       AND attendance_dx_floor_pct <= attendance_required_pct)
);

-- exactly one active rule set per (scheme, college)
CREATE UNIQUE INDEX one_active_rule_set
  ON rule_sets (scheme_id, COALESCE(college_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active;
```

The two constraints above encode policy in the database: **an unverified rule set cannot compute a student-facing number, and two active rule sets cannot conflict.** These are the highest-value constraints in the schema.

`percentage_formula` holds a **formula identifier**, never an expression — `'cgpa_x_10'` for VTU 2022 (22OB 6.7). The obsolete `'cgpa_minus_0_75_x_10'` exists in the registry but is assigned to no active rule set, and a data-quality check asserts that continuously (`22` §P-4, `16` §8). Storing an identifier rather than an expression means the database can be audited for which formula each scheme uses, and means no scheme can silently inherit another's conversion.

### subjects and syllabus

```sql
CREATE TABLE subjects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id    text NOT NULL REFERENCES schemes(id),
  branch_id    text NOT NULL REFERENCES branches(id),
  semester     smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  code         text NOT NULL,
  title        text NOT NULL,
  credits      numeric(3,1) NOT NULL CHECK (credits >= 0),
  category     subject_category NOT NULL,
  cie_max      numeric(5,2) NOT NULL DEFAULT 50,
  see_max      numeric(5,2) NOT NULL DEFAULT 100,
  has_see      boolean NOT NULL DEFAULT true,
  module_count smallint NOT NULL DEFAULT 5,
  source_url   text,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheme_id, branch_id, code)
);

CREATE INDEX subjects_lookup ON subjects (scheme_id, branch_id, semester);
CREATE INDEX subjects_code_trgm ON subjects USING gin (code gin_trgm_ops);
CREATE INDEX subjects_title_trgm ON subjects USING gin (title gin_trgm_ops);

CREATE TABLE syllabus_modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  module_number smallint NOT NULL CHECK (module_number BETWEEN 1 AND 10),
  title         text NOT NULL,
  topics        text[] NOT NULL DEFAULT '{}',
  hours         smallint,
  source_url    text,
  UNIQUE (subject_id, module_number)
);
```

## 9.5 Student tables

```sql
CREATE TABLE students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  email_verified_at timestamptz,
  display_name      text CHECK (length(display_name) <= 100),
  usn               text CHECK (length(usn) <= 20),        -- DEC-002
  -- NO date-of-birth column: DEC-008 removed DOB from the product entirely
  college_id        uuid REFERENCES colleges(id),
  scheme_id         text REFERENCES schemes(id),
  branch_id         text REFERENCES branches(id),
  current_semester  smallint CHECK (current_semester BETWEEN 1 AND 8),
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz,
  deleted_at        timestamptz
);

CREATE INDEX students_active ON students (id) WHERE deleted_at IS NULL;
```

**Note on the absent date-of-birth column (`DEC-008`):** an earlier draft carried an encrypted `dob_encrypted bytea` column with application-layer AEAD and a dedicated key-management design. All of it has been removed, because no approved feature required the field. This eliminates a column, an encryption key, a rotation procedure, a secret, a key-management open question and an entire class of breach exposure. **The cheapest data to protect is data that was never collected** — recorded here so a future contributor does not reintroduce the column believing it was an oversight.

```sql
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,        -- sha256 of the opaque cookie token
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_used_at  timestamptz,
  user_agent_hash bytea,
  revoked_at    timestamptz
);
CREATE INDEX sessions_student ON sessions (student_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry  ON sessions (expires_at);

CREATE TABLE login_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,           -- 15 minutes
  consumed_at timestamptz,
  request_ip_hash bytea
);
CREATE INDEX login_tokens_email ON login_tokens (email, created_at DESC);
```

### Academic records

```sql
CREATE TABLE semester_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  semester       smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  scheme_id      text NOT NULL REFERENCES schemes(id),
  rule_set_id    uuid NOT NULL REFERENCES rule_sets(id),   -- frozen at write time
  sgpa_computed  numeric(4,2),
  sgpa_asserted  numeric(4,2),
  total_credits  numeric(5,1) NOT NULL DEFAULT 0,
  earned_credits numeric(5,1) NOT NULL DEFAULT 0,
  source         record_source NOT NULL DEFAULT 'manual',
  provider_key   text NOT NULL DEFAULT 'manual-entry',   -- ResultProvider that produced this
  authority      result_authority NOT NULL DEFAULT 'student_asserted',
  parser_version text NOT NULL DEFAULT 'manual-v1',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, semester),
  CONSTRAINT sgpa_range CHECK (
    (sgpa_computed IS NULL OR sgpa_computed BETWEEN 0 AND 10) AND
    (sgpa_asserted IS NULL OR sgpa_asserted BETWEEN 0 AND 10))
);

CREATE TABLE semester_subjects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_record_id uuid NOT NULL REFERENCES semester_records(id) ON DELETE CASCADE,
  subject_id         uuid REFERENCES subjects(id),          -- nullable by design
  subject_code       text NOT NULL,
  subject_title      text NOT NULL,
  credits            numeric(3,1) NOT NULL CHECK (credits >= 0),
  cie_marks          numeric(5,2) CHECK (cie_marks >= 0),
  see_marks          numeric(5,2) CHECK (see_marks >= 0),
  total_marks        numeric(5,2) CHECK (total_marks >= 0),
  grade_letter       text NOT NULL,
  grade_points       numeric(4,2) NOT NULL CHECK (grade_points BETWEEN 0 AND 10),
  grade_source       grade_source NOT NULL DEFAULT 'derived',
  result_status      result_status NOT NULL,
  attempt_number     smallint NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  position           smallint NOT NULL DEFAULT 0
);
CREATE INDEX semester_subjects_record ON semester_subjects (semester_record_id);
CREATE INDEX semester_subjects_code   ON semester_subjects (subject_code);

CREATE TABLE attendance_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  semester          smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  subject_id        uuid REFERENCES subjects(id),
  subject_code      text NOT NULL,
  subject_title     text NOT NULL,
  classes_attended  integer NOT NULL DEFAULT 0 CHECK (classes_attended >= 0),
  classes_conducted integer NOT NULL DEFAULT 0 CHECK (classes_conducted >= 0),
  threshold_pct     numeric(5,2) NOT NULL DEFAULT 85,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, semester, subject_code),
  CONSTRAINT attendance_sane CHECK (classes_attended <= classes_conducted)
);
```

`CHECK (classes_attended <= classes_conducted)` is the schema-level counterpart of a validation rule. It exists in both places deliberately: the application gives a good error message, the constraint guarantees the invariant even if a code path forgets.

```sql
CREATE TABLE backlogs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_code      text NOT NULL,
  subject_title     text NOT NULL,
  credits           numeric(3,1) NOT NULL,
  origin_semester   smallint NOT NULL,
  reason            backlog_reason NOT NULL,
  attempts          smallint NOT NULL DEFAULT 1,
  status            backlog_status NOT NULL DEFAULT 'active',
  cleared_in_semester smallint,
  cleared_grade     text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_code, origin_semester)
);

CREATE TABLE timetable_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  subject_code  text NOT NULL,
  subject_title text NOT NULL,
  room          text,
  slot_type     slot_type NOT NULL DEFAULT 'lecture',
  CONSTRAINT slot_time_order CHECK (end_time > start_time)
);
CREATE INDEX timetable_student_day ON timetable_slots (student_id, day_of_week);

CREATE TABLE user_preferences (
  student_id         uuid PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  theme              text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  density            text NOT NULL DEFAULT 'comfortable',
  notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours_start  time,
  quiet_hours_end    time,
  timezone           text NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  categories      text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count   smallint NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  UNIQUE (endpoint)
);
```

## 9.6 Content tables

```sql
CREATE TABLE documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key          text NOT NULL UNIQUE,
  sha256               bytea NOT NULL UNIQUE,       -- free deduplication
  byte_size            bigint NOT NULL CHECK (byte_size > 0),
  page_count           integer,
  mime_type            text NOT NULL,
  kind                 document_kind NOT NULL,
  origin               document_origin NOT NULL,
  uploaded_by_student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  status               document_status NOT NULL DEFAULT 'quarantined',
  rejection_reason     text,
  source_url           text,
  retrieved_at         timestamptz,
  license_note         text,
  publication_tier     publication_tier NOT NULL DEFAULT 'private',   -- DEC-010: fails closed
  rights_verified_at   timestamptz,
  rights_verified_by   text,
  rights_basis         text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  -- a document cannot be public without a recorded rights determination (OQ-008)
  CONSTRAINT public_requires_rights_verification CHECK (
    publication_tier = 'private' OR
    (rights_verified_at IS NOT NULL AND rights_basis IS NOT NULL)
  )
);
CREATE INDEX documents_status ON documents (status);

CREATE TABLE question_papers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  subject_id          uuid REFERENCES subjects(id),
  subject_code        text NOT NULL,
  scheme_id           text REFERENCES schemes(id),
  exam_year           smallint NOT NULL CHECK (exam_year BETWEEN 2000 AND 2100),
  exam_session        text,
  exam_type           text NOT NULL DEFAULT 'see',
  total_marks         numeric(5,2),
  verified_by_operator boolean NOT NULL DEFAULT false,
  confidence          numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qp_subject_year ON question_papers (subject_code, exam_year DESC);

CREATE TABLE questions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_paper_id         uuid NOT NULL REFERENCES question_papers(id) ON DELETE CASCADE,
  question_number           text NOT NULL,
  parent_number             text,
  text                      text NOT NULL,
  marks                     numeric(5,2),
  module_number             smallint CHECK (module_number BETWEEN 1 AND 10),
  module_mapping_method     mapping_method NOT NULL DEFAULT 'none',
  module_mapping_confidence numeric(3,2) CHECK (module_mapping_confidence BETWEEN 0 AND 1),
  extraction_confidence     numeric(3,2) CHECK (extraction_confidence BETWEEN 0 AND 1),
  needs_review              boolean NOT NULL DEFAULT false,
  embedding                 real[],          -- 384 dims; pgvector deferred (06 §6.3)
  cluster_id                uuid,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX questions_paper   ON questions (question_paper_id);
CREATE INDEX questions_module  ON questions (module_number);
CREATE INDEX questions_review  ON questions (needs_review) WHERE needs_review;
CREATE INDEX questions_text_trgm ON questions USING gin (text gin_trgm_ops);

CREATE TABLE question_clusters (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id               uuid REFERENCES subjects(id),
  subject_code             text NOT NULL,
  representative_question_id uuid REFERENCES questions(id) ON DELETE SET NULL,
  member_count             integer NOT NULL DEFAULT 1,
  first_seen_year          smallint,
  last_seen_year           smallint,
  method                   mapping_method NOT NULL,
  method_version           text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_event_id    uuid NOT NULL REFERENCES change_events(id),
  external_source_id uuid NOT NULL REFERENCES external_sources(id),
  title              text NOT NULL,
  published_at       timestamptz,
  url                text NOT NULL,
  category           text,
  body_excerpt       text,
  content_hash       bytea NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_source_id, content_hash)
);
```

## 9.7 Ingestion and operations tables

```sql
CREATE TABLE external_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL UNIQUE,
  base_url             text NOT NULL,
  kind                 source_kind NOT NULL,
  adapter_key          text NOT NULL,
  official             boolean NOT NULL DEFAULT false,
  enabled              boolean NOT NULL DEFAULT false,     -- default OFF
  robots_checked_at    timestamptz,
  robots_allows_path   boolean,
  terms_reviewed_at    timestamptz,
  terms_note           text,
  poll_interval_seconds integer NOT NULL DEFAULT 21600,    -- 6 hours
  rate_limit_per_hour  integer NOT NULL DEFAULT 4,
  health               source_health NOT NULL DEFAULT 'disabled',
  consecutive_failures smallint NOT NULL DEFAULT 0,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  parser_version       text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),

  -- a source cannot be enabled without a recorded robots check that allows it
  CONSTRAINT source_enable_requires_robots_check CHECK (
    enabled = false OR (robots_checked_at IS NOT NULL AND robots_allows_path = true)
  )
);
```

**`source_enable_requires_robots_check` is the single most important constraint in this schema.** It makes the ethical boundary a database invariant: no code path, no admin mistake and no future contributor can enable a source that robots.txt disallows. It is the mechanism that keeps `results.vtu.ac.in` (which returns `Disallow: /`) permanently un-pollable. See `14` §7.

```sql
CREATE TABLE ingestion_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_source_id uuid NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  status             job_status NOT NULL DEFAULT 'pending',
  http_status        smallint,
  bytes              integer,
  duration_ms        integer,
  error_class        text,
  error_message      text,
  parser_version     text NOT NULL,
  raw_snapshot_key   text,
  records_found      integer NOT NULL DEFAULT 0,
  records_published  integer NOT NULL DEFAULT 0
);
CREATE INDEX ingestion_jobs_source_time ON ingestion_jobs (external_source_id, started_at DESC);

CREATE TABLE change_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_source_id uuid NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
  ingestion_job_id   uuid REFERENCES ingestion_jobs(id),
  detected_at        timestamptz NOT NULL DEFAULT now(),
  previous_hash      bytea,
  current_hash       bytea NOT NULL,
  change_kind        change_kind NOT NULL,
  payload            jsonb NOT NULL,
  validated          boolean NOT NULL DEFAULT false,
  published          boolean NOT NULL DEFAULT false,
  -- nothing unvalidated may ever be published
  CONSTRAINT publish_requires_validation CHECK (published = false OR validated = true)
);

CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_after    timestamptz NOT NULL DEFAULT now(),
  attempts     smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  locked_at    timestamptz,
  locked_by    text,
  status       job_status NOT NULL DEFAULT 'pending',
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claimable ON jobs (run_after) WHERE status = 'pending';
```

Workers claim with `SELECT … FROM jobs WHERE status='pending' AND run_after <= now() ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1`, which is safe for concurrent workers without any external queue. *(ponytail: Postgres-as-queue; move to Redis/BullMQ at the trigger in `06` §6.3.)*

```sql
CREATE TABLE audit_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type  actor_type NOT NULL,
  actor_id    uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,     -- personal fields redacted before write
  after       jsonb,
  reason      text,
  ip_hash     bytea,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity ON audit_records (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_time   ON audit_records (created_at DESC);

CREATE TABLE recommendation_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id     uuid REFERENCES subjects(id) ON DELETE CASCADE,
  subject_code   text NOT NULL,
  module_number  smallint NOT NULL,
  score          numeric(5,4) NOT NULL,
  evidence       jsonb NOT NULL,      -- mandatory: the counts behind the score
  paper_count    smallint NOT NULL,
  method_version text NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_code, module_number, method_version)
);
```

`evidence jsonb NOT NULL` enforces the AI policy at the storage layer: a score cannot physically exist without the evidence that produced it.

## 9.8 Index strategy

Indexes are created for known query paths only; speculative indexes cost write throughput and are added on measurement.

| Query | Index |
|---|---|
| Student's semesters | `semester_records (student_id, semester)` via UNIQUE |
| Subjects for scheme/branch/semester | `subjects_lookup` |
| Subject search by code or title | `pg_trgm` GIN indexes |
| Papers for a subject, newest first | `qp_subject_year` |
| Questions needing review | Partial index on `needs_review` |
| Claimable jobs | Partial index `WHERE status='pending'` |
| Source run history | `ingestion_jobs_source_time` |
| Active sessions for a student | Partial index `WHERE revoked_at IS NULL` |

Partial indexes are used throughout because the interesting rows (pending jobs, review items, live sessions) are a small fraction of the table.

## 9.9 Soft deletes and hard deletes

| Table | Policy | Reason |
|---|---|---|
| `students` | **Hybrid** — on deletion, personal columns (`email`, `display_name`, `usn`) are overwritten with NULL and `deleted_at` set; the row survives only to keep FKs valid, then is purged by a nightly job once dependents are gone | Satisfies FR-104 genuinely: nothing identifying remains from the moment of deletion |
| `semester_records`, `attendance_records`, `backlogs`, `timetable_slots`, `sessions`, `preferences`, `subscriptions` | **Hard delete** via `ON DELETE CASCADE` | This is the student's data; it goes |
| `documents` | Soft (`status='rejected'`) then purge from object storage | Needs a review trail while the operator decides |
| `audit_records` | **Never deleted** | The audit trail must survive the actions it records. It contains no personal fields by construction. |
| Reference tables | Never deleted; `active=false` | History must remain computable |

**Anti-pattern explicitly avoided:** a global `deleted_at` on every table with an application filter. It reliably leaks data through a forgotten `WHERE` clause. Only `students` and `documents` use it, and `students` erases the personal fields immediately regardless.

## 9.10 Migrations

- Managed by a **~40-line runner over numbered SQL files** (`services/api/src/db/migrate.ts`), not `drizzle-kit` (`ED-27`). Each migration is a reviewed, committed SQL file, applied inside a transaction, and recorded in a `schema_migrations` table so a second run applies nothing.
- The runner is proven by test from a genuinely clean database: the integration suite drops and recreates the `public` schema on every run, applies migrations, then applies them again and asserts zero further changes.
- **Forward-only.** No down-migrations in production; a mistake is corrected by a new forward migration (down-migrations are almost never tested and give false confidence).
- **Expand/contract for breaking changes:** add the new column → backfill → dual-write → switch reads → drop the old column in a later release. Never rename in a single step.
- Migrations run as a separate deploy step under a role with DDL rights; the application role has DML only.
- Every migration touching a table over ~100k rows states its locking behaviour; index creation uses `CONCURRENTLY`.

## 9.11 Seeds

| Seed | Content | Environment |
|---|---|---|
| `universities`, `branches` | VTU, standard branch list | All |
| `schemes` | VTU 2022 with source URL and verification timestamp | All |
| `rule_sets` | The verified 22OB rule set (`16`) | All |
| `subjects`, `syllabus_modules` | Target branch/semester, hand-verified | All — **manual data-entry work, on the critical path (`02` §2.6)** |
| `external_sources` | VTU announcements (enabled=false until robots check recorded) | All |
| Demo student data | Fictional, clearly labelled | Local + experimental only, **never** in Alpha |

Demo data is generated with an unmistakable marker (USN prefix `DEMO`, names like "Sample Student") so it can never be mistaken for real data, satisfying FR-106.

### 9.11.1 As built in M5a

Only the reference half of §9.4 exists in the database. **No student table has
been created** — not even empty. An empty `students` table "ready for later"
would quietly undercut the privacy claim, and the integration suite asserts the
absence of `students`, `student_profiles`, `attendance_records`,
`semester_records`, `timetable_slots` and `sessions` by querying
`information_schema`.

Tables created by `0001_reference_data.sql`: `universities`, `schemes`,
`branches`, `colleges`, `rule_sets`, `subjects`, `syllabus_modules`, plus
`schema_migrations`.

Two integrity rules are enforced by the **database**, not by application code,
because application code can be bypassed by a migration, a fix-up script or a
future admin tool:

```sql
-- On every publishable table:
CHECK (publication = 'unpublished'
       OR (verification = 'verified' AND verified_at IS NOT NULL))

-- On rule_sets, additionally:
CHECK (NOT active OR verification = 'verified')
```

`source_url` is `NOT NULL` with an `http(s)` format check on every **verified
reference** table, so such a record cannot be inserted without provenance.

**This does not apply to `universities` and `branches`**, which are internal
taxonomy and deliberately carry no provenance or publication columns. See
`08` §8.3.1 for the classification test, and migration `0003`.

**One active rule set per scheme** uses a partial unique index over a `COALESCE`
expression rather than a plain unique constraint (`ED-28`): PostgreSQL treats
NULLs as distinct, so `UNIQUE (scheme_id, college_id, version)` silently fails to
deduplicate exactly the scheme-wide rows (`college_id IS NULL`) that matter most.

What is **seeded** (all verified, all published):

| Table | Rows | Source |
|---|---|---|
| `universities` | 1 | VTU |
| `schemes` | 1 | VTU 2022 (`22OB`) |
| `branches` | 1 | CSE |
| `rule_sets` | 1 | 22OB clauses 3.7, 4.1, 6.1–6.3, 6.6–6.8 |
| `subjects` | 10 | CSE semester 1, 20 credits total, from the verified scheme PDF |

What is **deliberately empty**, because no verified source exists:

| Table | Why |
|---|---|
| `colleges` | No college has been verified. `DEC-003` fixes the scope to "a non-autonomous college", which is not a record |
| `syllabus_modules` | The verified scheme document carries no module breakdown (`OQ-025`) |
| `subjects` sem 3–8 | Not yet transcribed from a verified source |

Demo student data described above is **not** implemented and cannot be: there is
no student table to put it in.

### 9.11.2 Migration 0002 — hardening (M4.1)

Forward-only. `0001` was not edited; `0002` corrects it in place on any database
that already has it, and the upgrade path is tested from a `0001`-only database
carrying the old default.

| Change | Why |
|---|---|
| `subjects.module_count` → nullable, default dropped | A `NOT NULL DEFAULT 5` made every subject assert five modules while its syllabus was empty. NULL now means *unverified*, and is not 0 |
| Existing rows carrying the default → NULL | Narrowly scoped: only rows with `module_count = 5` **and** no syllabus rows |
| `rule_sets_active_lookup` partial index | Serves the new precedence ordering rather than sorting it |
| `subjects_published_lookup` partial index | Supports the collection filter that replaces code-addressed lookup |
| `colleges` gains `source_url`, `source_clause`, `verification`, `verified_at`, `verified_by`, `publication` + the publish-requires-verification CHECK | It was the one publishable reference table with **no** provenance and **no** publication gate, served on `active` alone |

The `colleges` gap was found while writing the rule-set precedence tests, which
needed a college row. No incorrect data was ever served, because the table is
empty — which is also why the backfill is a non-issue.

### 9.11.3 Migration 0003 — taxonomy contract (M4.2)

Forward-only. `0001` and `0002` are not edited.

Review asked why `universities` and `branches` have no verification or
publication controls when every other reference table does. The answer is that
they are **internal taxonomy**, not verified reference data (`08` §8.3.1), and
`docs/09` §9.4 already reflected that — `schemes`, `rule_sets`, `subjects` and
`syllabus_modules` each carry `source_url` in that code block while these two
carry none.

| Change | Why |
|---|---|
| `universities.active` added | Taxonomy's control is `active`. `branches` had it; `universities` did not, which is why `listUniversities()` filtered nothing while `listBranches()` filtered `active` |
| `listUniversities()` now filters `active` | The actual defect: the two halves of one model disagreed |
| `COMMENT ON TABLE` on both | So the absence of provenance reads as a decision in `psql`, not an oversight |

No provenance columns were added. Inventing a source URL for "VTU exists" to
make the tables look uniform would be fabricated provenance, which is worse than
none (`14` §14.10, M4.2 §4).

Tests pin **both** sides: `universities` and `branches` must *not* grow
provenance columns, and `schemes`, `colleges`, `rule_sets`, `subjects` and
`syllabus_modules` must *not* lose them.

### 9.11.4 Migration 0006 — the OCR pipeline (M5A.3)

Forward-only. `0001`–`0005` are not edited.

| Change | Why |
|---|---|
| `extraction_status` gains `ocr_queued`, `ocr_processing`, `ocr_extracted`, `ocr_needs_review` | OCR is a background job with real intermediate states a user can see |
| `documents` gains `paper_format`, `ocr_engine`, `ocr_engine_version`, `ocr_languages`, `ocr_psm`, `ocr_dpi`, `ocr_duration_ms`, `ocr_char_count` | Enough to explain and reproduce a result. **No numeric accuracy score** — there is no ground truth, so a percentage would be invented rather than measured |
| `documents.needs_review` + `review_reason`, with `document_review_has_reason` | A review flag with no reason tells an operator nothing |
| `jobs` table | The queue |

**The queue is PostgreSQL, not Redis.** `FOR UPDATE SKIP LOCKED` provides atomic
claim, and the table provides durable state — the two hard parts. A broker would
add an operational dependency and a second source of truth to solve a problem
one query already solves (docs/23 §23.10).

Two indexes carry the guarantees:

```sql
-- At most one ACTIVE job per document: enqueueing twice is a no-op rather than
-- two workers doing the same seconds-long work. Partial, so a completed or
-- failed job does not block a later re-run.
CREATE UNIQUE INDEX jobs_one_active_per_document
    ON jobs (document_id, job_type)
 WHERE status IN ('queued', 'processing');

-- Serves the claim query's ORDER BY.
CREATE INDEX jobs_claimable ON jobs (job_type, run_after) WHERE status = 'queued';
```

`run_after` implements backoff: a job that failed recently is invisible to
claimants until its delay elapses. A worker killed mid-job leaves its row
`processing`, which `requeueStalled` returns to the queue — without it the
partial unique index would block that document from ever retrying.

## 9.12 Retention

| Data | Retention | Mechanism |
|---|---|---|
| `login_tokens` | 24 h | Nightly purge |
| `sessions` | 30 days after expiry | Nightly purge |
| `ingestion_jobs` | 90 days | Nightly purge, aggregate stats retained |
| Raw source snapshots | 30 days, plus indefinitely for any snapshot attached to a failure fixture | Object-store lifecycle rule |
| `change_events` | 1 year | Purge |
| `audit_records` | 2 years | Purge |
| Student academic data | Until deletion requested | User-controlled |
| Backups | 30 days rolling | Provider PITR + nightly dump |

## 9.13 Database roles

| Role | Rights |
|---|---|
| `gradtools_app` | `SELECT/INSERT/UPDATE/DELETE` on application tables. **No DDL.** No access to `pg_stat_statements` |
| `gradtools_migrate` | DDL; used only by the migration step |
| `gradtools_readonly` | `SELECT` on non-personal tables; for ad-hoc operational queries |

Least privilege here specifically limits the blast radius of a SQL injection that gets past Drizzle's parameterisation: the app role cannot drop tables or read what it has no grant on.

---

### 9.11.4 Migration 0004 — sources and documents (M5)

Forward-only. Adds `sources`, `documents`, `document_sections`,
`source_changes` and their enums.

The safety rules are CHECK constraints rather than application logic, for the
reason §14.3 gives: code enforces a policy only until someone writes different
code.

| Constraint | Refuses |
|---|---|
| `source_enable_requires_all_gates` | Enabling without robots **and** terms **and** verification **and** an access method |
| `source_robots_status_needs_check` | Asserting a robots status with no check date |
| `source_terms_status_needs_review` | Asserting a terms status with no review date |
| `document_host_requires_rights` | Hosting without a dated `permitted` rights determination |
| `document_user_private_stays_private` | Presenting a student's own document as anything but private |
| `document_link_requires_url` | A link with nothing to link to |
| `document_stored_only_when_held` | Storing bytes for a link-only or blocked document |
| `document_rejected_has_reason` | Rejecting with no reason |
| `source_changes_dedupe` | Re-recording an unchanged item on every poll |

`documents.sha256` is UNIQUE, so identical bytes are stored once regardless of
how often they arrive, and the storage key is derived from that hash — nothing
attacker-controlled reaches a path.

**The migration runner now takes an advisory lock.** Two processes running
migrations concurrently both read `schema_migrations`, both conclude a migration
is pending, and the second fails on a duplicate type. That is what a rolling
deploy of two instances does; it was found by two test files racing.
`pg_advisory_lock` blocks rather than failing, so the second caller waits and
finds nothing to apply.

---

### 9.11.5 Migration 0005 — gate hardening (M5.1)

Forward-only. Two gates from `0004` were correct in intent and too permissive in
expression. Neither ever let anything through — no source is enabled and no
document exists — but both allowed a state the design forbids.

**1. Only `http_fetch` may be enabled.**

`0004` required `access_method <> 'none'`, which reads as "reachable somehow"
and is not the question. `enabled` means *GradTools may reach out to this source
on a schedule*, and that is only ever true of `http_fetch`. `manual_upload` and
`manual_entry` describe material arriving from a **human** — a student uploading
their own paper, an operator transcribing a scheme — so enabling one would mean
polling a source that exists precisely because nobody polls it.

The enum keeps all four values: "arrived by upload" versus "typed in by an
operator" is real provenance worth recording. Only one of them is fetchable.

**2. Quarantine holds for publication.**

`0004` gated only the RIGHTS half of publication, so a `quarantined` document —
one whose bytes have never been checked — could be marked `host` or `link`.

```sql
CONSTRAINT document_public_requires_validation CHECK (
  presentation IN ('private','blocked') OR state IN ('validated','extracted'))
```

Rights and validation are **independent** preconditions and both are required.
Having permission to show a document says nothing about whether it is safe to
show. Putting it in a constraint rather than in the query means a second caller,
an admin tool or a fix-up script cannot forget it.

## 9.14 Extracted question tables (M5A.5)

Migration `0007_extracted_questions.sql`. Forward-only; 0001–0006 are not
edited.

| Table | Holds |
|---|---|
| `extracted_papers` | One parser run over one document |
| `extracted_questions` | Descriptive questions. `paper_format` pinned to `descriptive` |
| `extracted_sub_questions` | The a/b/c parts, each with its own marks, box and review state |
| `extracted_mcq_items` | MCQ items, with `options` as jsonb |

### Identity, and why running the parser twice is a no-op

```sql
UNIQUE (document_id, parser_version)     -- the same parser twice is one run
UNIQUE (document_id, extraction_version) -- versions are ordered per document
CREATE UNIQUE INDEX ... ON extracted_papers (document_id) WHERE is_current;
```

`(document_id, parser_version)` is the identity. Re-running the same parser
returns the existing run untouched — which is what protects any review already
recorded against it. Running a NEW parser version creates a new
`extraction_version`, flips `is_current`, and leaves every previous row exactly
where it was. Reprocessing therefore adds; it never overwrites.

Idempotence is the DATABASE's guarantee, not the application's good behaviour:
a concurrent second run hits the unique key, and the caller reports the run that
won rather than an error.

### The format constraint, enforced rather than trusted

```sql
-- on extracted_papers
UNIQUE (id, paper_format)

-- on extracted_questions
paper_format paper_format NOT NULL CHECK (paper_format = 'descriptive'),
FOREIGN KEY (paper_id, paper_format)
  REFERENCES extracted_papers (id, paper_format) ON DELETE CASCADE
```

The composite key costs one redundant column and buys a rule the database
enforces: a descriptive question cannot attach to an MCQ or unknown paper. A
rule that lives only in application code holds only until someone writes
different application code (docs/14 §14.3).

### Review columns

Machine columns are immutable. Corrections live in `reviewed_*` beside them,
under three CHECKs:

| Constraint | What it prevents |
|---|---|
| `*_review_is_attributed` | A review state with no `reviewed_at` / `reviewed_by` — an unattributable human act |
| `*_corrected_has_correction` | `corrected` with nothing actually changed |
| `*_corrections_need_review` | A correction written onto an `unreviewed` row |

`rejected` is a state, never a delete. Removing a low-confidence row would
destroy the evidence a reviewer needs to tell a parser bug from a bad scan.

### Indexes

| Index | Serves |
|---|---|
| `extracted_papers_one_current` | The "show me this document's questions" query, and the one-current rule |
| `extracted_papers_document` | Version history, newest first |
| `extracted_questions_paper` | The ordered question list |
| `extracted_questions_review_queue` | Partial: the rows a person still has to look at |
| `extracted_sub_questions_question` | Sub-questions in order under their parent |

## 9.15 M6 added no tables, and that is the decision

The student academic core introduced **no migration and no server-side student
table**.

Student academic records stay on the device (docs/12, M6 §18, §21). The
repositories added in M6 — semesters, semester subjects, backlogs — are
IndexedDB-backed like the four before them, behind the same async boundary that
a future API-backed bundle will swap into.

The reference schema is unchanged. Schemes, subjects, rule sets and everything
else that is *not* a student's own record remain server-backed and read-only.

**What would force a table.** Signing in, syncing between devices, or a student
sharing a record. None is in scope, and M6 §21 requires stopping to explain
before adding one. Nothing in this milestone came close.

## 9.16 The announcements table (M7, migration 0009)

One table, two enums, five indexes. **Every rule that matters is a CHECK**, so
it holds against a migration script, a psql session and a future service alike —
not only against the code path that happens to exist today.

### Enums

| Type | Values |
|---|---|
| `announcement_category` | `results`, `exam_timetable`, `exam_registration`, `backlog`, `summer_semester`, `revaluation`, `fees`, `holiday`, `academic_calendar`, `college_notice`, `department_notice`, `general` |
| `announcement_origin` | `external_source`, `operator_entry`, `demo_fixture` |

Categories are an enum rather than free text because they drive filtering and
muting; a typo would create a category no student can ever select.

### Constraints

| Constraint | Enforces |
|---|---|
| `announcement_publish_requires_verification` | A row may be `published` **only** if `verification = 'verified'` and `verified_at IS NOT NULL`. The publication gate is the database's, not the router's |
| `announcement_external_needs_source` | `origin = 'external_source'` requires a `source_id`. A notice cannot claim to come from a source it does not name |
| `announcement_deadline_after_publication` | `deadline_at >= published_at` when both exist. A deadline before its own notice is a data-entry error |
| `announcement_branch_name_with_id` / `announcement_college_name_with_id` | An audience id must be accompanied by its name, because the client matches on names (§8.14) |
| `canonical_url ~ '^https?://'` | Only http and https reach storage. The application allowlist (`normalize.ts`) is the first check, this is the one that cannot be bypassed |
| `content_hash ~ '^[0-9a-f]{64}$'` | The hash is a hash |
| `semester BETWEEN 1 AND 8` | An eight-semester degree |

### Indexes

| Index | Purpose |
|---|---|
| `announcements_source_identity` UNIQUE `(source_id, external_id)` WHERE both NOT NULL | Source-named identity |
| `announcements_content_identity` UNIQUE `(source_id, content_hash)` WHERE `external_id IS NULL` | Content identity when the source names nothing |
| `announcements_published_feed` | The feed query: published rows, newest first |
| `announcements_category` | Category filtering |
| `announcements_deadlines` | Deadline ordering |

The two identity indexes are **partial**, which is what lets both coexist: a
source that names its items uses the first and is excluded from the second.

### No notification table

There is none, and adding one is not an oversight to correct later without a
decision: a per-student read flag needs a server-side student, which Stage 1
does not have (§9.15). Read state lives in IndexedDB (§8.15).

## 9.17 The library columns (M8, migration 0010)

No new table. One enum, seven columns and two indexes on `documents`.

### Added

| Column | Type | Notes |
|---|---|---|
| `document_kind` | `document_kind` NOT NULL DEFAULT `'unknown'` | `question_paper`, `syllabus`, `other`, `unknown` |
| `subject_id` | uuid → `subjects` | When set, the taxonomy comes from the join |
| `subject_code` | text (1–24) | Used only when `subject_id` is null |
| `scheme_id` | text → `schemes` | Same |
| `branch_id` | text → `branches` | Same |
| `semester` | smallint 1–8 | Same |
| `exam_year` | smallint 2015–2100 | The year printed on the paper. **Never inferred** |
| `exam_session` | text (1–60) | Free text; VTU labels sittings inconsistently |

### Constraints

| Constraint | Enforces |
|---|---|
| `document_subject_is_stated_once` | `subject_id` and the loose columns are mutually exclusive, so the taxonomy cannot contradict itself |
| `semester BETWEEN 1 AND 8` | An eight-semester degree |
| `exam_year BETWEEN 2015 AND 2100` | A lower bound that is a data-entry check, not a claim about history |

The rules the library depends on most were **already there** and are unchanged:
`document_host_requires_rights`, `document_user_private_stays_private`,
`document_link_requires_url`, `document_stored_only_when_held` and
`document_public_requires_validation`. M8 relies on them rather than restating
them, which is why an unvalidated paper cannot even be *stored* as publicly
visible — a stronger guarantee than filtering one out of a query.

### Indexes

| Index | Purpose |
|---|---|
| `documents_library` — `(exam_year DESC NULLS LAST, created_at DESC)` WHERE the paper is a publicly visible question paper | The library's one listing query. Every filter narrows the same result set |
| `documents_subject_lookup` — `(subject_id)` WHERE NOT NULL | The catalogue join |

**Deliberately not added** (M8 §37): a per-column index for each filter, and a
trigram index for search. Measured at 2,008 papers the planner uses
`documents_library` and completes the listing in **0.44 ms** in-database
(§23.14) — there is nothing for those indexes to improve, and an index no query
reaches is write cost with no read benefit. They go in when a measurement asks
for them.

## 9.18 The student cloud schema (M9, Supabase 0001)

A **separate migration lineage** from `services/api/src/db/migrations/`. Those
run against the self-hosted database that holds reference data; these run
against Supabase and hold student-owned data only (§7.16).

Files: `services/api/src/db/supabase/0001_student_cloud.sql`, plus
`0000_local_substrate.sql` which exists **only for tests** and never runs
against Supabase (docs/22 §22.17).

### Tables

`student_profiles`, `semester_records`, `semester_subjects`,
`semester_results`, `result_subjects`, `attendance_records`,
`timetable_slots`, `backlog_records`.

Every one carries:

| Column | |
|---|---|
| `auth_user_id` | `NOT NULL DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE` |
| `profile_id` | The structural parent |
| `revision`, `updated_at`, `deleted_at` | Sync metadata (§8.17) |

**Ownership is denormalised on purpose.** A policy that has to join to find the
owner is a policy somebody can write subtly wrong, and it costs a lookup per
row. `auth_user_id = auth.uid()` is a comparison nobody can misread.

### Row-level security

Every table: `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`,
with four explicit policies.

```sql
USING      (auth_user_id = (SELECT auth.uid()))   -- SELECT, UPDATE, DELETE
WITH CHECK (auth_user_id = (SELECT auth.uid()))   -- INSERT, UPDATE
```

Three details that are load-bearing:

- **`FORCE`** — without it, whichever role owns the table bypasses every policy.
  It is the most commonly missed half of enabling RLS.
- **`WITH CHECK` on UPDATE** — without it a student could update their own row
  and hand it to somebody else by changing `auth_user_id`. Verified refused.
- **`(SELECT auth.uid())`** rather than a bare call, so the planner evaluates it
  once per statement instead of once per row.

**There is no `USING (true)` anywhere in this file, and there may never be one
for a student-owned table.** `anon` is granted nothing at all — the absence of a
grant is a stronger statement than a policy that happens to match no rows.

### The trigger

`touch_row()` sets `updated_at` and increments `revision` on every update, with
`SET search_path = ''`. Not the application's job: a client that forgot to bump
`revision` would defeat conflict detection for every record it touched, and a
client setting `updated_at` is asserting a clock nobody can verify.

### Verified, not asserted

Against the **live Supabase project**:

| Attempt | Result |
|---|---|
| A reads all profiles | 1 row — their own |
| A selects B's profile by owner id | 0 rows |
| A updates B's row | 0 rows affected |
| A deletes B's row | 0 rows affected |
| A inserts a row owned by B | `42501` — policy violation |
| A reassigns their own row to B | `42501` — `WITH CHECK` refused it |
| `anon` selects from a student table | `42501` — permission denied |

Supabase's security advisor reports no RLS findings. The one advisory it does
report — leaked-password protection — is a dashboard setting, recorded in
docs/25 §25.15 as outstanding.

## 9.19 Result subjects, corrected (M9.1, Supabase 0002)

Forward-only; `0001_student_cloud.sql` is released and was not edited.

### What was missing

`result_subjects` was created with ownership and a parent and **nothing else**:
no `revision`, no `created_at`, no `updated_at`, no `deleted_at`, and no
`touch_row` trigger. Every other student table has all five, because that is
what sync needs to detect a change, order a pull and represent a deletion
(§8.17). 0002 adds them.

### The composite foreign key

```sql
ALTER TABLE semester_results
  ADD CONSTRAINT semester_results_id_owner UNIQUE (id, auth_user_id);

ALTER TABLE result_subjects
  DROP CONSTRAINT result_subjects_result_id_fkey,
  ADD CONSTRAINT result_subjects_belong_to_their_result
    FOREIGN KEY (result_id, auth_user_id)
    REFERENCES semester_results (id, auth_user_id) ON DELETE CASCADE;
```

Before this, `auth_user_id` and `result_id` were independent: RLS guaranteed a
row's own owner matched the caller, and the old FK guaranteed the parent
existed, but nothing tied the two together. A row owned by A could point at a
result owned by B.

The unique constraint on `(id, auth_user_id)` exists to be **referenced**, not
to constrain anything new — `id` is already the primary key.

`ON DELETE CASCADE` means deleting a result takes its subject rows with it,
verified by test.

### Verified

| Attempt | Result |
|---|---|
| A adds a subject row to B's result, through the API | `rejected` — "That subject does not belong to one of your results." |
| The same, directly at the database as A | Foreign key violation |
| A reassigns their own subject row to B | Refused |
| A pulls | B's subject rows absent entirely |
| Deleting a result | Its subject rows cascade |

Applied to the live Supabase project and to the local test database from the
same file.
