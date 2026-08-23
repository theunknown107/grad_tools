# 26 — Git and Development Workflow

**Status:** Phase 1 draft
**Context:** a solo developer using AI assistance heavily. The workflow is designed for that reality — lightweight enough for one person, rigorous enough that generated code is reviewed rather than trusted.

---

## 26.1 Repository

Single monorepo, pnpm workspaces (`06` §6.5). One repository keeps the shared Zod contract and the shared rules engine in a single atomic commit with their consumers — which is the entire reason they can be trusted to stay in sync.

**Repository is currently uninitialised.** `git init` is a Phase 2 task; Phase 1 produces documentation only.

## 26.2 Branching

Trunk-based with short-lived branches.

```
main ──●────●────●────●────●──►   always deployable, protected
        \      /      \    /
         ●────●        ●──●        feature branches, < 3 days
```

| Rule | Detail |
|---|---|
| `main` is always deployable | Every commit on `main` passes CI |
| Branches are short | Under 3 days; longer means the change is too large |
| No long-lived develop branch | Unnecessary ceremony for one developer |
| Release branches | Only if an Alpha hotfix is needed while `main` has moved on |

**Branch naming:** `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`, `security/` + a short slug. Example: `feat/sgpa-calculator`.

## 26.3 Commits

Conventional Commits, because the changelog is then generated rather than written.

```
<type>(<scope>): <subject>

<body — why, not what>

<footer — refs, breaking changes>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `security`.
Scopes: `rules`, `api`, `web`, `db`, `ingestion`, `docs`, `auth`, `pdf`, `notify`, `admin`.

```
feat(rules): add marks-needed calculator with three-threshold logic

Implements FR-006. The binding constraint is the maximum of the SEE
minimum (35% of the SEE scale) and the overall requirement
(CIE + SEE/2 >= target). Reports which constraint binds, because that
is the actionable part for a student.

Refs: 16_ACADEMIC_RULES_ENGINE.md §16.9, 22OB 6.3
```

**Commit bodies explain why.** The diff shows what. For anything touching the rules engine, the commit references the regulation clause — so a future reader can verify the code against the source without rediscovering it.

**Rules:** present tense, imperative; subject under 72 characters; one logical change per commit; never commit secrets, `node_modules`, build output or real student data; never commit a failing test to "fix later".

## 26.4 Pull requests

Even solo. A PR is the artefact that forces a diff to be read as a whole rather than typed incrementally, and it is where AI-generated code is actually reviewed.

```markdown
## What
One or two sentences.

## Why
Requirement ID (FR-xxx) or issue reference.

## How
Notable decisions and trade-offs.

## Testing
What was added; what was verified manually.

