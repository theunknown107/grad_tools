# The doorbell

Authority: Phase 7B.5 §1–§190 · measured at `965558e` + this change

## What this phase actually added

B.3 and B.3.1 already had the worker, the scheduler, the legal gate, change
detection, applicability, importance, persistence, dedupe, health and the
inbox. The only missing piece was telling a student who is *already looking at
the page*.

So: one module, one route, one client effect. Nothing else moved.

| Added | Why |
| --- | --- |
| `src/monitor/realtime.ts` | publish/subscribe, connection register |
| `GET /api/v1/me/notifications/stream` | SSE, behind the existing auth guard |
| `useSourceNotifications` stream effect | reads it, dedupes, reconnects |

**No migration.** Realtime uses `pg_notify`, which needs no schema, and the
notification rows are the ones 0007 already defines (§33, §146, §147).

## The database is the notification. This is a doorbell.

Every row is persisted and **committed** before anything is announced (§14,
§38). `materialize` collects events during the transaction and publishes after
`asMonitor` returns, so an event can never describe a row a rollback removed.

`publish` cannot throw. A caller forced to wrap it in try/catch would eventually
forget, and the forgetting would turn a cosmetic delivery problem into a failed
monitoring run.

The consequences, each with a test:

| If | Then |
| --- | --- |
| nobody is connected | the row is in the inbox when they next open the app |
| every listener throws | the run still succeeds, the rows still exist |
| the database refuses the notify | `publish` returns false, the run is fine |
| the same event arrives twice | the client keeps one row, keyed by its id |
| two workers race | one row, one event |
| the run is a dry run | nothing persisted, nothing announced |

## Why Postgres, and not Redis or Kafka

**The worker is a different process from the API** — a cron job and a web
server. An `EventEmitter` in one cannot be heard by the other, so *something*
has to cross that boundary.

`LISTEN`/`NOTIFY` is already installed, already connected to, and already
authenticated. Redis would be a second piece of infrastructure to deploy, secure
and page somebody about. Kafka would be that plus a cluster — for a university
that publishes a handful of notices a day. §90 and §91 rule both out, and
nothing here wants either.

The seam is `publish` and `subscribe`. Swapping in Redis pub/sub later is a
change to `realtime.ts` and nothing else (§30, §93).

**What would justify a real bus** (§98): several independent consumers of these
events, volume Postgres cannot carry, durable replay, or fanout across services.
None is true today.

## SSE, not WebSocket

Everything travels one way: the server has news, the browser renders it. Marking
something read is an ordinary `PATCH` that already existed and still works when
the stream is down. A WebSocket would buy a channel back to the server that
nothing needs, and cost a second protocol to authenticate, proxy, scale and
debug (§15).

### Why not `EventSource`

`EventSource` cannot set a request header. The only way to authenticate one is
to put the token in the URL — where it lands in access logs, proxy logs and
browser history — and §17 and §20 require identity to come from authentication,
not from something in the request a caller can change.

So the stream is read with `fetch`, which takes an `Authorization` header like
every other call. What is given up is `EventSource`'s automatic reconnect,
replaced by one that **refetches the authoritative list first** — which is what
§26 and §74 want and `EventSource` would not have given.

A test asserts the stream URL contains no query string at all.

## Isolation

The addressing *is* the routing. A listener registered for A is in A's set and
no other, so B's connection is never filtered out of A's events — it is never in
the set those events are delivered to (§17, §19). The user comes from the same
`guard` every other route uses; there is no `?user_id=`, no path parameter and
no body.

## Three bugs this phase found by running it

1. **Two `LISTEN` sessions delivered everything twice.** `createApp` opens one,
   and a second `createApp` in the same process — which a test suite does, and a
   hot reload does — opened another. `startListening` is now once per process,
   which is what its own comment had always claimed.

2. **The authoritative refetch clobbered a live arrival.** A notification could
   arrive on the stream between the list request being issued and its reply
   landing, and replacing the list outright dropped it from view. The server's
   rows now win on content and order, and anything that arrived live and is not
   in them yet is kept.

3. **A separate `unread` counter desynced from the rows.** A live arrival
   incremented it while an in-flight list read reset it, so a notification was
   visible and uncounted at the same time. The count is derived from the items
   now — one source of truth instead of two that can disagree.

`TextDecoderStream` was also dropped for a plain `TextDecoder`: it does not
exist in jsdom, so the suite could not see a single delivered frame until it
changed.

## One instance, said out loud

Connections live in a `Map` in the API process (§29, §95, §97).

Two API instances would each hold half the connections — and `LISTEN` broadcasts
to *every* listening session, so both would be notified and each would reach the
students it happens to hold. **That is correct, not broken**, which is a pleasant
accident of using the database: delivery already survives horizontal scaling, and
only the `Map` is per-instance.

Per-account connections are capped at 4 and refused beyond that; the cleanup
runs on `close` and is asserted, because a streaming endpoint that leaks its
listener is how a server runs out of memory over a week (§28, §150, §151).

## Still not "always-on"

Unchanged from docs/43 and required by §48, §49 and §128:

- **Live VTU acquisition remains refused.** `terms_status` and `rights_status`
  are `unknown`, `access_method` is `none`, on all six families. No code here
  touches the gate.
- **No deployed scheduler.** No Dockerfile, no Procfile, no platform config, no
  deploy job. `--watch` is a loop in a terminal.

So: **production-ready scheduled worker with realtime delivery; deployment not
active, source authorization not granted.** GradTools is not monitoring VTU.

## Tests

28 new; **2022 in the suite, up from 1994.**

- `monitor-realtime.test.ts` (21) — the register (addressing, multi-device,
  cleanup, the connection cap, a throwing listener), then the real thing across
  two database connections: an event crossing from the worker to the API, the
  offline student (§23, the primary reliability test), a broken socket, a failed
  publish, a rerun that announces nothing, two concurrent runs, per-student
  isolation, the dry run, and the endpoint refusing unauthenticated subscribers.
- `source-notifications-stream.test.tsx` (7) — arrival without refresh, the
  duplicate event, the authoritative refetch on connect, header auth with no
  identity in the URL, the inbox surviving a dead stream, no stream without an
  account, and abort on unmount.

One test premise was wrong and got corrected rather than the code: the v1
fixture's revaluation notice is scoped to the programme and no scheme, so it
**genuinely applies** to a 2018-scheme B.E. student. The claim worth making is
about the scheme-scoped timetable.

## Limitations

- **No end-to-end browser QA of realtime** (§121–§126). It needs a running API
  plus a real Supabase session, and this environment has neither. The hook-level
  tests cover arrival, duplicates, reconnect-refetch, read state and teardown;
  what they cannot cover is a real socket through a real proxy.
- **Realtime delivery assumes one application instance** for connection
  tracking, as above.
- Everything carried over in docs/43 §Limitations still stands: five of six
  families have no document parser, the panel needs an account, and
  `real-academic-chain-qa` / `subject-identity-qa` fail identically to `2dccfc6`.
