# 12 — Privacy and Data Governance

**Status:** Phase 1 draft
**Audience:** includes non-engineers — a college representative or a privacy reviewer should be able to read this document alone and understand exactly what GradTools holds.

---

## 12.1 Position

GradTools handles academic records belonging to students who are, in many cases, adults with limited leverage over the institutions holding their data. The product's institutional credibility rests more on this document than on any feature.

Three commitments govern everything below:

1. **Local-first by default.** A student can use the whole product without GradTools holding anything about them.
2. **Just-in-time collection.** No personal field is requested before the feature needing it is used.
3. **The student can see everything and delete everything, without asking.**

## 12.2 Regulatory context

India's **Digital Personal Data Protection Act, 2023 (DPDP Act)** is the applicable framework. As of this document, the Act is enacted but its rules and enforcement timelines have been subject to phased notification — **the precise compliance obligations applicable to a small student project are NOT VERIFIED** and should be confirmed before any public Alpha. See `32/OQ-012`.

GradTools therefore designs to the **stricter of** the DPDP Act's stated principles and general good practice (purpose limitation, data minimisation, storage limitation, consent, right to access and erasure). This produces a design that is defensible under either interpretation and is close to GDPR-shaped practice, which also matters because a reviewer may benchmark against it.

**Statements deliberately not made anywhere in the product:** "GDPR compliant", "DPDP compliant", "fully compliant". Compliance is a legal determination; the product describes what it does, not what it claims to satisfy.

## 12.3 Data inventory

Every category, its purpose, legal basis, storage location and retention. This table is the authoritative answer to "what do you store?"

| # | Data | Purpose | Basis | Where | Retention |
|---|---|---|---|---|---|
| 1 | **Email address** | Sole account identifier; magic-link delivery | Consent (account creation) | Server | Until deletion |
| 2 | **Display name** | Greeting only | Consent, optional | Local; server if account | Until deletion |
| 3 | **USN** | Labelling saved results | Consent, optional (`DEC-002`) | Local; server if account | Until deletion |
| ~~4~~ | ~~Date of birth~~ | **Not collected** — removed by `DEC-008`; no approved feature requires it | — | — | — |
| 5 | **College, scheme, branch, semester** | Selecting the correct rule set and subjects | Consent | Local; server if account | Until deletion |
| 6 | **Semester results (marks, grades)** | SGPA/CGPA, backlogs, analytics | Consent | Local; server if account | Until deletion |
| 7 | **Attendance counts** | Attendance % and bunk planning | Consent | Local; server if account | Until deletion |
| 8 | **Timetable** | Schedule display, reminders | Consent | Local; server if account | Until deletion |
| 9 | **Push subscription** | Delivering notifications | Consent (explicit opt-in) | Server | Until unsubscribe or 5 failures |
| 10 | **Preferences** | Theme, density, quiet hours | Consent | Local; server if account | Until deletion |
| 11 | **Session records** | Keeping the student signed in | Necessary for the service | Server (token hashed) | 30 days after expiry |
| 12 | **Uploaded documents** | Building the paper library | Consent | Object store | Indefinite if published; 30 days if rejected |
| 13 | **Upload attribution** | Review and abuse handling | Legitimate operation | Server | Until account deletion, then detached |
| 14 | **Server logs** | Debugging, abuse detection | Legitimate operation | Server | 30 days |
| 15 | **Error reports** | Fixing defects | Legitimate operation | Sentry, PII-scrubbed | 90 days |
| 16 | **Aggregate usage counts** | Knowing which features are used | Legitimate operation | Server | 1 year, aggregate only |

**Not collected at all:** date of birth, phone number, address, gender, caste/category, photograph, biometric data, precise location, contacts, device identifiers, advertising identifiers, university portal credentials, payment data.

## 12.4 The identity-data decision

This is the sharpest privacy question in the project and is recorded fully rather than glossed.

**Original decision `DEC-002` (human, 2026-08-23):** server-side storage of USN, name, date of birth and academic records was accepted.

**Amending decision `DEC-008` (human, M2):** **date of birth is removed from the product entirely.**

### Why DOB was removed

The risk with the original set was concrete: name + USN + DOB + academic record is a near-complete identity package for an Indian student, sufficient for impersonation in several administrative contexts, and precisely the combination a privacy reviewer probes first. GradTools would have been holding it for a population that gained **no benefit** from it — no approved feature in `02_PRODUCT_REQUIREMENTS.md` reads a date of birth.

Removing it deleted, in one decision:

| Removed | Was |
|---|---|
| A database column | `dob_encrypted bytea` |
| An encryption scheme | Application-layer AEAD |
| A secret | `DOB_ENCRYPTION_KEY` |
| A rotation procedure | A scripted re-encryption migration |
| An open question | `OQ-013`, key custody and rotation |
| A just-in-time collection flow | A UI path and its explanatory copy |
| A breach exposure class | The highest-value field we would have held |