## Checklist
- [ ] Tests added at the risk-weighted level for this area (`22` §1)
- [ ] Error states handled
- [ ] Security impact considered (`13`)
- [ ] Accessibility verified (keyboard + axe)
- [ ] Documentation updated
- [ ] No secrets, no personal data
- [ ] Academic rules cite their clause
- [ ] Migration is expand/contract if schema changed
```

`main` is protected: CI must pass, no force-push, no direct commits.

## 26.5 Reviewing AI-generated code

This project uses AI assistance heavily, which introduces a specific failure mode: code that is fluent, plausible, and subtly wrong. Fluency is not correctness, and the review must target exactly the places where confident-looking code hides errors.

| Check | Why it matters here |
|---|---|
| **Does it actually implement the documented rule?** | Generated code often implements the *common* version of a rule rather than the *cited* one. The `(CGPA − 0.75) × 10` formula is the canonical example: it is what most sources say and it is wrong for this scheme |
| **Are the tests real, or do they assert the implementation?** | A test written from the same misunderstanding as the code passes and proves nothing |
| **Are the edge cases the actual edge cases?** | Generated tests favour round numbers; the real risks are 54/55, 59/60, CIE 19/20 |
| **Is there invented API surface?** | Options, parameters and helpers nobody asked for |
| **Is there speculative abstraction?** | Interfaces with one implementation, factories for one product, config for a constant |
| **Are errors handled or swallowed?** | A `catch` that logs and continues silently is a data-integrity risk |
| **Is anything reimplemented that already exists?** | Re-deriving something the shared package already provides |

**Rule for the rules engine specifically: every generated calculation is verified against the regulation clause by a human before merge, not against intuition and not against another calculator.** This is the single highest-value review activity in the project.

## 26.6 Code quality gates

| Gate | Tool | Blocking |
|---|---|---|
| Formatting | Prettier | Yes |
| Linting | ESLint + typescript-eslint | Yes |
| Accessibility lint | eslint-plugin-jsx-a11y | Yes |
| Security lint | eslint-plugin-security | Yes |
| Types | `tsc --noEmit`, strict | Yes |
| Tests | Vitest | Yes |
| Bundle size | size-limit | Yes (>10% regression) |
| Dependency audit | `pnpm audit` | Yes (high/critical) |
| Secret scan | gitleaks | Yes |

Custom lint rules worth the effort:
- `packages/academic-rules` may not import anything (zero-dependency invariant)
- No `dangerouslySetInnerHTML`
- No raw SQL outside the data layer
- Every Express route must declare an authorization guard
- No hard-coded colour or spacing values in components (design tokens only)

Pre-commit runs format, lint and typecheck on staged files plus the secret scan. Full tests run in CI, not pre-commit — a slow pre-commit hook gets bypassed with `--no-verify`, and a bypassed hook is worse than none.

## 26.7 Issue tracking

GitHub Issues with labels: `type:` (feature/bug/security/docs/chore), `priority:` (P0–P3, matching `02`), `area:` (matching commit scopes), `stage:` (experimental/alpha/future), and `blocked` / `needs-decision`.

`needs-decision` issues link to an entry in `32_OPEN_QUESTIONS_AND_DECISIONS.md`. That document is the single source of truth for open decisions; issues reference it rather than duplicating it.

**Bug reports must include** the academic context (scheme, semester, subject), what was expected versus shown, and — critically — **whether an academic number was wrong**. That last field routes the bug to Sev-1 (`24` §9).

## 26.8 Documentation as part of the definition of done

The 32 documents are living. A change that alters documented behaviour updates the document **in the same PR**, not afterwards.

| Change | Document to update |
|---|---|
| New/changed feature | `02`, and `03` if the flow changes |
| Schema change | `08`, `09` |
| API change | `10` |
| New dependency | `06` |
| Academic rule change | `16`, with the clause citation |
| New personal data field or third party | `12` **before implementation** (governance gate) |
| New threat or control | `13` |
| Architectural change | `07` |
| Decision made or reversed | `32` |

The `12` row is the strict one: adding a personal data field is **not implementable** until the privacy document is updated. Without that ordering, privacy documentation drifts behind the code within a single sprint (`12` §14).

## 26.9 Versioning and releases

Semantic versioning: `0.x.y` through experimental and Alpha (`1.0.0` implies a stability commitment not yet earned).

| Stage | Version |
|---|---|
| Experimental | `0.1.x` |
| Stage 2 testing | `0.2.x` |
| Alpha | `0.3.0` onward |

Releases are tagged `v0.3.0`, with a changelog generated from Conventional Commits and then **hand-edited for the user-facing sections** — a raw commit list is not release notes.

Every release records: version, date, scope, changelog, known issues, **data-source status**, test status, deployment status, rollback plan (`28`, `30`).

Data-source status is unusual in release notes and belongs here: users need to know which sources were healthy at release, and it makes source health a first-class release concern rather than an operational afterthought.

## 26.10 Migration handling

- Migrations live in `apps/api/migrations`, generated by `drizzle-kit` and **reviewed by hand** — generated migrations sometimes propose destructive changes that a review catches and a rubber stamp does not.
- One migration per PR wherever possible.
- Never edit a merged migration; add a new one.
- Expand/contract for anything breaking (`09` §10).
- The PR states the locking behaviour for any table over ~100k rows.

## 26.11 Repository hygiene

`.gitignore` covers `node_modules`, build output, `.env*` (except `.env.example`), coverage, Playwright artefacts, `*.pdf` outside `fixtures/`, and any real student data.

Committed fixtures: parser HTML snapshots (public pages), synthetic malicious PDFs for security tests, sample question papers **where licensing permits** (`17` §11), and anonymised grade cards with USN and name removed.

**Never committed:** real student personal data, real credentials, production dumps, unlicensed copyrighted documents.

## 26.12 Working agreement with AI assistance

Recorded because it materially shapes this project's risk profile.

1. **Documentation precedes implementation.** These 32 documents are the specification; code implements them rather than inventing alongside them.
2. **Academic rules are never generated from memory.** Every rule traces to a cited clause of a retrieved document. Phase 1 demonstrated why: the widely-repeated percentage formula is wrong for this scheme.
3. **Generated code is reviewed against the specification**, not against whether it looks reasonable.
4. **Tests are written to the requirement**, not to the implementation.
5. **A major architectural, product, security or privacy decision is escalated to the human**, never made silently — and once made, it is recorded in `32`.
6. **No implementation phase begins without explicit human approval** of the preceding phase.
