# 11 — Authentication, Identity and Access

**Status:** Phase 1 draft
**Human decision `DEC-001`:** local-first with an optional account. This document specifies that model.

---

## 11.1 The identity ladder

GradTools has three tiers of user, and the product is designed so that tier 1 is genuinely complete rather than a crippled preview.

| Tier | Identity | Storage | Capabilities |
|---|---|---|---|
| **1. Anonymous** | None | Browser (IndexedDB) | All calculators, attendance, bunk planning, timetable, saved results, syllabus and paper browsing |
| **2. Account holder** | Email only | Browser + server | Everything above, plus cross-device sync, push notifications, upload attribution, export and deletion |
| **3. Operator/admin** | Email on a hard-coded allowlist | Server | Source management, review queue, corrections, audit |

**Design consequence:** the account has to *earn* its existence. Sync and notifications are the only reasons to create one, and the product states that plainly instead of gating features to force signups.

There is no separate "college admin" tier in Alpha. No college has agreed to a pilot, so designing an institutional hierarchy now would be speculative (`08` §8.9, `32/OQ-009`).

## 11.2 Why passwordless

The chosen mechanism is an emailed magic link. Passwords, OAuth and OTP were each considered.

| Option | Rejected because |
|---|---|
| Email + password | Requires hashing, reset flows, breach exposure of a credential students reuse elsewhere, and a credential-stuffing surface. All of it to authenticate a low-value session in a student utility. |
| Google OAuth | Adds a third-party dependency that learns which students use GradTools, and drags in consent-screen review. Reconsider post-Alpha if students ask for it. |
| SMS OTP | Costs money per message, requires collecting phone numbers (a worse PII class than email), and SIM-swap is a real attack. |
| University SSO | **Does not exist to us.** No such integration is available and none may be assumed. See `15` §6. |

**Magic link consequences, stated honestly:**
- Sign-in requires email access, so it is slower than a password on a shared or slow connection.
- Losing access to the email address means losing the account (`11` §6).
- Email deliverability becomes a dependency (mitigated in `20` §7).

These are accepted. The alternative reintroduces a credential store, which is the single most attacked asset in a student-data application.

## 11.3 Magic-link flow

```
Student enters email
   │
   ├─ Rate limit: 3/email/hour, 10/IP/hour
   │
   ├─ Generate 32 random bytes (crypto.randomBytes) → base64url token
   ├─ Store SHA-256(token) in login_tokens with a 15-minute expiry
   ├─ Email the link: https://app.../auth/verify?token=<token>
   │
   └─ Respond 200 {"status":"sent"} — ALWAYS, regardless of whether the
      email is registered, with comparable response timing
             │
             ▼
Student clicks the link
   │
   ├─ SPA reads the token, POSTs it to /auth/verify (never a GET —
   │  a GET would put the token in referrers, history and server logs)
   │
   └─ Server, inside ONE transaction:
        1. hash the token, look it up
        2. reject if consumed_at IS NOT NULL or expires_at < now()
        3. set consumed_at = now()                  ← single use
        4. find-or-create the student by email
        5. create a session (32 random bytes, store SHA-256)
        6. Set-Cookie
```

The single transaction in step 3–5 is what makes the token genuinely single-use under concurrent requests; checking then updating in separate statements is a race.

**Token properties**

| Property | Value | Reason |
|---|---|---|
| Entropy | 256 bits | Unguessable |
| Lifetime | 15 minutes | Limits the window if an inbox is briefly exposed |
| Uses | 1 | Replay defence |
| Storage | SHA-256 only | A database leak yields no usable tokens |
| Comparison | Constant-time on the hash | No timing oracle |
| Transport | POST body, not GET query | Keeps it out of logs, history and `Referer` |

## 11.4 Sessions

```
Cookie:  gt_session=<32 random bytes, base64url>
Flags:   HttpOnly  Secure  SameSite=Lax  Path=/  Max-Age=2592000 (30 days)
Server:  sessions.token_hash = SHA-256(token)
```