**The cheapest data to protect is data that was never collected.** This is the clearest instance in the project of a privacy improvement that also removed engineering work rather than adding it.

**If a future feature genuinely requires date of birth**, it returns as a new, explicit product decision with its own privacy review — never as a nullable column added quietly because "we might need it".

### What remains, and its controls

The stored identity set is now: **email** (required for an account), **display name** (optional), **USN** (optional).

| Control | Specification |
|---|---|
| Just-in-time collection | USN and name are never required at onboarding; only when a feature needs them (`03/UF-02`, `11` §8) |
| No logging | USN, name and email are in the `pino` redaction list; a test asserts they never appear in log output (NFR-011) |
| No analytics | None of these fields enters any usage metric or error report |
| No admin read path | No admin screen can query an individual student's personal or academic records (`11` §5) |
| Optionality | Name and USN are skippable; the product is fully functional without them |
| Deletion | Erased immediately on account deletion, not soft-flagged (`09` §9.9) |

**Remaining downgrade path, pre-agreed:** if a pilot reviewer objects to plaintext USN, store it as a salted hash server-side with the plaintext local-only. The cost is losing result-label matching across devices. Recorded so the change is a decision to execute, not a redesign. See `32/DEC-002`.

## 12.5 Consent

| Interaction | Consent model |
|---|---|
| Using calculators | None required — no personal data leaves the device |
| Saving local data | Implicit in the action; the setup screen states it is local-only |
| Creating an account | Explicit — a linked privacy summary, not a pre-ticked box |
| Uploading local data on sign-in | **Separate, explicit choice** (`11` §7) |
| Push notifications | Explicit opt-in via the browser permission plus in-app category selection |
| Uploading a document | Explicit, with an affirmation that the uploader may share it |
| Analytics | See §12.7 — no consent prompt because nothing personal is collected |

**Dark patterns prohibited:** no pre-checked boxes, no "are you sure you want to miss out" on decline, no interstitial that blocks use until an account is made, no permission prompt on first load, no deletion flow that offers "deactivate instead" as the default.

## 12.6 Student rights and how they are exercised

| Right | Mechanism | Turnaround |
|---|---|---|
| Know what is held | This document, plus an in-product summary | Immediate |
| Access / export | `GET /profile/export` → complete JSON, self-service | < 30 s |
| Correct | Every field is editable in the product | Immediate |
| Delete | `DELETE /profile`, self-service, no email required | Immediate from live DB |
| Withdraw notification consent | One-click unsubscribe, also in every notification | Immediate |
| Object to processing | Delete the account; there is no processing that survives it | Immediate |

**No right requires contacting the operator.** A privacy right that depends on a solo operator answering an email is not a right; it is a promise. Everything above is a button.

**Export contents:** profile, all semester records and subjects, attendance, backlogs, timetable, preferences, notification subscriptions (endpoints redacted), account metadata, upload list. The export file also states what is *not* included and why (server logs, aggregate counts) so it is honest rather than merely complete-looking.

## 12.7 Analytics

**Decision (engineering, low-risk):** no third-party analytics. No Google Analytics, no Mixpanel, no Meta pixel, no session recording, no heatmaps.

Instead, first-party aggregate counters only:

```
feature_used(feature_key, date) → count
```

Properties: no user identifier, no session identifier, no IP, no user agent, no timestamps finer than a day, no sequencing, so no per-user behaviour can be reconstructed. It answers "was the bunk planner used at all this week", which is what Stage 2 needs (`29` §6), and nothing more.

**Why this matters beyond principle:** a session-recording tool on a page displaying a student's marks records those marks to a third party. Several popular analytics products would do exactly that by default.

## 12.8 Third parties

Every external service that could receive any data, with what it receives.

| Service | Receives | Personal data? | Necessity |
|---|---|---|---|
| Static host / CDN | Requests for static assets, IP addresses in their logs | IP only | Required for delivery |
| API host | All API traffic | Yes | Required |
| Managed Postgres | All stored data | Yes | Required |
| Object storage | PDF documents | No (documents are not personal) | Required for papers |
| Email provider | Email address, magic link | Yes | Required for accounts |
| Web Push service (browser vendor) | Push endpoint + encrypted payload | Endpoint only; payload is end-to-end encrypted | Required for push |
| Sentry | Error stack traces, PII-scrubbed | Should be none — scrubbing configured and tested | Optional; can be disabled |
| Claude API (optional, flag-off) | Question text for explanation generation only | **No student data ever** | Optional feature |

