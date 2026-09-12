# Deploying GradTools

Authority: Phase 7B.6 §3, §4, §10–§17, §51–§53, §108–§117 · audited at `11a381a`

## Status: deployment-ready, not deployed

Two different sentences, and §110 requires keeping them apart.

| | |
| --- | --- |
| Code is deployment-ready | **yes** — image, entry points, health, shutdown, env matrix |
| Code is deployed | **no** — nothing runs anywhere |
| VTU monitoring is live | **no** — the source gate refuses, by design |

So: **GradTools does not monitor VTU, and is not always-on.** Both would be
false on two independent counts — nothing is deployed, and live acquisition is
refused whether it is or not.

## What was found by looking (§3)

Re-checked at `11a381a` rather than assumed from the last phase:

```
Dockerfile / compose / Procfile / render.yaml / fly.toml / railway
vercel.json / netlify.toml / app.yaml / cloudbuild / serverless   → NONE
supabase/functions, supabase/config                               → NONE
.github/workflows                                                 → verify.yml only
cron: / schedule: anywhere in CI                                  → NONE
```

So this phase adds the one artifact the stack actually needs — a `Dockerfile` —
and this document. Not five platforms' worth of configuration (§111).

## The shape

```
                        DATABASE
                           ▲
                 ┌─────────┴─────────┐
                 │                   │
            API SERVER            WORKER
          (long-lived)          (one-shot)
                 │                   │
            SSE  │                   │  refused while
                 ▼                   ▼  terms are unknown
             BROWSER             VTU SOURCE
```

**One image, two commands.** Same code, same database, same migrations — two
images would be two things to build, scan and let drift apart by a release.

```
API     docker run <image>
worker  docker run <image> pnpm --filter @gradtools/api worker
```

### Why a container and not a function

The API holds two things open that a serverless platform terminates: a `LISTEN`
session on PostgreSQL, and one SSE response per connected student. Both are
long-lived on purpose.

The worker is the opposite, and is therefore a **one-shot command** (§15, §127):
a university publishes a handful of notices a day, so a process sitting in a
loop is paying rent for a schedule the platform already provides. `pnpm --filter
@gradtools/api worker` runs once and exits. `--watch` still exists for a
developer's terminal and is not what a deployment should use.

## What a deployment must supply

### Environment (§112, §113)

**Public — compiled into the browser bundle. Never put a secret in a `VITE_` variable.**

| Variable | Who | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | web | project URL |
| `VITE_SUPABASE_ANON_KEY` | web | publishable; reaches only RLS-protected tables |

**API**

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | reference data — public academic reference, no student data |
| `PORT` / `HOST` | no | default `3001` / `0.0.0.0` in the image |
| `WEB_ORIGIN` | yes | CORS allowlist. **Never `*`** — the API refuses wildcards with credentials |
| `SUPABASE_URL` | for `/me` | JWT verification; public |
| `SUPABASE_DB_URL` | for `/me` | **secret.** Must name `authenticator` — a role with no `bypassrls`. The API refuses to start otherwise |
| `SUPABASE_ADMIN_DB_URL` | no | **secret.** Account deletion only; absent means that one route reports itself unavailable |

**Worker**

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | the source registry and ledger |
| `MONITOR_DATABASE_URL` | for fanout | **secret.** A login role granted `gradtools_monitor`: two views and one INSERT, nothing else (docs/43) |
| `MONITOR_INTERVAL_MINUTES` | no | default 60, **minimum 5 enforced**; also what `--health` measures staleness against |

The worker deliberately does **not** get `SUPABASE_DB_URL`. It is a different
process with different rights, and reusing the API's connection would let a bug
in one borrow the other's privileges (§114).

### A scheduler (§14, §126)

Nothing in this repository schedules anything. A deployment must call the worker
on a cadence — a platform cron, a managed scheduled job, a Kubernetes CronJob,
whatever the host offers natively.

**It is detectable when that is not happening.** `pnpm vtu:monitor --health`
reports `never_ran` for a family with no run recorded and `stale` for one whose
last run is older than three intervals — and `stale` outranks a cheerful `ok`,
because a scheduler that stopped firing otherwise leaves a healthy-looking
record forever (§54).

```
$ pnpm vtu:monitor --health
NEVER_RAN     academic_calendar    never    No run has ever been recorded …
UNAUTHORIZED  examination          0m ago   Refused by the source registry …
overall: never_ran
```

Exit code is non-zero for anything an operator should look at. `unauthorized` is
**not** one of those: while VTU's terms are unreviewed, refusal is the system
working, and paging somebody hourly about it trains them to ignore the alert
that matters.

### A database

Migrations are forward-only and the order is read from the directory, never a
handwritten list (§27). Apply `services/api/src/db/migrations` to the reference
database and `services/api/src/db/supabase` to Supabase — except
`0000_local_substrate.sql`, which exists only because a plain PostgreSQL has no
`auth` schema and must never run against Supabase.