| Property | Decision | Reason |
|---|---|---|
| Opaque, not JWT | Server-side lookup | Revocation is a `DELETE`; a JWT needs a denylist, which reintroduces the state JWTs claim to remove |
| `HttpOnly` | Yes | Script cannot read the cookie, so an XSS cannot exfiltrate the session |
| `Secure` | Yes | Never sent over plaintext |
| `SameSite=Lax` | Yes | Blocks cross-site POST CSRF while keeping normal top-level navigation working |
| Absolute lifetime | 30 days | Bounded even if the sliding window keeps refreshing |
| Sliding refresh | `last_used_at` updated, expiry extended at most once per 24 h | Avoids a write on every request |
| Rotation | New session on each sign-in; existing ones are **not** revoked | Multi-device is normal for students |
| Revocation | Per-session, or all sessions on deletion/logout-everywhere | |

**Session listing** (`GET /auth/sessions`) shows creation time, last use and a coarse device description derived from a hashed user agent. The raw user-agent string is not stored — it is a fingerprinting vector with no operational value here.

## 11.5 Authorization

Two planes, deliberately separate.

### Student plane

Exactly one rule, applied without exception:

> **A student may read and write only rows whose `student_id` equals the session's `student_id`.**

Implementation requirements:
- The `student_id` used in every query comes **from the session**, never from the request body, path or query string.
- Where a path contains a resource ID, the handler loads it and compares ownership before acting.
- Ownership failures return `404`, not `403` (`10` §10.3).
- Every student-scoped handler declares its guard; a route without one fails a lint rule **and** a test that enumerates the route table.

Anti-pattern explicitly banned: `WHERE id = :id` without `AND student_id = :sessionStudentId`. This single omission is the IDOR class in `13` §5.

### Admin plane

```
ADMIN_EMAILS=operator@example.com      (environment variable, validated at boot)
```

- Membership is an environment allowlist, checked against the session's verified email.
- No self-service admin registration, no role table, no privilege escalation path through the UI, no "make admin" endpoint.
- Every admin action writes an `audit_records` row with actor, action, entity, before/after and reason.
- Admin endpoints live under `/admin/*` with their own rate limits.
- **Admins cannot read individual students' academic records.** The admin tools operate on sources, jobs, documents and reference data. No admin screen queries a named student's results — an operator has no legitimate need, and building the capability creates both a privacy hazard and an attractive target.

This last constraint is unusual and deliberate. It is also the answer to Persona C's second question in `01` §1.4.

## 11.6 Account recovery

There is no password, so recovery is sign-in: request a new link at the same address.

**If the email address itself is lost, the account is unrecoverable.** This is stated at signup, not buried.

Rejected alternatives:
- *Recovery via USN or other semi-public identifiers* — turns semi-public data into an account-takeover mechanism. For a student-records product this is the worst available option.
- *Security questions* — guessable, and stores yet more personal data.
- *Support-mediated recovery* — a solo operator performing identity verification by email is a social-engineering target with no reliable verification method.

**Mitigation instead of recovery:** the student's data is local-first, so losing the account does not lose the data on the device they use. Export (FR-103) is promoted in settings and after significant data entry.

## 11.7 Local-first data and the sync boundary

Anonymous data lives in IndexedDB under a versioned schema. On sign-in, the merge is explicit and never automatic:

```
Local data present + account data present
   → "You have data on this device and data in your account."
     [ Keep this device's data ]  [ Keep account data ]  [ Review both side by side ]
```

**Rule:** local data is never silently uploaded. Uploading changes the privacy posture from "on my device" to "on their server," which is exactly the change a privacy-conscious student is entitled to decide for themselves.

Sync semantics after the merge: last-write-wins per record, with `updated_at` comparison. Conflict resolution beyond this (CRDTs, three-way merge) is unjustified — the same student editing the same semester on two devices simultaneously is rare, and the data is small enough to review.

## 11.8 What identity data is collected, and when

