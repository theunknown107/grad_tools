# GradTools — durable working knowledge

What an agent or developer needs before changing this repository. Durable
conventions only; task history lives in git and `docs/32`. Read this first,
update it when a change establishes a new convention.

## Commands

| Check                  | Command                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Types (all packages)   | `pnpm typecheck`                                                                                     |
| Lint                   | `pnpm lint`                                                                                          |
| Format check           | `pnpm format:check` (write: `pnpm exec prettier --write <files>` — never repo-wide in a shared tree) |
| Unit/integration tests | `pnpm test` (web only: `pnpm --filter web exec vitest run <files>`)                                  |
| Production build       | `pnpm --filter web build`                                                                            |
| Browser QA             | `pnpm qa:ux`, `pnpm qa:auth`, `pnpm qa:app` (`WIDTHS=390,768,1024,1280 THEMES=light,dark`)           |

`qa:app` (and every probe that serves `apps/web/dist`) validates the LAST
BUILD. Always build after changing source and before a browser sweep. The
`qa:app` baseline is 12 known axe `scrollable-region-focusable` findings on
overlay menus; anything beyond them is new.

### Database tests

Without database URLs the API suite _skips_ its DB tests; a skipped suite is
not a passing one. The documented setup (`services/api/README.md`) is a
throwaway local cluster on port 55432 with trust auth (on this machine:
`pg_ctl -D D:\gradtools-pgtest -o "-p 55432" -l D:\gradtools-pgtest\server.log start`).
All four URLs are needed for zero skips — the reference DB, the student cloud
as admin, the cloud as `authenticator` (RLS is exercised through it) and as
`monitor_login` (create both roles as `.github/workflows/verify.yml` does):

```bash
export TEST_DATABASE_URL="postgres://gradtools@127.0.0.1:55432/gradtools_test"
export TEST_CLOUD_ADMIN_DATABASE_URL="postgres://gradtools@127.0.0.1:55432/gradtools_cloud_test"
export TEST_CLOUD_DATABASE_URL="postgres://authenticator:authenticator@127.0.0.1:55432/gradtools_cloud_test"
export TEST_MONITOR_DATABASE_URL="postgres://monitor_login:monitor_login@127.0.0.1:55432/gradtools_cloud_test"
```

Never point these at a shared or production database. The local cluster's
time zone is not UTC; production is. Format timestamps as
`to_char(ts AT TIME ZONE 'UTC', '…"Z"')`, never with `OF`, and test
timestamp output over a `TimeZone=UTC` connection.

## Architecture boundaries

Keep these layers separate; do not collapse them into one component.

1. **Identity / profile** — `StudentProfile` (`apps/web/src/domain/types.ts`),
   edited in `features/profile`, first-run setup in `features/onboarding`
   (guided, every step skippable — UF-01, DEC-001, DEC-002). The profile is
   not a sync collection; it travels through `PUT /api/v1/me/profile` with
   `baseRevision` (missing or stale → 409 with the server copy). The device
   keeps `SyncBookkeeping.profile` (last agreed revision + fingerprint); a
   skipped setup uploads an empty _anchor_ that is never adopted locally
   (DEC-048).
2. **Reference catalogs** — `packages/vtu-catalogue` (data files carry
   provenance) and the API reference tables (`colleges`, `branches`,
   `schemes`) seeded from it.
3. **Result access** — GradTools never fetches the VTU result portal (see
   the CAPTCHA boundary). The Get VTU Result screen links to the exact
   official session page; the student saves the page and imports it.
4. **Result extraction** — `domain/result-import.ts` (`parseResultCard`),
   fed by `lib/result-file.ts` (text-layer PDF, OCR images, saved HTML).
5. **Academic normalization** — `result-reconcile.ts` → `ResultReview` →
   one `SemesterResult` per semester (OQ-058 keeps a second card refused).
6. **Derived calculations** — `@gradtools/academic-rules` and
   `domain/statistics.ts`. Never compute SGPA/CGPA/percentage elsewhere;
   `sgpaAsserted` is source data and is never overwritten by a computed value.

## Hard boundaries (not tunable)

- **CAPTCHA / result portal.** `results.vtu.ac.in` robots.txt is
  `Disallow: /`; VTU's terms withhold permission for automated access; and
  `docs/14` §7 prohibits bypassing, solving or _outsourcing_ a CAPTCHA and
  submitting a student's identifiers to a portal on their behalf. Links to the
  portal are plain `<a target="_blank" rel="noopener noreferrer">` — no
  fetch, iframe, prefetch, proxy, or USN in a URL.
- **Date of birth** is not collected, stored, logged or requested (DEC-008).
  It returns only as a new explicit product decision with a privacy review.
- **Privacy.** No USN, name or DOB in URLs or logs (`REDACT_PATHS` in the API
  logger). No personal data in fixtures — use synthetic values such as
  `1XX22CS001`.
