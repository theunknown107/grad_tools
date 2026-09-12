# Monitoring fixtures

Authority: Phase 7B.3 §5, §97–§99, §114

**Every notice in here is written for this test suite.** None of it is a copy of
a VTU document, and none of it is a student's file. The phrasing imitates the
register VTU writes in — "Circular", "Revised Time Table", "Last date" — because
classification keys off those words and a fixture that does not sound like the
source proves nothing about the parser. The facts, dates and document numbers
are invented.

Two snapshots per family. `v1` is what a first run sees; `v2` is the same source
a fortnight later. Between them they exercise every change §12–§15 names:

| Family               | v1 → v2 exercises                                        |
| -------------------- | -------------------------------------------------------- |
| `administration`     | UNCHANGED, NEW                                           |
| `examination`        | REVISED (a notice that says what it replaces), UNCHANGED |
| `academic_calendar`  | UPDATED (same item, different bytes)                     |
| `ug_scheme_syllabus` | REMOVED (present in v1, gone from v2)                    |
| `pg_scheme_syllabus` | NEW only — a family whose first run is its first sight   |
| `regulations`        | UNRESOLVED scope, and an unresolved category             |

Reading these is not a fetch. `vtu:monitor --fixture` never opens a socket, and
the six sources these stand in for are all `access_method = 'none'` (docs/41).