The controlling principle: **no field is collected during onboarding that a feature does not yet need.**

| Field | When asked | Where stored | Required? |
|---|---|---|---|
| Email | Only when creating an account | Server (`citext`, unique) | Yes, for tier 2 |
| Display name | Optional, in profile | Local; server if account | No |
| College/scheme/branch/semester | Setup | Local; server if account | No (defaults exist) |
| **USN** | Only when the student saves a result they want labelled | Local; server if account (`DEC-002`) | No |
| **Date of birth** | **Never collected** — no approved feature requires it (`DEC-008`) | — | — |
| Password | Never | — | — |
| Phone | Never | — | — |
| University portal credentials | **Never, under any circumstances** | — | — |

The last row is a hard product boundary. GradTools does not ask for, accept, store, transmit or proxy university portal credentials in any form. Any feature request implying otherwise is refused, and the reason is stated in the product (`03/UF-08b`).

**On `DEC-002` as amended by `DEC-008`:** server-side storage of USN, name and academic records is accepted for account holders. **Date of birth was removed entirely** because no approved feature requires it — collecting a field "in case a feature needs it later" is exactly the accumulation this document exists to prevent. The remaining fields are protected by just-in-time collection, no admin read path, log redaction, full export and self-service deletion. `12` §4 records the option to downgrade USN to a salted hash if a pilot reviewer objects.

## 11.9 Threats and mitigations

| Threat | Mitigation |
|---|---|
| Magic link intercepted in an unsecured inbox | 15-min expiry, single use, POST-only consumption |
| Link leaked via `Referer` or browser history | Token consumed via POST, stripped from the URL after read |
| Email enumeration | Identical response and comparable timing regardless of registration |
| Login-link spam to a third party's address | Per-email and per-IP rate limits; the email states no account was created |
| Session theft via XSS | `HttpOnly` cookie, strict CSP, JSON-only API, React's default escaping |
| CSRF | `SameSite=Lax` + origin check on state-changing methods |
| Session fixation | A new session is always created at verification; no client-supplied session ID is ever honoured |
| Brute-forcing a session token | 256-bit entropy; rate limiting; no oracle distinguishing invalid from expired |
| IDOR | `student_id` sourced only from the session; enumerated authorization tests |
| Privilege escalation to admin | Allowlist in environment config; no runtime role mutation |
| Database leak yielding sessions | Only hashes stored |
| Database leak yielding identity data | The stored set is deliberately minimal: email, optional name, optional USN. No DOB, no phone, no password, no portal credentials — the highest-value identity fields simply do not exist to leak (`DEC-008`) |

## 11.10 Session and token lifecycle summary

| Object | Created | Expires | Revoked |
|---|---|---|---|
| Login token | Sign-in request | 15 min | On use |
| Session | Token verification | 30 days absolute | Logout, logout-everywhere, account deletion, manual revoke |
| Push subscription | Notification opt-in | On browser revocation | Unsubscribe, or 5 consecutive delivery failures |

Expired login tokens are purged nightly after 24 h; expired sessions after 30 days (`09` §9.12).

## 11.10a Identity provider: Supabase Auth (approved direction, not implemented)

**Human decision `DEC-014` (M3).** When authentication is enabled, **Supabase Auth is the identity provider**. It is not the application layer.

```
Supabase Auth  ->  auth_user_id  ->  student_profile.id  ->  academic records
```

| Layer | Owner | Rationale |
|---|---|---|
| Identity | Supabase Auth | Google, Apple and email providers without building an OAuth stack |
| Application API | **Express** | Remains authoritative. Business logic does not move into Edge Functions because they exist |
| Data store | **PostgreSQL** | Remains authoritative and relational |
| Domain calculations | **`@gradtools/academic-rules`** | Unchanged. No identity concern reaches the rules engine |

**Binding constraints:**

