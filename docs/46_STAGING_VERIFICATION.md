# Running the image, and what that found

Authority: Phase 7B.7 §1–§179 · measured at `573d5b9`

## The headline

B.6 shipped a Dockerfile and called the code deployment-ready. **It was not.**
Building and running the image found four defects, three of which would have hit
the first real deploy and one of which is a security caveat that changes what
"deployment-ready" is allowed to mean.

None of them was visible by reading the file. All four came from starting the
container and sending it signals.

## Deployment access — audited, not assumed (§3, §5)

| | |
| --- | --- |
| Docker daemon | **available** (started it; engine 29.7.2) |
| Deployment CLIs | none installed — no supabase, fly, railway, render, vercel, netlify |
| Credentials | no `.env`, no `SUPABASE_*`, no deploy token in the environment |
| Platform config in repo | still none (re-checked at `573d5b9`) |

So: **DEPLOYMENT ARTIFACTS READY. DEPLOYMENT NOT ACTIVE. REASON: no hosting
account, no platform CLI and no Supabase project are available in this
environment.** Nothing was deployed and no staging E2E is claimed.

What *was* newly possible is the container itself, and that turned out to be
where the value was.

## Four defects, found by running it

### 1. The API refused to start — and was right to

```
Refusing to start: HOST is set to every network interface, which would
expose the unauthenticated private document routes to the network.
```

The Dockerfile set `HOST=0.0.0.0`, because a container must bind that to be
reachable. `main.ts` refuses a non-loopback bind, because Stage 1's document
routes have no authentication and the bind address is the only control
protecting them.

**The fix was not to silence the check.** Adding `ALLOW_PUBLIC_BIND=true` to the
image would have switched off a real control and published unauthenticated
routes to whatever the platform exposes. So `HOST` is no longer set at all: the
container is unreachable until a deployment sets both variables deliberately.

> **Security caveat this raises, which B.6 did not state.** Until the Stage 1
> document routes gain authentication, this image is safe on a private network
> and **is not safe on the public internet**. "Deployment-ready" means ready for
> a deployment that keeps it behind something — not ready to be given a public
> hostname.

### 2. Every container start downloaded its own package manager

`corepack enable` installs shims; the first `pnpm` call then fetches pnpm from
the network. Every cold boot was a network round trip, and the image would not
have started at all anywhere egress is restricted.

`corepack prepare --activate` at build time fixes half of it. The other half is
that the build runs as `root` and the container runs as `node`, so a cache under
`/root` is invisible at runtime and the download happened anyway —
`COREPACK_HOME=/opt/corepack` plus `chmod a+rX`. Fixing only the first half
looked like it worked and did not; measured `0` downloads at start afterwards.

### 3. A clean shutdown reported itself as a crash

SIGTERM worked — the handler ran, the `LISTEN` closed, the pool drained — and
the container still exited **143** with `Command failed with signal "SIGTERM"`,
because `pnpm` reports its child's signal rather than the app's own exit.

Every orchestrator reads 143 on a normal stop as a crash, so a clean rolling
restart would have looked like a crash loop in the event log. One fewer process
in the chain (`dumb-init → node`, no `pnpm`) and the exit code is the app's:
**exit 0 in 500 ms**.

### 4. (from B.6, confirmed here) the shutdown hang

Already fixed in B.6 and re-verified in the container: stop takes 500 ms rather
than waiting for Docker's 30-second SIGKILL.

## What was verified in real containers

Not mocks, not unit tests — the built image against a real PostgreSQL.

| Check | Result |
| --- | --- |
| Image builds | yes, 981 MB |
| API starts, `/health` | `{"status":"ok"}` |
| `/health/ready` with a real DB | `{"status":"ready","checks":{"database":"up"}}` |
| Refuses a public bind unacknowledged | yes, with the reason |
| SSE route mounted and guarded | `401` unauthenticated (§35 at the route level) |
| `LISTEN` sessions | exactly **1**, `listen "gradtools_notification"` (§177) |
| Listener leak after a notification burst | none — still 1 |
| SIGTERM | exit 0, 500 ms, handler logged (§85) |
| Worker one-shot in the same image | yes (§84) |
| **Live VTU in the container** | **`UNAUTHORIZED`** (§13, §72) |

### The scheduler sequence, in containers (§18, §19, §61)

Three separate `docker run` invocations of the worker against the real database:

| Run | Source | Result |
| --- | --- | --- |
| 1 | fixture v1 | `created 6` · `announced 6/6` |
| 2 | fixture v1 again | **`created 0`** · `already held 6` |
| 3 | fixture v2 | `revised 1` · `created 3` · `announced 3/3` |

The API container was listening throughout; its listener count stayed at 1 and
its log recorded zero errors.

Image size is 981 MB and deliberately not optimised (§156). The API runs through
`tsx`, so the image carries TypeScript and dev dependencies on purpose; trimming
it would mean introducing a compile step nothing else in the repository uses.

## What could not be verified, and why

Reported rather than fabricated (§5, §39, §91).

- **No real authenticated browser E2E** (§32, §40–§54, §55–§56, §88–§92,
  §94–§98). §94 requires an actual sign-in, not injected `localStorage`, and
  there is no Supabase project here to sign in to. The server half is proven at
  the integration level against real PostgreSQL — `monitor-realtime.test.ts`
  includes an event crossing from the worker's connection to the API's — and the
  browser half at the hook level, but the two have not been joined end to end
  through a real session.
- **No scheduler invocation** (§17, §43, §74, §127). There is no platform to
  schedule anything. The worker was invoked manually, which §43 explicitly says
  is a diagnostic and not scheduler proof. `--health` reports `never_ran` and
  `stale` precisely so this is detectable rather than assumed.
- **No proxy** (§38, §88), so SSE flush behaviour through one is unverified.
- **No latency measurement** (§89, §133, §173) — there is no deployment to
  measure across, and §91 forbids claiming a figure that was not measured.
- **No rolling restart** (§86) — no orchestrator.

## Unchanged

Live VTU acquisition is still refused: all six families remain `terms_status =
unknown`, `rights_status = unknown`, `access_method = none`, `enabled = false`,
asserted by test and re-confirmed inside the container. The frontend,
Notifications, Profile, exam timetable, manual records, academic rules, result
calculations, timetable parser and catalogue have no file in this phase's diff.

**GradTools does not monitor VTU and is not always-on**, on two independent
counts: nothing is deployed, and live acquisition is refused whether it is or
not.