- **Academic model** (OQ-055, ED-71): B.E./B.Tech, 2022 scheme, eight
  semesters (`SEMESTER_NUMBERS`). Programme and entry route (PUC/Diploma) are
  profile facts only — infer no duration, rule set or lateral-entry behaviour
  from them.
- **Never invent academic data** — marks, grades, credits, SGPA, semester
  identity or academic rules. Missing stays missing (`metricDisplay` →
  "Unavailable" with a reason). Open academic questions live in `docs/32`
  (OQ-054 failed-course letter, OQ-058 re-sits, OQ-059 attendance scope).

## Result and backlog semantics

- Two backlog sources, never summed or reconciled (OQ-056): recorded
  backlogs (the unqualified "Backlogs") and failures in results ("Backlogs in
  your results"). "To clear" comes only from recorded backlogs.
- Every "clear"/"no backlogs"/"Good"/"Completed" claim goes through
  `hasNoBacklogs` (`domain/statistics.ts`), which requires results that exist
  AND have courses. An empty result is unavailable — never PASS, never
  Completed, never clear.
- A printed semester outside 1–8 is refused at import with a stated reason
  (OQ-057); an unprinted one is chosen by the student and checked against
  saved results.

## Sync invariants (8a07ade)

- Pushes carry only `SYNCED_FIELDS` (`features/auth/useSync.ts`), pinned to
  `services/api/src/student/store.ts` `COLLECTION_TABLES` by
  `test/sync-allowlist.test.ts`. Adding a synced field means: type, allowlist,
  server column, migration, and that test together.
- Pulled records merge onto local ones, so local-only fields (a result's
  `subjects`, `source` provenance, a slot's `classId`, `profileId`,
  `createdAt`) survive and never enter the fingerprint.
- Unchanged records converge (no re-push, no self-conflict); a genuine
  divergence still raises a conflict. Sync tests use a fake cloud that
  enforces the server allowlist, `updated_at > since`, and `baseRevision`.

## Reference catalogs: sourcing and refresh

- Sources are transcribed ONCE into data files with provenance (source URL,
  retrieval timestamp, method, reviewed flag). No scraper is committed and
  nothing fetches a source at build time or at runtime. Refresh is a manual,
  human-reviewed re-transcription that updates the provenance; see
  `packages/vtu-catalogue/README.md`.
- Before reading any source host, read its `robots.txt` and terms; record
  both. Never merge entities with merely similar names; keep the source's own
  code as identity. Do not publish an unreviewed list as verified — mark it.
- Result-session links must point to `https://results.vtu.ac.in/`; the
  catalog loader rejects anything else.
- **Review and publication.** Transcribed rows are `reviewed: false` in the
  data and `draft` / `unpublished` in the DB; the API serves only published
  rows, and the UI says an unreviewed list is "not yet checked". Publishing a
  college needs `verified`, `verified_at`, `source_url` and a known autonomy
  (unknown stays NULL, never guessed). Re-seeding keeps a verified row's
  provenance; a changed name, code or region sends it back to draft.
  `catalogue_id` is the identity (codes repeat); published rows overlay the
  bundled list by it. Source incompleteness is data (`reportedCountsByRegion`),
  never filled with invented rows.
- **Source anomalies are kept as printed**, flagged in data (e.g. a session's
  `anomaly: "label-url-mismatch"`), shown to the student as something to
  check, and pinned by a test so a new one fails. Never "correct" a label on
  inference.

## UI conventions

- **shadcn/ui is the default for every new component**, built on the Radix
  packages already installed; add missing primitives the shadcn way in
  `apps/web/src/components/ui/`. No other component library.
- Design tokens (`text-ink`, `ink-2`, `ink-3`, `bg-raised/panel/sunken`,
  `line`). A deliberate unlayered rule in `styles/index.css` paints every
  border colour neutral: carry state with fills, rings, text or a filled edge
  span — never a coloured border.
- No card-inside-card chrome; figures inside a card use plain `Metric`/
  `MiniStat`. Figures are named by their visible label (`aria-labelledby`).
- Tests use semantic queries (roles, names, `data-testid` for structure), not
  utility classes. Every regression test must fail on the old code — prove it
  by restoring the previous file with `git show <sha>:<path>`, never by
  stashing a shared tree.

## Working with agents

- Split work by file ownership; one owner per file. Shared entry points
  (routes in `App.tsx`, Dashboard/Results buttons) belong to the integrator.
- Define interfaces (types, hooks, deep-link query params) before parallel
  work starts.
- Agents never run `git stash`, `checkout`, `reset`, `commit` or repo-wide
  formatters in a shared tree. Shell heredocs have turned `\\b` into a
  backspace here — write code through file tools and scan for control
  characters.
- Temporary probes go in the scratchpad or `tests/_*.mjs` and are deleted;
  the working tree must hold only intended changes before a commit.
