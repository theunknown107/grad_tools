# GradTools

A student-facing academic utility layer that brings routine academic workflows and information into one place.

Built for students following the **VTU 2022 scheme (22OB)**.

> GradTools is an independent student project. It is not affiliated with, endorsed by, or connected to Visvesvaraya Technological University.

## Status

**Milestone M3 complete.** The rules engine and the experimental vertical slice are built and browser-accessible. There is no API, no database, no authentication and no deployment yet: those are later, individually approved milestones.

| Component                 | State                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/academic-rules` | Implemented, 100% covered                                                                                |
| `apps/web`                | Experimental vertical slice: dashboard, SGPA/CGPA, attendance, bunk planner, results, timetable, profile |
| Testing infrastructure    | 366 tests, plus a real-browser visual and accessibility harness                                          |
| API, database, auth       | **Not started** — later milestones                                                                       |

Stage 1 is genuinely local-first: everything a student enters stays in their browser, and the app makes no network call for student data.

```bash
pnpm install
pnpm --filter @gradtools/web dev     # http://localhost:5173
```

## Documentation

`docs/` holds 33 approved documents that are the source of truth for this project. Code implements them; it does not diverge from them silently.

Start with [`docs/01_PRODUCT_VISION.md`](docs/01_PRODUCT_VISION.md), then [`docs/07_SYSTEM_ARCHITECTURE.md`](docs/07_SYSTEM_ARCHITECTURE.md).

**[`docs/16_ACADEMIC_RULES_ENGINE.md`](docs/16_ACADEMIC_RULES_ENGINE.md) is the canonical source for every academic calculation.** No other document, module or screen may define these rules.

## Requirements

- Node 22+
- pnpm 10+

## Getting started

```bash
pnpm install
pnpm verify     # format check, lint, typecheck, tests, build
```

Individual steps:

```bash
pnpm test           # run the suite
pnpm test:watch     # watch mode
pnpm test:coverage   # coverage (academic-rules must stay at 100%)
pnpm lint
pnpm typecheck
pnpm build
```

## Repository layout

```
apps/                    web app (later milestone)
services/                API (later milestone)
packages/
  academic-rules/        pure, zero-dependency academic calculations
docs/                    33 approved project documents
tests/                   cross-cutting suites (later milestones)
```

## The academic rules engine

`packages/academic-rules` is the project's most important architectural boundary.

```ts
import { calculateSGPA, calculatePercentage, vtu2022RuleSet } from '@gradtools/academic-rules';

const sgpa = calculateSGPA(
  [
    { subjectCode: 'BCS301', credits: 4, gradeLetter: 'A' },
    { subjectCode: 'BCS302', credits: 4, gradeLetter: 'A+' },
  ],
  vtu2022RuleSet,
);

if (sgpa.ok) {
  console.log(sgpa.value); // 8.5
  console.log(sgpa.explanation.formula); // "SGPA = Sum(Ci x Gi) / Sum(Ci)"
  console.log(sgpa.explanation.clause); // "22OB 6.6(2a)"
}
```

Its invariants, enforced by lint **and** by `test/purity.test.ts`:

1. **Zero dependencies, zero I/O.** No Node built-ins, no browser globals, no clock, no randomness. It runs identically in a browser and on a server.
2. **Every calculation takes an explicit `RuleSet`.** There is no overload that omits it, so nothing can compute an academic number without stating which scheme's rules apply.
3. **Rules are data, not code.** Every threshold, band and formula lives on the rule set. Supporting another scheme is a new rule set, never a new branch.
4. **Every result is discriminated.** `NaN`, `Infinity` and silent clamping never reach a caller; an impossible input returns an explicit, explained failure.
5. **Every result carries its derivation.** A caller structurally cannot display a number without also having its formula, inputs, steps and regulation clause.
6. **No AI, ever.** Deterministic arithmetic only — see [`docs/19_RECOMMENDATION_AND_AI_POLICY.md`](docs/19_RECOMMENDATION_AND_AI_POLICY.md).

### One rule worth knowing

The VTU 2022 regulation states **`Percentage = CGPA × 10`** (clause 22OB 6.7, with a worked example of CGPA 8.20 → 82.0%).

Essentially every third-party VTU calculator publishes `(CGPA − 0.75) × 10`, which would give 74.5% for that same example — a 7.5 point difference, enough to change a class classification. That formula does not appear in the 2022 regulation, is not implemented here, and eight regression tests exist to keep it that way.

## Unresolved rules

Some behaviour is genuinely not stated in the source regulation. Where that is true, the engine **refuses to compute** rather than guessing, returning `unverified_rule`:

| Grade         | Status                                                              |
| ------------- | ------------------------------------------------------------------- |
| `AB` (Absent) | Grade-point behaviour not stated in 22OB 6.2 — see `docs/32` OQ-018 |
| `IC`, `W`     | Placeholders with no grade point of their own                       |

Filling these in requires verification against a real grade card or an authoritative clause, not an assumption.

## Contributing

See [`docs/26_GIT_AND_DEVELOPMENT_WORKFLOW.md`](docs/26_GIT_AND_DEVELOPMENT_WORKFLOW.md).

Every change touching an academic rule must cite its regulation clause, and is verified against the source document rather than against another calculator.
