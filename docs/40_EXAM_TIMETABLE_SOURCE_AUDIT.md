# Exam time table — source and layout audit

Authority: Phase 7B.2 §1–§3, §40 · audited at `95a1978` on 2026-09-11

## The finding, first

**Automated retrieval of VTU exam timetables is blocked by the project's own
source gate, and I did not build around it.**

`vtu.ac.in` is registered as `vtu-announcements` and carries:

| Gate | Value | Recorded reason |
| --- | --- | --- |
| `robots_status` | `allowed` | robots.txt fetched 2026-08-24; only `/wp-admin/` is disallowed |
| `terms_status` | **`unknown`** | *"Terms of use have NOT been reviewed. OQ-006 is open. Robots permitting access is not permission to reuse content."* |
| `rights_status` | **`unknown`** | — |
| `enabled` | `false` | `access_method = 'none'` |

The database refuses to enable it:

```sql
CONSTRAINT source_enable_requires_all_gates CHECK (
  enabled = false
  OR (robots_status = 'allowed'   AND robots_checked_at IS NOT NULL
  AND terms_status  = 'permitted' AND terms_reviewed_at IS NOT NULL
  AND verification  = 'verified'  AND verified_at       IS NOT NULL
  AND access_method <> 'none')
)
```

`gates.test.ts` asserts every one of those refusals. Phase 7B.2 §2 says
`unknown = DO NOT FETCH` and *"if legal permission cannot be established: STOP
the automated retrieval portion."*

**A terms review is a human legal act.** Writing `terms_status = 'permitted'`
myself would fabricate precisely the permission this constraint exists to
prevent, so the retrieval half of this feature stops here.

`results.vtu.ac.in` is separately and permanently closed: robots `disallowed`,
terms `prohibited`, rights `prohibited`.

### A related inconsistency, worth resolving

`vtu:sync` fetches `https://vtu.ac.in/pdf/…` under the source id
`vtu-scheme-syllabus` — **and that id is not in the `sources` table at all.**
Only `vtu-announcements` and `vtu-results` are registered. So the catalogue
crawler reaches the same host that this gate blocks, without a registry row and
therefore without passing any gate. Whichever way that is resolved — register
it and review the terms, or stop the crawl — the two paths should not disagree.

## What the source actually looks like

One real document is in the repository already:
`GradTools_Academic_References_5_Images/04_vtu_draft_exam_timetable.jpeg`. It is
an image with no text layer, so it is evidence about LAYOUT and cannot be a
parser fixture.

```
        Visvesvaraya Technological University, Belagavi
 Draft Time Table for Eligible Students of B.E. III & IV (2022 Scheme),
        V & VI semester (2021 Scheme) [CBCS] Examinations, Dec.2025/Jan.2026

 ┌─────────────────┬───────────────────────────┬──────────────────────────┐
 │                 │   2022 Scheme [CBCS]      │   2021 Scheme [CBCS]     │
 │   Date, Day     ├─────────────┬─────────────┼────────────┬─────────────┤
 │                 │ III-Semester│ IV-Semester │ V-Semester │ VI-Semester │
 │                 │ 2.00–5.00pm │ 2.00–5.00pm │ 9.30–12.30 │ 9.30–12.30  │
 ├─────────────────┼─────────────┼─────────────┼────────────┼─────────────┤
 │ 23-01-2026, Fri │ B**301 /    │      --     │     --     │      --     │
 │                 │ BMAT301/    │             │            │             │
 │                 │ BMATEC301/  │             │            │             │
 │                 │ BMATELCE301 │             │            │             │
 │ 27-01-2026, Tue │      --     │ BBOK407 /   │     --     │      --     │
 │                 │             │ BBOC407     │            │             │
 │ 03-02-2026, Tue │ B**304      │      --     │  21**51    │      --     │
 │ 11-02-2026, Wed │      --     │      --     │  21RMI56   │      --     │
 └─────────────────┴─────────────┴─────────────┴────────────┴─────────────┘
```

Five facts a correct model has to absorb, none of them guessable:

1. **One document covers several schemes AND several semesters at once.**
   Scheme and semester are a two-level merged column header, so §15 and §16's
   filters key off the COLUMN, not the document.
2. **The session time is a column property**, not a per-exam field —
   `2.00pm to 5.00pm` sits in the header, and every exam in that column
   inherits it.
3. **The cell is frequently a pattern, not a code.** `B**301`, `B**456*`,
   `21**51`. Matching these to a student's actual course is not an exact-code
   lookup, and it is not fuzzy matching either — it needs a documented
   wildcard rule with source evidence behind it. Nothing in the repository has
   one yet.
4. **A second code grammar appears.** `21RMI56`, `21CIV57` are 2021-scheme
   codes; they do not match `B[A-Z]{2,7}\d{3}[A-Za-z]?` at all.
5. **The publication state is in the title** — "Draft" — and the notes cite a
   Revised Notification number, so §8's states and §9's revision identity are
   real and readable.

`--` means no exam in that column that day, and must not be read as a missing
value. No venue is printed; §49 therefore forbids inventing one.

## Why the parser was not written

§40 requires "several REAL VTU exam timetable PDFs representing different
layouts" and §41 forbids assuming one line is one exam or one run is one cell.
What is available is a single JPEG of a single draft. Writing a PDF table
parser against text-run geometry I have never observed would be the guessing
§42 forbids, and the two prior phases are a long argument for why: every real
defect found in the scheme reader — the split code cells, the wrapped compound
codes, the credits displaced off the row's baseline — was invisible until the
actual runs and coordinates were in front of me.

## What already exists, and what does not

- `apps/web/src/domain/exams.ts` is about **course kind and assessment** —
  whether a course has an SEE, is non-credit or is audit. It has nothing to do
  with exam timetables; the name is a coincidence.
- There is **no** exam event or exam timetable table, in either database.
- The document/version machinery this feature would reuse **does** exist:
  `source_document_versions`, `source_document_references`,
  `document_applicability`, content-addressed storage and the polite downloader
  with its manifest. §3's "do not build a second crawler" is satisfiable when
  the gate opens.
- The manual/user-owned layer §36 wants to reuse exists and works.

## To unblock

1. **Review `vtu.ac.in`'s terms of use** and record the outcome against
   `vtu-announcements` — `terms_status`, `terms_reviewed_at`, `terms_note`.
   This is OQ-006 and it is the only thing standing in the way.
2. Decide what `vtu-scheme-syllabus` is, and register it.
3. With retrieval authorised, collect several real exam timetable PDFs —
   theory and practical, draft and revised, across cycles — before any parser
   is written.
4. Establish, from a VTU notification rather than from inference, what `B**301`
   expands to. Without that the cell cannot be matched to a student's course at
   all, and §11 will not accept a resemblance.
