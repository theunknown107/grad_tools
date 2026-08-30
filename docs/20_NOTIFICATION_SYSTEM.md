# 20 — Notification System

**Status:** Phase 1 draft
**Scope:** Alpha (P1). Not present in the experimental website.

---

## 20.1 Purpose and constraint

Students currently learn about results and exam notices through rumour chains. GradTools can do better — but only by being *accurate*, never by being *fast*.

**The single governing rule:**

> A notification may be sent only from a **validated, published ChangeEvent**, and its wording may describe only **what was actually observed**.

GradTools notifies that a change was detected in a public source. It never asserts that a result has been released, because it has no way to know that.

## 20.2 Notification catalogue

| ID | Type | Trigger | Priority | Alpha? |
|---|---|---|---|---|
| N-01 | Announcement detected | Validated ChangeEvent from a public source | Normal | **Yes** |
| N-02 | Attendance risk | A course crosses below the threshold | Normal | P2 |
| N-03 | DX risk | A course falls below the 75% floor | **High** | P2 |
| N-04 | Class reminder | Timetable slot approaching | Low | P2 |
| N-05 | Test notification | User action | — | Yes (diagnostic) |
| N-06 | Account security | New sign-in on a new device | High | P2 |
| N-07 | Study reminder | User-configured | Low | P3 |

N-01 is the only one in Alpha's committed scope. N-02 and N-03 are computed entirely from the student's own data and require no external source — they are the notifications most likely to be genuinely valuable, and they are candidates for promotion at feature freeze if Stage 2 shows attendance tracking is used.

## 20.3 Delivery channels

| Channel | Status | Notes |
|---|---|---|
| **Web Push (VAPID)** | Alpha | Standards-based, no vendor account, payload end-to-end encrypted |
| In-app | Alpha | Always available; the fallback for every push failure |
| Email | P3 | Only for account-critical messages, never for announcements |
| Telegram | P3 | Frequently requested by students; deferred as an extra dependency and abuse surface |

**Web Push limitations, stated honestly rather than discovered by users:**
- iOS Safari delivers push only to an **installed** PWA (added to the home screen). The notification settings screen explains this and offers install instructions rather than silently failing.
- Android vendor battery optimisation can delay delivery unpredictably.
- Delivery is best-effort. Nothing in GradTools is designed to depend on a push arriving.

**Consequence:** in-app remains the source of truth. A student who opens the app always sees everything, whether or not any push was delivered.

## 20.4 Pipeline

```
Ingestion job → ChangeEvent (validated = true, published = true)
      │
      ▼
 Notification job enqueued  (jobs table)
      │
      ├─ Resolve audience: subscribers to this category, not revoked
      ├─ Per recipient:
      │     ├─ deduplicate  (has this content_hash already been sent to them?)
      │     ├─ quiet hours? → defer to the window's end
      │     ├─ daily cap reached? → drop, log the reason
      │     └─ compose payload (title + short body + deep link)
      ├─ Send with concurrency limit
      └─ Record outcome per subscription
            success        → last_success_at, failure_count = 0
            404 / 410      → subscription revoked permanently (browser removed it)
            429            → retry with backoff
            5xx            → retry up to 3× with backoff, then drop and log
```

**The publish gate is a database constraint** (`09` §9.7: `publish_requires_validation`), so an unvalidated event physically cannot enter this pipeline.

## 20.5 Wording rules (binding)

Full copy rules in `28`. The notification-specific ones, because this is where a wrong word does the most damage:

| Never | Always |
|---|---|
| "Your results are out!" | "New item on the VTU announcements page" |
| "VTU has released 3rd sem results" | "A change was detected in the source we monitor" |
| "Official notice" | "Published on vtu.ac.in — retrieved 14:32" |
| "Check now!!" | Plain statement, no urgency manufacturing |

**Every notification includes:** the source name, the retrieval timestamp, and a path to the original document. A notification GradTools cannot substantiate is not sent.

**Why this matters disproportionately:** a push notification arrives with the authority of the device's system UI. A student who receives "Your results are out" and finds nothing will not blame the phrasing; they will conclude GradTools is unreliable. One such incident costs more trust than ten correct notifications build.

## 20.6 Preferences and controls

| Control | Default | Notes |
|---|---|---|
| Master switch | Off | Push requires explicit opt-in — never prompted on first load |
| Per-category | All on once enabled | Announcements, attendance, reminders |
| Quiet hours | 22:00–07:00, timezone `Asia/Kolkata` | High-priority (N-03, N-06) may still be deferred, not suppressed |
| Daily cap | 5 per student | Hard limit, regardless of source volume |
| Unsubscribe | One tap, in-app and from the notification | Immediate |

**Permission request timing:** never on page load. The browser permission prompt appears only after the student explicitly enables notifications in settings — a prompt on arrival is the fastest way to a permanent denial.

## 20.7 Deduplication and abuse prevention

| Risk | Control |
|---|---|
| Same announcement notified twice | Deduplicated on `content_hash` per student |
| A source republishing everything at once | Anomaly detection blocks publication upstream (`14` §6); no fan-out occurs |
| Notification storm from a parser bug | Daily cap per student; global cap per hour; the job halts and alerts the operator if exceeded |
| Targeting a third party | Push only reaches self-registered subscriptions; there is no user-initiated broadcast |
| Sign-in email as a spam vector | Rate limited per address; the email states that no account was created |
| Dead endpoints accumulating | Revoked on 404/410, or after 5 consecutive failures |

