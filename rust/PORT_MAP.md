# Port map: gradtools-release-candidate

1 of 84 units have a Rust port; no original changed since it was recorded.

## Ports

| Unit                             | Crate               | In Rust                                                        | Kept in the original                                                                                                                                                                                                                                                   | Cases | Last diff | Original  |
| -------------------------------- | ------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | --------: | --------- |
| `apps/web/src/domain/timetable/` | `rust/timetable-rs` | `subjectKey`, `readSlot`, `normalizeSubjectToken`, `isWeekday` | `DocxLimitError`, `readDocxStructure`, `docxTimetables`, `readDictionary`, `initialismsFor`, `resolveGridSubject`, `readContext`, `parsePeriodGrid`, `parseTimetable`, `applyTimetableCorrections`, `slotsForBatch`, `timetableEntry`, `needsBatch`, `relateTimetable` |  1029 | 1029/1029 | unchanged |

## Not ported yet

In the order `analyze` suggests.

| Unit                                               | Lines | Exports | Readiness |
| -------------------------------------------------- | ----: | ------: | --------: |
| `packages/vtu-catalogue/src/option-groups.ts`      |   170 |       1 |        99 |
| `packages/vtu-catalogue/src/aliases.ts`            |   119 |       3 |       100 |
| `packages/vtu-catalogue/data/`                     |   121 |       2 |       100 |
| `packages/academic-rules/src/marks.ts`             |   162 |       1 |       100 |
| `services/api/src/reference/`                      |   105 |       5 |        86 |
| `packages/vtu-catalogue/src/types.ts`              |   161 |       1 |       100 |
| `packages/shared-types/src/index.ts`               |   329 |       1 |       100 |
| `packages/academic-rules/src/course-result.ts`     |   174 |       1 |       100 |
| `services/api/src/observability/`                  |    71 |       1 |       100 |
| `packages/academic-rules/src/rulesets/`            |   336 |       3 |        97 |
| `packages/shared-types/src/student.ts`             |   271 |       0 |       100 |
| `packages/vtu-catalogue/src/index.ts`              |    97 |       0 |       100 |
| `packages/academic-rules/src/index.ts`             |    75 |       0 |       100 |
| `apps/web/src/App.tsx`                             |   228 |       0 |        97 |
| `services/api/src/config.ts`                       |   241 |       2 |        96 |
| `apps/web/src/components/forms/`                   |   213 |       0 |        93 |
| `packages/academic-rules/src/result.ts`            |    73 |       6 |        96 |
| `apps/web/src/brand/`                              |    48 |       0 |       100 |
| `apps/web/src/components/academic/`                |   103 |       0 |        91 |
| `packages/vtu-catalogue/src/first-year-streams.ts` |   422 |       5 |        71 |
| `packages/shared-types/src/url.ts`                 |    30 |       1 |       100 |
| `packages/vtu-catalogue/src/positioned-text.ts`    |    20 |       0 |       100 |
| `packages/vtu-catalogue/src/result-sessions.ts`    |   160 |       4 |        90 |
| `packages/academic-rules/src/schemes.ts`           |   102 |       2 |       100 |
| `packages/shared-types/src/document-ai.ts`         |   165 |       0 |        98 |
| `packages/vtu-catalogue/src/code-scheme.ts`        |    28 |       1 |        98 |
| `services/api/src/student/`                        |   507 |       5 |        80 |
| `packages/shared-types/src/support.ts`             |   198 |       0 |        98 |
| `packages/shared-types/src/terms.ts`               |   199 |       0 |        98 |
| `apps/web/src/features/support/`                   |   474 |       0 |        80 |
| `apps/web/src/features/vtu-results/`               |   431 |       0 |        76 |
| `packages/academic-rules/src/attendance.ts`        |   284 |       3 |        95 |
| `packages/academic-rules/src/gpa.ts`               |   194 |       3 |        91 |
| `packages/academic-rules/src/grades.ts`            |   149 |       4 |        96 |
| `packages/academic-rules/src/percentage.ts`        |   148 |       4 |        95 |
| `packages/academic-rules/src/targets.ts`           |   259 |       2 |        95 |
| `services/api/src/main.ts`                         |   118 |       0 |        96 |
| `apps/web/src/components/`                         |    55 |       0 |        99 |
| `packages/vtu-catalogue/src/publication.ts`        |   236 |       3 |        89 |
| `services/api/src/auth/`                           |   256 |       7 |        72 |
| `apps/web/src/components/navigation/`              |   330 |       0 |        73 |
| `apps/web/src/features/diagnostics/`               |   506 |       0 |        72 |
| `packages/shared-types/src/sources.ts`             |   908 |       0 |        84 |
| `services/api/src/announcements/`                  |   376 |       8 |        73 |
| `services/api/src/support/`                        |   535 |      14 |        72 |
| `packages/academic-rules/src/rounding.ts`          |    49 |       2 |        96 |
| `apps/web/src/components/charts/`                  |   328 |       0 |        84 |
| `apps/web/src/features/exams/`                     |   253 |       0 |        81 |
| `apps/web/src/features/landing/`                   |   400 |       0 |        85 |
| `apps/web/src/main.tsx`                            |    40 |       0 |        94 |
| `services/api/src/account/`                        |    38 |       2 |        95 |
| `apps/web/scripts/`                                |   301 |       0 |        73 |
| `apps/web/src/features/`                           |    38 |       0 |        94 |
| `packages/academic-rules/src/types.ts`             |   227 |       0 |        83 |
| `apps/web/src/features/announcements/`             |   650 |       0 |        74 |
| `apps/web/src/features/academics/`                 |   907 |       0 |        71 |
| `apps/web/src/components/layout/`                  |   907 |       0 |        68 |
| `apps/web/src/features/dashboard/`                 |   946 |       0 |        66 |
| `apps/web/src/features/onboarding/`                |   714 |       0 |        64 |
| `apps/web/src/repositories/`                       |   524 |       0 |        57 |
| `packages/vtu-catalogue/src/syllabus-import.ts`    |   685 |       1 |        42 |
| `apps/web/src/features/profile/`                   |  1176 |       0 |        59 |
| `tools/research/`                                  |   416 |       0 |        45 |
| `services/api/src/routes/`                         |  1046 |       7 |        57 |
| `apps/web/src/features/semesters/`                 |  1122 |       0 |        50 |
| `apps/web/src/features/results/`                   |  1747 |       0 |        47 |
| `apps/web/src/features/timetable/`                 |  1249 |       0 |        43 |
| `services/api/src/documents/`                      |   892 |      18 |        40 |
| `apps/web/src/features/attendance/`                |  1752 |       0 |        38 |
| `services/api/src/http/`                           |  1231 |      15 |        35 |
| `apps/web/src/repositories/cloud/`                 |   857 |       6 |        31 |
| `apps/web/src/repositories/local/`                 |  1603 |      24 |        15 |
| `packages/vtu-catalogue/src/scheme-import.ts`      |  1608 |       8 |        13 |
| `services/api/src/db/`                             |  2435 |      27 |         6 |
| `services/api/src/sources/`                        |  3386 |      31 |         0 |
| `apps/web/src/domain/`                             |  9446 |     132 |         0 |
| `apps/web/src/hooks/`                              |  1975 |       0 |         0 |
| `apps/web/src/lib/`                                |  2449 |       0 |         0 |
| `services/api/src/monitor/`                        |  2246 |      36 |         0 |
| `apps/web/src/features/auth/`                      |  3104 |       0 |         0 |
| `apps/web/src/features/import/`                    |  2827 |       0 |         0 |
| `apps/web/src/components/ui/`                      |  2274 |       0 |         0 |
| `services/api/scripts/`                            |  3819 |       0 |         0 |

Regenerate with `rust-anything map --write`. Commit this file: when the original changes upstream, the next map marks every port whose recording it outdated.