The `gradtools_monitor` role is created by migration `0009`, `NOLOGIN` and with
no password. A deployment creates its own login role and grants that one into
it, so there is nothing in the repository to rotate.

## Realtime, in production

`worker → INSERT → COMMIT → pg_notify → API LISTEN → SSE → browser`, and the
order is not negotiable: the row is committed before anything is announced, so a
socket that is closed, slow or on fire costs a student nothing (§5).

### Single instance (§51, §52)

**Connection tracking is in-process.** The `Map` of open SSE responses lives in
one API process and is not shared.

The distinction §52 asks for: `LISTEN`/`NOTIFY` *does* cross the
worker↔API process boundary, and it *does* reach every listening API instance —
so with several instances, each would be notified and each would deliver to the
students it happens to hold, **which is correct rather than broken**. Only the
`Map` is per-instance, and it does not need to be shared for delivery to work.

What multiple instances would still need care about: nothing for correctness,
because the database is authoritative and a client that misses an event reads
the list on reconnect. **No Redis, no Kafka.** §124's triggers — several
independent consumers, volume Postgres cannot carry, durable replay,
cross-service fanout — remain untrue.

### Proxies (§9, §48)

The SSE route sets `Cache-Control: no-cache, no-transform` and
`X-Accel-Buffering: no`. The second is nginx-specific and harmless elsewhere; if
the eventual platform buffers with something else, that is the place to fix it.
**This has not been verified against a real proxy**, because there is no
deployment to verify against.

### Shutdown (§78, §151)

Fixed this phase, and it was a real bug: `server.close()` waits for open
connections to finish, and an SSE stream is designed never to finish — so every
rolling deploy would have hung until the platform sent SIGKILL, cutting off
whatever else was in flight.

Shutdown now stops accepting, drains idle connections, ends the rest after a
5-second grace period, closes the `LISTEN` session, and then the pool. The image
runs `dumb-init` so SIGTERM actually reaches Node; without an init, PID 1 would
swallow it and none of the above would run.

**Demonstrated, not argued.** `shutdown.test.ts` holds a response open the way
the SSE route does: `server.close()` alone does not resolve, and
`closeAllConnections()` releases it. A first attempt at that test used a partial
request and passed while proving nothing — `closeIdleConnections` treats an
incomplete request as idle and closes it, so the connection has to be a
*completed* request with an open response for the failure to appear at all.

The API was also started for real against the local database: it boots, serves
`/health`, and exits immediately on SIGTERM. What is **not** verified here is
that specific path with a live SSE stream attached, because `/api/v1/me/*` mounts
only with a Supabase configuration this environment does not have.

## What is still refused, and verified

`pnpm vtu:monitor --family examination` →

```
UNAUTHORIZED: Source "vtu-examination" has access method "none" and is
never fetched automatically. Only "http_fetch" sources are.
```

All six families still carry `terms_status = unknown`, `rights_status =
unknown`, `access_method = none`, `enabled = false`. A test asserts all four
values for all six, so relaxing one to "make the worker work" fails the suite.

**And it refuses without touching the network.** A test replaces `fetch` with
one that records the URL and throws, then calls live acquisition for all six:
every one refuses, and the recorded list is empty. Being refused after making
the request would still be an automated request to vtu.ac.in, which is the thing
VTU's terms exclude — so the test asserts the absence, not just the refusal.

Every outbound call in the repository was re-audited (§20): four sites, all
behind the gate. The frontend contains no VTU host at all — only comments saying
it may not fetch one (§21).

## Verified this phase

2037 tests, up from 2022. New: `monitor-deployment.test.ts` (13) — the four gate
values for six families, refusal with the network removed, fixtures still
readable without a network, the five health states including `never_ran` and
`stale`, three scheduled runs (`t1` creates, `t2` creates nothing, `t3` creates
the revision), chronological order across runs, and a failed run leaving the
last known good source intact. Plus `shutdown.test.ts` (2), above.

## Environment blockers — things I could not verify here

Reported rather than fabricated (§26, §107).

- **The image is not built.** Docker CLI 29.7.2 is installed; the daemon is not
  running (`npipe:////./pipe/dockerDesktopLinuxEngine` unavailable). Every path
  the `Dockerfile` copies was checked to exist and all five workspace members
  are covered, but that is static checking, not a build.
- **No real Supabase environment.** No project credentials are configured here,
  so the online browser test (§32) — authenticate, open an SSE stream, run the
  worker, watch a row appear without a refresh — has not been run against a real
  authenticated session. The mechanism is covered at the integration level
  against real PostgreSQL (`monitor-realtime.test.ts`, 21 tests, including an
  event crossing from the worker connection to the API connection) and at the
  hook level in the browser suite.
- **No proxy.** SSE flush behaviour through a production proxy is unverified.
- **No measured latency** (§133), because there is no deployment to measure.

## Not changed

Live VTU authorization, the acquisition gate, the applicability engine, the
importance engine, the frontend, the Notifications design, the exam timetable,
manual records, academic rules, result calculations, timetable parsing. The
catalogue pipeline has no file in this phase's diff.