**The global hourly cap deserves emphasis:** if a parser bug produces 400 "new" announcements, the anomaly check should catch it, but if it does not, the global cap stops the fan-out and pages the operator instead of sending 400 notifications to every student. Defence in depth on the failure mode with the worst blast radius.

## 20.8 Failure behaviour

| Failure | Behaviour |
|---|---|
| Push service unreachable | Retry with backoff; item still visible in-app |
| Subscription expired | Revoke silently; prompt to re-enable on next visit |
| Source unhealthy | **No notifications sent** — silence is correct |
| Validation failed | No notification; operator review |
| Notification job crashes | Job retried; deduplication prevents double-send |
| VAPID keys rotated | All subscriptions invalidated; students prompted to re-subscribe with an explanation |

**Silence is the correct failure mode throughout.** A missed notification is a minor inconvenience; a wrong one is a trust failure.

## 20.9 Timing and batching

- Announcements are checked every 6 hours (`14` §13); notifications are sent when a change is found, subject to quiet hours.
- Multiple items found in one run are **batched into a single notification** ("3 new items on the VTU announcements page"), never sent individually.
- No notification is sent during quiet hours; deferred items are delivered as one batch at the window's end.

## 20.10 Testing

| Test | Method |
|---|---|
| Only validated, published events trigger sends | Unit + constraint test |
| Deduplication | Same content hash twice → one send |
| Quiet hours | Deferred and batched correctly across a timezone boundary |
| Daily cap | The 6th notification in a day is dropped and logged |
| Global cap | A simulated 400-item burst halts and alerts |
| Endpoint revocation | 410 response revokes the subscription |
| Retry and backoff | Simulated 5xx produces the correct schedule |
| Copy compliance | Automated check that notification templates contain no prohibited phrases from `28` |
| Payload privacy | No academic data or PII in any push payload |

The copy-compliance test is unusual but justified: the wording rules in §20.5 are the highest-consequence rules in this subsystem, and a template edit is exactly the kind of change that slips through review.

## 20.11 Privacy

- Push payloads contain a title, a short body and a deep link. **Never** marks, grades, attendance figures or any personal data — a payload is decrypted by the browser and may be visible on a lock screen.
- Subscription endpoints are personal data (`12` §3) and are deleted with the account.
- Delivery outcomes are logged as counts and failure classes; no message archive is retained.
- Attendance notifications (N-02, N-03) say "a course needs attention" and require opening the app to see which — a lock-screen notification naming a subject and a percentage discloses academic information to anyone holding the phone.

## 20.12 What M7 actually built

The notification system as specified above assumes a server that knows who a
student is. Stage 1 has no such server (§9.16), so M7 built the half that does
not need one: **derivation on the device.**

### Priority is deterministic and never from a model

| Priority | Rule |
|---|---|
| `urgent` | A **real deadline** within `URGENT_WITHIN_DAYS = 2`, not yet passed |
| `important` | Category is results, exam timetable, exam registration, backlog, revaluation or summer semester |
| `informational` | Category is holiday, academic calendar, college notice, department notice or general |
| `normal` | Everything else |

Two rules follow, and neither is negotiable:

- **Urgency comes only from a date the publisher gave.** An announcement with no
  deadline is never urgent however alarming its wording. Inventing urgency is
  the fastest way to make a student stop trusting the badge — and once the badge
  is untrusted, the genuinely urgent notice is the one that gets ignored.
- **A passed deadline drops back to its category's priority.** It is history;
  shouting about it helps nobody.

No AI, no model, no classifier, anywhere in this path.

### The feed sorts, it does not hide

Relevant first, then priority, then newest. Irrelevant notices are marked and
pushed down, not removed — a student can still reach everything, and a feed that
silently hides notices is one they cannot trust to be complete. The "only what
applies to me" filter is opt-in and reversible.

### Read state

Derived from a small per-device record (§8.15):

- Read, then the announcement changes → **unread again.**
- Dismissed → **stays dismissed** across updates.
- Mark all as read → one record per announcement, replaced not appended.

### Delivery: what exists and what does not

| Channel | Status |
|---|---|
| In-app notification centre | Built |
| Unread count in the app | Built |
| Browser notification while the app is open | Built, **opt-in**. Permission is never requested on page load |
| Web Push (closed app) | **Not built.** Needs VAPID keys, a service worker, a subscription store and a server-side identity. The UI states this limitation rather than implying background delivery |
| Email / SMS | Not built |

The delivery abstraction exists so that adding Web Push later changes a
transport, not the notification model.

## 20.13 M9 did not change notifications

Notification read state and preferences remain **per-device and unsynced**
(docs/08 §8.15, §8.17). "Read on my laptop" is not a fact about the student, and
syncing it would make an account a requirement for a feature that does not need
one.

Web Push remains unbuilt. M9 introduced the identity it would need (`OQ-032`
named this as the blocker), so it is now possible rather than impossible — but
it was out of scope here and nothing about it was implemented (M9 §72).

One consequence of account-bound storage worth recording: notification state is
stored under the account scope like everything else, so signing in as a second
account on one browser starts with a clean unread state rather than inheriting
the first account's.