**Binding constraints:** no student academic data is sent to any AI service. The optional LLM feature operates on question-paper text and syllabus content — public academic material — never on a student's marks, attendance or identity. The feature is disabled by default in Alpha.

Data residency: hosting regions are chosen in India or the nearest available region where the provider offers it, for latency and jurisdictional simplicity. Where a provider cannot offer this, it is recorded here. *Provider selection is not final — see `25`.*

## 12.9 Data minimisation applied

Concrete decisions where less was chosen over more:

| Could have collected | Chose instead | Why |
|---|---|---|
| Full user-agent string | SHA-256 hash for device labelling | Fingerprinting vector with no operational value |
| IP address in application records | Salted hash for rate limiting only | Rate limiting does not require the plaintext IP |
| Per-class attendance events | Attended/conducted counts | Counts satisfy every requirement in `02` |
| Delivered-notification archive | Delivery attempt/failure counts only | Message history is unnecessary personal data |
| Personalised recommendations | Per-subject recommendations, identical for everyone | Personalisation would require behavioural tracking |
| Referrer tracking | Nothing | No marketing attribution need |
| Password hashes | No passwords at all | Removes an entire asset class |

## 12.10 Retention and deletion

| Data | Retention | Trigger |
|---|---|---|
| Student academic and personal data | Until deletion requested | User action |
| Inactive account (no sign-in for 24 months) | Warning email, then deletion 30 days later | Automated |
| Login tokens | 24 h | Nightly purge |
| Sessions | 30 days after expiry | Nightly purge |
| Server logs | 30 days | Rotation |
| Error reports | 90 days | Provider policy |
| Ingestion jobs | 90 days | Nightly purge |
| Raw source snapshots | 30 days (indefinite if attached to a failure fixture) | Lifecycle rule |
| Audit records | 2 years | Purge (contains no personal fields) |
| Aggregate counters | 1 year | Purge |
| Backups | 30 days rolling | Provider PITR |

**Deletion is genuine:** personal columns are overwritten and dependent rows hard-deleted in one transaction (`09` §9.9). The only residue is in backups, which age out within 30 days — and the deletion confirmation states that date explicitly rather than hiding it.

## 12.11 Public/private boundaries

| Data | Visibility |
|---|---|
| Schemes, rule sets, subjects, syllabus | **Public** — reference material, and publishing the rule set is a trust feature |
| Question papers, announcements | **Public**, subject to the licensing question in `32/OQ-008` |
| Module frequency analysis | **Public** — derived from public papers, contains no student data |
| A student's results, attendance, backlogs, timetable, profile | **Private to that student.** Not visible to other students, not visible to admins, not visible to their college |
| Aggregate usage counts | Internal |

**There is no feature that shows one student anything about another student.** No leaderboards, no class averages computed from user data, no "students like you". This is a deliberate architectural boundary, not merely an unbuilt feature — see `01` §1.8.

## 12.12 Breach response

| Step | Action | Timing |
|---|---|---|
| 1 | Contain: revoke all sessions, rotate secrets, take affected component offline | Immediately |
| 2 | Assess: which data, how many students, what window, via audit and logs | Within 24 h |
| 3 | Notify affected students by email with specifics and recommended actions | Within 72 h of confirmation |
| 4 | Notify the relevant authority if required by the applicable rules | Per statutory timeline (*NOT VERIFIED* — confirm with `32/OQ-012`) |
| 5 | Publish a post-incident note | Within 14 days |
| 6 | Remediate and add a regression test | Before restoring the affected feature |

A single operator cannot promise a 24×7 response. The stated commitment matches reality, and `24` §Incidents defines what "best effort" concretely means.

## 12.13 Privacy in the pilot

For a college pilot (`29`), additional binding constraints:

- The college receives **no individual student data**. Not results, not attendance, not names, not usage.
- Any pilot reporting is aggregate and non-re-identifiable, with a minimum cohort size of 10 before any figure is shared.
- Students are told, before enrolling in the pilot, exactly what the college will and will not see.
- Participation is voluntary and withdrawable, with no academic consequence.
- If the college requests individual data, the answer is no, and the reason is that the students did not consent to institutional disclosure. Any change requires fresh, explicit student consent — not an institutional decision made on their behalf.

This is the clause most likely to be tested in a real pilot conversation, and it is deliberately non-negotiable.

## 12.14 Governance

| Role | Who | Responsibility |
|---|---|---|
| Data controller | The project lead | All decisions in this document |
| Data processor | Hosting, database, email and storage providers | Per their terms |
| Privacy review trigger | Any new personal field, any new third party, any new sharing | Must update this document **before** implementation |

**A change that adds a personal data field or a third-party recipient is not implementable until this document is updated and the change is recorded in `32`.** That ordering is the governance mechanism; without it, privacy documentation drifts behind the code within a single sprint.
