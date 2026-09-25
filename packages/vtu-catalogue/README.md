# @gradtools/vtu-catalogue

Reads VTU scheme documents into a normalized course catalogue (see `docs/38_VTU_INGESTION.md`). It also ships three reference lists that were **transcribed by hand once**. This README covers those three lists.

| File                            | What it holds                                                                                                                                   | Source page                                                   | Where it is used                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `data/vtu-colleges.json`        | Affiliated colleges: code, name and region, as printed                                                                                          | https://vtu.ac.in/affiliated-institute/                       | `VTU_COLLEGES` (from `/data`). The API seed writes them as unpublished drafts; the web hook `useColleges()` lists them offline |
| `data/vtu-branches-2022.json`   | 2022-scheme programmes (3rd–8th semester list): label and scheme PDF URL, plus the scheme years and first-year streams, kept only as provenance | https://vtu.ac.in/b-e-scheme-syllabus/                        | `VTU_BRANCHES_2022` (from `/data`). The API seed writes them to `branches`                                                     |
| `data/vtu-result-sessions.json` | Result sessions: the session name, result type, link label and official `results.vtu.ac.in` URL for each                                        | a public index of VTU result links (see `source` in the file) | `vtuResultCatalog()`, `vtuResultCards()` and `findVtuResultSession()`                                                          |

## How these lists are made

These lists are **not** crawled. VTU's terms reportedly withhold permission for data-mining robots, and the result-link index's own terms forbid copying its content. So:

- A person-supervised session reads each page **once**, after checking that page's `robots.txt`.
- It keeps **facts only**, as printed: names, codes, labels and URLs. No page prose or branding is copied.
- No scraper script is committed. Nothing fetches these pages at build time or at run time.
- `results.vtu.ac.in` is **never** fetched: its robots.txt is `Disallow: /`. Its URLs are copied as text and are never built from a pattern.
- Nothing is invented, completed or merged:
  - When a page prints no code, the code is `null`.
  - When a page prints the same code for two institutions, both rows are kept. `source.duplicateCodes` lists the pair.
  - Autonomy is never stated on the colleges page, so `isAutonomous` is `null` for every college.

Every file has a `source` block with the page URL, `retrievedAt`, `method: "one-time transcription"`, `reviewed` and a note on known gaps.

## Refreshing a list (manual)

1. Check the page's `robots.txt` and terms again, and record what you find in `source`.
2. Open the page in a browser and compare it row by row with the JSON file. Add rows that are new and remove rows that are gone, **exactly as printed**. Never "fix" spelling.
3. Keep the existing `id` values; ids are stable keys. `cse` must stay `cse`.
4. Update `source.retrievedAt`, and update the counts and anomaly notes.
5. Set `reviewed: true` only after a person has checked every row against the live page. For colleges, reviewing the list does **not** establish autonomy. A college is published by the API only once it is `verified` and its `is_autonomous` is set from a source (migration 0019).
6. Run `pnpm vitest run packages/vtu-catalogue`. The tests check URL hosts, unique ids, the recorded duplicate codes, provenance, and that the files contain no control characters.
7. Run `pnpm db:seed`. It is idempotent: colleges upsert on `catalogue_id` and branches upsert on `id`.
