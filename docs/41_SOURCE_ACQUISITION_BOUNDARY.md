# The source acquisition boundary

Authority: Phase 7C §1–§5, §87, §100, §102, §103 · audited at `c353293`

## The finding

**`checkSourcePermission` was written, documented and tested — and its only
callers were its own tests.**

An audit of every outbound `fetch` in `services/api` found four sites:

| Site | Went through the gate? |
| --- | --- |
| `src/sources/fetch.ts` | it *is* the gate |
| `scripts/vtu-discover.ts` | no — direct `fetch(ROOT)` |
| `scripts/vtu-sync.ts` | no — direct `fetch(ROOT)` |
| `scripts/vtu-smoke.ts` | no — direct `fetch(ROOT)` |

`src/sources/vtu-scheme.ts` carried this comment:

> Whether GradTools is ALLOWED to fetch this source at all is decided by
> `checkSourcePermission` against the source registry … This module never
> bypasses that.

True of that module. False of the product.

`vtu-discover.ts` was candid about its own exemption:

> The source registry's robots and terms gates apply to a REGISTERED source;
> this script is a developer tool reading one public listing page.

A developer tool fetching vtu.ac.in is an automated fetch of vtu.ac.in, and
VTU's terms of use do not distinguish. That is the rationalisation §1 names.

## The door

`src/sources/acquire.ts`. Every outbound source fetch asks it first.

```
acquisitionMode(sql, sourceId)
  → { mode: 'live' }                          the registry permits it
  → { mode: 'supplied', refusal, detail }     it does not, and here is why
```

Three refusals, each distinct and each reported:

| `refusal` | Means |
| --- | --- |
| `no_registry` | no database connection, so nothing can be verified |
| `unregistered_source` | the id is not in `sources` at all |
| `not_permitted` | it is registered, and the gates say no |

**It fails closed.** No registry means no evidence that anything is permitted,
so it refuses. A crawler that fetches when it cannot find its own rules is the
failure the registry exists to prevent, and "the database was down" is not
permission.

## Two modes, one pipeline

```
        MODE A                          MODE B
   authorized live source        a document a person supplied
          │                                │
          ▼                                ▼
     acquire(): live                 acquire(): supplied
          │                                │
          └──────────────┬─────────────────┘
                         ▼
              hash · version · extract
              normalize · validate
              applicability · persist
```

The difference is **acquisition only**. `vtu:sync --from <file>` and
`vtu:discover --from <file>` were already Mode B; the other branch was simply
ungated. Because everything downstream is identical, a future grant of
permission is a change to a registry row, not a rewrite (§102).

### Proven, not asserted

```
$ pnpm vtu:discover
SourceNotAuthorized: Source "vtu-scheme-syllabus" has access method "none"
and is never fetched automatically. Only "http_fetch" sources are.

$ pnpm vtu:discover --from <captured listing>
Programmes named: 262
```

## The six families

All registered, all refused. `access_method = 'none'` is the operative field:
GradTools does not reach out for any of them.

| Source id | Family | Canonical URL |
| --- | --- | --- |
| `vtu-administration` | ADMINISTRATION | `/en/category/administration/` |
| `vtu-examination` | EXAMINATION | `/en/category/examination/` |
| `vtu-academic-calendar` | ACADEMIC_CALENDAR | `/academic-calendar/` |
| `vtu-scheme-syllabus` | UG_SCHEME_SYLLABUS | `/scheme-and-syllabus/` |
| `vtu-pg-scheme-syllabus` | PG_SCHEME_SYLLABUS | `/en/pg-scheme-syllabus/` |
| `vtu-regulations` | REGULATIONS | `/category/vtu-regulation/` |

Every one carries `robots_status: allowed` (same 2026-08-24 fetch),
**`terms_status: unknown`**, `rights_status: unknown`, `enabled: false`.

Two further rows predate these: `vtu-announcements` (the site root) and
`vtu-results` (permanently closed — robots `disallowed`, terms and rights
`prohibited`).

## To unlock

One thing: **review vtu.ac.in's terms of use and record the outcome** against
the rows — `terms_status`, `terms_reviewed_at`, `terms_note`. OQ-006 tracks it.
VTU states that the access licence does not include data-mining robots or other
extraction tools, so this is a permission to obtain, not a checkbox to tick.

Nothing else about the architecture changes when it happens.

## What this pass did NOT build

Named so nobody has to discover it:

- **No monitoring worker.** No scheduler, no polling, no persistent process.
  §48's rule applies: nothing here may be described as "always on".
- **No personalized notification pipeline.** Classification, applicability
  scoping and notification generation for the announcement families are not
  implemented.
- **No source ledger for the six families.** `vtu:sync` keeps a per-document
  ledger for the scheme crawl (docs/39); the other five families have no
  discovery, so they have nothing to record yet.
- **Five of six families have no parser.** Only UG scheme/syllabus (the
  existing catalogue pipeline) and exam time tables (user-supplied, docs/40)
  can be read. Administration, examination, academic calendar, PG and
  regulations are registered and refused, and nothing downstream exists.
- **Exam time tables remain local-first**, with no cloud sync.
