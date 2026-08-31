# tests/

Cross-cutting suites that span packages: visual and accessibility QA driven through a
real browser (Playwright + axe-core).

Unit and integration tests live beside the code they test — `packages/academic-rules/test/`,
`apps/web/test/`, `services/api/test/`. Run those with `pnpm test`; nothing in this
directory is part of `pnpm verify`.

| File                   | What it does                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `visual-qa.mjs`        | Sweeps the production build with **no data**. The right test for empty states, and the wrong one for everything else |
| `visual-qa-seeded.mjs` | Seeds a synthetic student, pins the clock, then sweeps 12 routes × 9 widths. See below                               |
| `screenshots/`         | Output of `visual-qa.mjs`, committed as a visual record                                                              |

---

## The seeded sweep

```bash
pnpm build                              # dist/ must be current — the harness serves it
pnpm qa:visual:seeded                   # dark theme  → .qa-screenshots/
SCHEME=light OUT=.qa-light pnpm qa:visual:seeded   # light theme → .qa-light/
```

Both output directories are gitignored. Run it **twice, once per theme**: a palette can
pass contrast in one theme and fail in the other, and M9.4's only real defect was a
dark-theme-only failure that a single-theme sweep would have shipped.

It reports axe violations, horizontal overflow and console errors, and prints
`CLEAN` when there are none.

---

## Environment the seeded sweep needs

Most routes are local-first and need nothing. **Two do not.**

| Route               | Fetches                                                      | Without the API                                                                       |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Question papers** | `/api/v1/question-papers`, `/api/v1/question-papers/filters` | Renders its error state — no rows, so ~50 icons and the whole list layout go untested |
| **Profile**         | `/api/v1/schemes`                                            | Branch and Scheme selects stay empty                                                  |

The harness serves the built app on **`http://localhost:4322`**, and the API must
allow that origin. `WEB_ORIGIN` defaults to `http://localhost:5173` (the Vite dev
server), which does **not** cover it — so the API needs starting with the QA origin
added, or every request from the sweep is refused by CORS.

### Procedure

**1. Start Postgres** (the project's own cluster, trust auth, port 55432 — not a
system-wide install):

```bash
pg_ctl -D "D:/gradtools-pgtest" -o "-p 55432" -l "D:/gradtools-pgtest/server.log" start
pg_isready -h 127.0.0.1 -p 55432        # expect: accepting connections
```

**2. Start the API** with a database that has reference data and a paper library, and
with the QA origin allowed:

```bash
cd services/api
DATABASE_URL="postgres://gradtools@127.0.0.1:55432/gradtools_m8" \
WEB_ORIGIN="http://localhost:5173,http://localhost:4322" \
npx tsx src/main.ts
```

`gradtools_m8` is the database holding `documents` with `document_kind = 'question_paper'`
— the paper library. `gradtools_dev` does not have it and Papers will come back empty.

**3. Confirm before sweeping** — all three must be `200`, and the CORS header must name
the QA origin:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:4322" \
  http://localhost:3001/api/v1/schemes
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:4322" \
  http://localhost:3001/api/v1/question-papers/filters
curl -s -D - -o /dev/null -H "Origin: http://localhost:4322" \
  http://localhost:3001/api/v1/schemes | grep -i access-control-allow-origin
```

**4. Check the result, not just the exit code.** A green sweep with a dead API is not a
green sweep — it is a sweep of two error states. The Papers screenshot should read
`Showing 50 of NNNN`, and Profile's Scheme select should name a scheme rather than being
blank.

### Two ways this goes quietly wrong

Both cost real time during M9.5.2 and neither announces itself:

- **The API is down.** The sweep still reports console errors, but they read as
  `ERR_CONNECTION_REFUSED` on an unrelated-looking URL rather than as "your QA is
  meaningless".
- **The API is up on a port it does not trust.** Requests fail with a CORS message and
  the pages fall back to their error states, which look like ordinary empty states in a
  screenshot. Ad-hoc probes on a port other than 4322 hit this every time — if you write
  a one-off script, serve it on 4322 or add its port to `WEB_ORIGIN`.

### Ports

| Port  | What                                                                     |
| ----- | ------------------------------------------------------------------------ |
| 4319  | `visual-qa.mjs` static server                                            |
| 4322  | `visual-qa-seeded.mjs` static server — **the origin the API must allow** |
| 3001  | API                                                                      |
| 55432 | Postgres                                                                 |

---

## The data is synthetic

`seedData()` invents a semester-5 CSE student: made-up subject codes, made-up grade
letters from the VTU 2022 set, and invented attendance counts. **No real academic record
is ever used for QA**, and none is committed (docs/13).
