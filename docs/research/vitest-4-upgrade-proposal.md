# Vitest 3 → 4 security-upgrade proposal (REVIEW ONLY — not applied)

Prepared 2026-10-09. This clears the remaining open advisories from the security
pass. **No change has been made**: Vitest is still 3.2.7 and the advisories are
still open. Do not treat them as fixed until this upgrade is authorized, applied,
and verified.

## 1. Advisories and affected paths

| Advisory | Severity | Package | Vulnerable | Patched | Path | Current resolved |
|---|---|---|---|---|---|---|
| [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) | **Critical** | tinypool | ≤2.1.0 | ≥2.1.1 | `. > vitest > tinypool` | tinypool **1.1.1** |
| [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) | **Critical** | tinypool | <2.1.2 | ≥2.1.2 | `. > vitest > tinypool` | tinypool **1.1.1** |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | Moderate | vitest, @vitest/mocker | ≥2.1.0 <4.1.11 | ≥4.1.11 | `. > vitest (> @vitest/mocker)` | vitest **3.2.7** |

Both tinypool advisories are **prototype-pollution → RCE gadgets in worker
options** (dev/test-time worker pool). The Vitest one is **path traversal /
arbitrary file read via the mocker redirect**. All are in the **test toolchain**,
not shipped runtime code.

## 2. Minimum verified fixed versions

- **Vitest `>=4.1.11`** — fixes the mocker path traversal directly and pulls
  **tinypool `>=2.1.2`** (which satisfies both tinypool advisories).
- A direct `tinypool` override to ≥2.1.2 under Vitest 3 is **rejected**: Vitest 3
  targets the tinypool 1.x API; forcing 2.x risks breaking the worker pool. The
  supported path is the Vitest major upgrade.
- Related: `@vitest/coverage-v8` and `@vitest/mocker` must move to the **same 4.x
  line** as `vitest`.

## 3. Current state (verified)

- `vitest@3.2.7`, `tinypool@1.1.1`, `vite@7.3.6` (Vitest 4 supports Vite 6/7 — no
  Vite bump needed). Root `vitest.config.ts` already uses the **`projects:`** API
  (not the deprecated `workspace` file), which reduces migration cost.
- Suite size at last run: **159 files / 2873 tests** across projects `api`
  (node) and `web` (jsdom), plus the pure-package project.

## 4. Vitest 4 breaking changes relevant here (verify live at upgrade time)

> These are the areas to check against the [Vitest 4 migration guide](https://vitest.dev/guide/migration);
> confirm each against the repo during the upgrade rather than assuming.

1. **Node support:** Vitest 4 drops older Node lines — confirm CI/local Node meets
   the v4 minimum.
2. **Coverage:** `@vitest/coverage-v8` 4.x — default report/thresholds behavior and
   option names changed; re-check `coverage` config and the 100%-coverage gate on
   `packages/academic-rules`.
3. **Mocking/spies:** spy defaults and `vi.mock`/mocker resolution changed
   (the fixed mocker is part of this); re-run any redirect/alias mocks.
4. **Environment & pools:** default pool and `environment`/`environmentMatchGlobs`
   handling changed; the repo uses per-project `environment` (`node` / `jsdom`) —
   confirm those still resolve and that jsdom 28 is compatible.
5. **`deps` options:** `deps.inline` / `deps.external` moved under `server.deps`;
   grep configs for deprecated keys.
6. **Reporters / snapshot format:** confirm reporter names and that no snapshots
   shift format.

## 5. Staged migration plan

1. **Isolated branch/worktree** off `feat/figma-frontend`; preserve all dirty files.
2. Bump devDeps together: `vitest`, `@vitest/coverage-v8`, `@vitest/mocker` (if
   direct) to `^4.1.11`; `pnpm install`; confirm `tinypool` resolves ≥2.1.2 and
   `pnpm audit` drops the 2 criticals + the moderate.
3. Fix config per §4 (projects/environment/coverage/server.deps).
4. Run the suite **per project** first (`api`, then `web`), fixing API/mocking
   breakages in small groups, then the full run.
5. Re-run typecheck, lint, build, and `pnpm audit`.
6. Only then merge back.

## 6. Rollback

Single-commit/branch change: revert the `package.json` devDep bumps + restore the
prior `pnpm-lock.yaml`, `pnpm install`. Config edits revert with the branch. No
runtime/app code is touched, so rollback cannot affect shipped behavior.

## 7. Expected effect on tests / runtimes

- Risk concentrated in: mocker/spy-based tests, coverage gate, and any
  environment-glob assumptions. The bulk (plain unit/integration tests) should be
  unaffected.
- No production dependency changes; shipped app/API runtime is unchanged.

## 8. Verification checklist (must all pass before declaring fixed)

- [ ] `pnpm audit` → 2 tinypool criticals **and** the vitest/mocker moderate gone
- [ ] Full monorepo suite green (all projects), no reduction in test count
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm build` clean
- [ ] `packages/academic-rules` coverage gate still enforced
- [ ] `git diff` limited to `package.json`, `pnpm-lock.yaml`, and vitest config(s)

**Authorization required before applying.** Do not suppress the open advisories in
the meantime.
