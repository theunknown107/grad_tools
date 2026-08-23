# 21 — Admin and Data Operations

**Status:** Phase 1 draft
**Why this exists:** external academic sources change without warning, extraction is imperfect, and a solo operator needs to understand *why* something broke in minutes rather than hours. Admin tooling is not optional polish here — it is what makes the data-quality promise in `01` sustainable.

---

## 21.1 Principles

1. **Diagnosis before action.** Every admin screen answers "what happened and why" before offering a fix.
2. **Admins never read individual student records.** No screen queries a named student's marks, attendance or profile (`11` §5). This bounds the damage from an admin compromise and is a direct answer to the privacy question a college will ask.
3. **Every privileged action is audited** with actor, before, after and reason.
4. **Corrections are additive.** Fixing a record creates a new state with history, never a silent overwrite.
5. **Boring and functional.** The admin UI reuses the design system with no bespoke work; time spent styling it is time not spent on the student product.

## 21.2 Access

- Membership is an environment allowlist (`ADMIN_EMAILS`), validated at boot.
- No self-service registration, no role table, no runtime privilege mutation.
- Admin routes live under `/admin/*` with their own rate limits and their own session check.
- Every admin request is audited, including reads of the audit log itself.

## 21.3 Source health dashboard

The first screen an operator opens, and the answer to "is anything broken right now."

```
SOURCES

  Name                  Health     Last success    Fails  Parser   Enabled
  VTU announcements     ● healthy  22 min ago      0      v3       yes
  VTU syllabus          ○ manual   —               —      —        no
  results.vtu.ac.in     ⊘ blocked  —               —      —        NO — robots.txt disallows

  ⊘ = permanently blocked by the robots constraint; cannot be enabled
```

Per-source detail: run timeline (status, duration, HTTP code, bytes, records found/published), a diff of the current fetch against the last good snapshot, failure classification, robots and terms review dates, and the effective rate limit.

Actions: run now, disable, adjust interval, open the failure fixture. **Enable is refused with a clear message when `robots_allows_path` is false or unchecked** (`10` §10.8) — the UI surfaces the database constraint rather than letting the operator discover it as a 500.

## 21.4 Ingestion job monitor

Chronological job list with status, duration and error class; filterable by source and status. Failed jobs expose the full error, the raw snapshot, and a one-click "save as fixture" that writes the failing response into `fixtures/` for the regression workflow in `14` §9.

That one button is the highest-leverage feature in the admin tooling: it converts an incident into a permanent test in a few seconds, at the only moment when the failing input is still available.

## 21.5 Review queue

Low-confidence extractions and every student upload.

```
REVIEW QUEUE (7)

  Type      Subject   Item                          Confidence  Age
  Upload    BCS304    2024-Jan question paper       —           2 h
  Extract   BCS301    9 questions (expected 10)     0.62        1 d
  Mapping   BCS403    Q7 module uncertain           0.51        1 d
```

The review screen shows the rendered PDF page beside the extracted text, the parsed questions with confidence, the proposed module mapping and its method, and the specific validation warnings.

Actions: approve, edit and approve, reject with reason, reprocess with a different method. Every decision is audited, and corrections are preserved across future reprocessing (`17` §10).

## 21.6 Corrections

When a published record is wrong:

```
1  Operator opens the record
2  Enters the correction AND a mandatory reason
3  System writes: audit record (before/after/reason), new record state,
   correction flag on the record
4  UI shows "Corrected on <date>" wherever the record appears
```

**Corrections are visible to users, not silent.** A quietly changed academic record is indistinguishable from an unreliable one; a visibly corrected record demonstrates the system works. The reason field is mandatory because a correction without a rationale is unreviewable six months later.

## 21.7 Reference data management

Subjects, syllabus modules, schemes and rule sets are managed here.

**Rule-set editing carries additional protection**, since a wrong rule set silently corrupts every calculation:

| Guard | Behaviour |
|---|---|
| New version, never in-place edit | Changing a rule creates version N+1 |
| Verification required | `active` cannot be set without `verified_at` (database constraint) |
| Source citation required | `source_url` and `source_clause` are `NOT NULL` |
| Preview before activation | Shows how the change alters a set of sample calculations |
| Historical records unaffected | Stored records keep their original `rule_set_id` (`09` §9.5) |

The preview step is what catches the realistic error: an operator adjusting a grade band without realising it shifts every borderline student's grade.

## 21.8 System health

| Panel | Content |
|---|---|
| API | Uptime, p50/p95 latency, error rate |
| Database | Connections, slow queries, size, last backup |
| Jobs | Pending, running, failed, oldest pending |
| Storage | Object count, bytes, quarantine backlog |
| Notifications | Sent/failed today, active subscriptions, revocations |
| Sources | Count by health |

One page, refreshed on demand. Deep metrics live in the observability stack (`24`); this is the operator's daily glance.

## 21.9 Audit log

Filterable by actor, action, entity type and date range. Records what changed (before/after, personal fields redacted), who changed it, when and why.

Audited: source enable/disable and configuration, publish/unpublish, document review decisions, record corrections, rule-set changes, admin authentication, account deletions (as a system action), and audit-log reads.

Not audited: ordinary student CRUD on their own data. Logging every student action would be surveillance, contradicting `12`, and would bury the events that matter.

Retention: 2 years (`09` §9.12). The audit log contains no personal fields by construction, which is what makes that retention acceptable.

## 21.10 Operational runbooks

Short procedures for the failures that will actually occur.

**A source parser breaks** — the most common incident:
```
1  Alert fires (3 consecutive failures)
2  Open the source detail; read the failure classification
3  Compare current content against the last good snapshot
4  Save the failing response as a fixture (one click)
5  Fix the parser locally against the fixture until it passes
6  Increment parser_version; deploy
7  Run the source manually; confirm healthy
8  The fixture stays as a permanent regression test
```

**A wrong academic value is reported by a student** — the most serious:
```
1  Reproduce with the student's inputs
2  Determine layer: rules engine, rule-set data, or user entry
3  If the rules engine: STOP. Treat as Sev-1.
   Assess how many students are affected, fix, test, deploy, notify affected users
4  If the rule set: create a new version; historical records keep the old one
5  If user entry: help the student correct it; consider whether the UI invited the mistake
6  Add a regression test in every case
```

Step 3's "notify affected users" is unusual for a small project and is deliberate: a student who acted on a wrong CGPA deserves to be told, and doing so is the difference between a defensible product and an untrustworthy one.

**Ingestion backlog:** check for a stuck job holding a lock; clear the lock; reduce concurrency; investigate whether a document is pathologically slow to process.

**Suspected abuse:** identify the pattern via rate-limit logs; tighten the limit for that dimension; revoke sessions if an account is involved; record it in the audit log.

## 21.11 Data quality metrics

Tracked continuously, reviewed before every release:

| Metric | Target |
|---|---|
| Sources healthy | 100% |
| Ingestion success rate (7 days) | ≥ 95% |
| Documents pending review | < 20 |
| Documents rejected (7 days) | < 10% of uploads |
| Extraction confidence, median | ≥ 0.85 |
| Questions needing review | < 15% |
| Records missing provenance | **0** — a hard invariant |
| Rule sets active without verification | **0** — enforced by constraint |

The last two are invariants rather than targets: a non-zero value is a defect, not a trend to improve.

## 21.12 What admin tooling deliberately omits

| Omitted | Reason |
|---|---|
| Student record browser | Privacy boundary (`11` §5) — no legitimate operator need |
| Impersonation / "log in as user" | Extremely useful for support, and an extremely dangerous capability. Rejected: debugging proceeds from the student's own description and from logs |
| Bulk email to all users | Not needed for Alpha; an abuse vector; announcements are the existing channel |
| Feature flags per user | No use case yet; global flags via environment variables suffice |
| Analytics dashboard | Aggregate counters only (`12` §7); a rich dashboard would invite collecting more than needed |
| Self-service admin invitation | Environment allowlist is sufficient and safer for one operator |