1. **The domain layer never imports a Supabase SDK.** `packages/academic-rules` has zero dependencies by lint rule and by test; `apps/web/src/domain` imports nothing but its own types. Verified by `packages/academic-rules/test/purity.test.ts`.
2. **Supabase's user row is not the academic profile.** They are 1:1 but distinct entities (`08` §Student). This is what later permits account deletion, provider switching, provider linking and email changes without touching a single academic record.
3. **`auth_user_id` is the only identity key.** Never USN, email, name or college. Those are attributes with their own lifecycles: a USN correction or an email change must be an ordinary profile edit, not a re-keying migration.

This supersedes §11.2's line that university SSO "does not exist to us" only in the narrow sense that a provider is now *chosen*; no integration exists, none is built, and no claim of one may be made.

### What M3 implemented

`apps/web/src/domain/identity.ts` — types only, no runtime behaviour:

- `AuthUserId` and `StudentProfileId` as branded, non-interchangeable types
- `AuthUser` (future shape; **no date of birth**, and none may be added — `DEC-008`)
- `ProfileOwnership`, modelling the local-to-account transition

`StudentProfile.authUserId` exists and is **always `null` in Stage 1**. Claiming a local profile for an account is later a field update, not a migration, because every academic record already points at `StudentProfileId`.

### Onboarding order when auth arrives (`DEC-015`)

```
Welcome  ->  Sign in / Register  ->  identity established  ->  academic profile  ->  Dashboard
```

**Not** profile-then-auth. Collecting academic metadata before an identity exists creates duplicate profiles, complicates recovery, and asks for data before the student has any reason to trust the product with it.

Stage 1 is the "try it without an account" branch of that same flow, which is why the profile is local, optional and skippable.

## 11.11 Future: institutional identity

If a college pilot proceeds, an obvious request will be college-verified accounts. Recording the position now so it is not improvised later:

- **Not in Alpha.** No SSO integration exists, and none may be assumed or announced (`15` §6).
- If it happens, the likely mechanism is a college-issued email domain check or an institution-operated OIDC provider — **neither is currently available or promised.** *NOT VERIFIED.*
- It would introduce a new actor (the college) with new access questions: what can a college see about its students? The current answer, which the pilot plan holds to, is **nothing individually identifiable** (`29` §5).
- Any such integration requires a fresh privacy review and a documented agreement before a line of code is written.

## 11.12 Credential handling requirements for M9 (binding, not yet implemented)

**M7 implements no authentication of any kind.** No password, no password table,
no auth endpoint, no Supabase Auth call, no change to auth behaviour. The
announcement feed is public and the operator routes are loopback-only (§10.14).

These requirements bind M9, when identity arrives, and are recorded now so the
decision is not made under delivery pressure later.

### If a password is ever accepted

| Requirement | |
|---|---|
| **Never store a plaintext password** | Not in a column, not in a log, not in an error message, not in a cache, not in a test fixture |
| **Hash with Argon2id** | A memory-hard function chosen for password storage. Not SHA-256, not MD5, not an unsalted digest of any kind |
| **A unique random salt per credential** | Generated by the hashing library, stored with the hash |
| **Never encrypt a password for recovery** | Recoverable means reversible, and reversible means an operator or an attacker with the key can read every credential. Reset by issuing a new one; there is no "retrieve my password" |
| **Never expose a hash** | Not through an API, not in a diagnostic, not in a support tool. A hash is still a credential, offline-attackable |
| **Never log a credential** | Including in request-body dumps and validation errors |

### The intended direction

**Supabase Auth**, so that credential storage, hashing, reset flows and session
handling are the responsibility of a system built for them rather than
hand-rolled here (§11.10a). GradTools stores a reference — `auth_user_id` — and
never a credential.

This does not weaken §11.2: passwordless magic-link sign-in remains the chosen
mechanism. These rules exist because "add a password option" is a request that
arrives eventually, and it must arrive into a written standard rather than into
an improvisation.

### Portal credentials

Unchanged and absolute: **GradTools never asks for, transmits or stores a
student's VTU portal credentials.** Nothing in the announcement feature needs
them, and no future feature may be designed to require them.
