# @gradtools/api

Read-only reference-data API for GradTools.

**This service holds no student data.** There are no tables for profiles, names,
USNs, attendance, timetables, marks, results, sessions or preferences, and no
authentication, because there is nothing yet to authenticate. Student records
stay in the browser (docs/33 §33.3, docs/12). The absence is enforced by an
integration test that queries `information_schema` and fails if any of those
tables appear.

## What it serves

Public academic reference data — universities, schemes, branches, colleges,
subjects, syllabus modules, and rule-set **metadata**. It never computes an
SGPA, CGPA or percentage: calculation lives in `@gradtools/academic-rules` and
runs on the caller's side (docs/16).

## Configuration

Copy `.env.example` to `.env`. The only required variable is `DATABASE_URL`.
Nothing in this service's configuration may ever reach the browser bundle —
`apps/web` reads only `VITE_`-prefixed public values.

## Running a local database

The integration suite runs against **real PostgreSQL**. SQLite and in-memory
fakes are not substitutes: the constraints, enum types and `ON CONFLICT`
semantics being tested do not exist in them (docs/22 §22.2).

### Option A — Docker (preferred where available)

```bash
docker run --rm -d --name gradtools-pg \
  -e POSTGRES_USER=gradtools \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=gradtools_test \
  -p 55432:5432 postgres:18
```

### Option B — a disposable local cluster (no Docker)

Used on the development machine for this milestone, because Docker was not
available there. Port 55432 keeps it clear of any system PostgreSQL on 5432.

```bash
initdb -D /path/to/gradtools-pgtest -U gradtools --auth=trust
pg_ctl -D /path/to/gradtools-pgtest -o "-p 55432" -l /path/to/gradtools-pgtest/server.log start
createdb -h 127.0.0.1 -p 55432 -U gradtools gradtools_test
createdb -h 127.0.0.1 -p 55432 -U gradtools gradtools_dev
```

> **Windows note.** `initdb` fails with `0xC0000142` when the data directory
> path contains an 8.3 short name (the `NAME~1` form Windows generates for
> directories with spaces or long names). Put the cluster somewhere with a
> plain path, e.g. `D:\gradtools-pgtest`.

`trust` authentication is correct **only** for a throwaway local cluster bound
to loopback. It must never be used anywhere else, which is also why no
credentials are committed: the URL is supplied per machine.

## Running the tests

```bash
export TEST_DATABASE_URL="postgres://gradtools@127.0.0.1:55432/gradtools_test"
pnpm test
```

Without `TEST_DATABASE_URL` the API suite **skips** with a loud warning rather
than failing, so a contributor with no database still gets a usable run — but a
skipped suite is not a passing one. The milestone gate requires it to actually
execute.

The suite drops and recreates the `public` schema on every run, so it always
proves migrations work from a genuinely clean database rather than from whatever
a previous run happened to leave behind.

## Migrations and seed

```bash
pnpm --filter @gradtools/api migrate   # apply pending numbered SQL migrations
pnpm --filter @gradtools/api seed      # deterministic, idempotent reference seed
```

Migrations are forward-only, numbered, and applied inside a transaction. An
already-applied migration is never edited; a correction is a new file.

The seed publishes only rows whose source has been verified. Where a source has
not been verified — colleges, semesters 3–8, syllabus modules — the tables stay
empty on purpose. An empty verified table is a correct answer; fabricated
curriculum data is not (docs/14 §14.10).
