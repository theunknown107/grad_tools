# API Anything — developer-tool setup record

Canonical: https://github.com/goodnight000/api-anything · License **MIT** ·
Installed & verified 2026-10-10. **User-level developer tool — NOT a GradTools
dependency.** No repository files were changed by this setup.

## What it is

"Turn any website into an API your agent can call." Headless Chrome records a
site's own browser traffic for example inputs and saves a reusable **operation**;
operations are then called over plain HTTP (tier 1), or via an in-page fetch /
browser (tiers 2–3), and return JSON. Callable from a CLI, a TS library, or an
MCP server. Ships 9 bundled sites with logged-out read operations.

## Source-level security review (before install)

- **License:** MIT. **Node:** `engines.node >= 22.13.0` (host has v22.23.2).
- **Lifecycle scripts:** the only script that runs on install is **`prepare`
  (`tsc -p tsconfig.build.json`)** — a local build. No `postinstall`/`preinstall`
  fetching or executing remote code in the package. (`npm ci` does run the
  standard `esbuild` platform-binary postinstall, fetched from the npm registry —
  normal and expected.)
- **Runtime deps:** `@modelcontextprotocol/sdk`, `node-html-parser`,
  **`playwright-core`** (uses an existing Chrome; pulls **no** browser binary),
  `tldts`, `zod`. Small, reputable surface.
- **Credential handling:** cookie/browser-profile access lives in `src/browser.ts`
  (`profileCookies`, `addCookiesToProfile`), `src/session.ts` (per-site jar under
  `~/.api-anything`, 0700 dirs / 0600 files) and `src/secrets.ts` (turns
  credentials into **references, never stored values**; a `--dry` call prints the
  request with credentials redacted). **All of this is gated behind the
  `login`/teach commands — none runs during install or a tier-1 call.**
- **Verdict:** satisfactory — no undisclosed credential access on the install/call
  path, no arbitrary remote execution. Proceeded with install; **did not** run
  `login` or touch any browser session.

## Install performed (reproducible)

Installed from a **dedicated clone** at `~/tools/api-anything` (kept for
inspection), rather than the README's throwaway `mktemp` clone:

```sh
git clone --depth 1 https://github.com/goodnight000/api-anything.git ~/tools/api-anything
cd ~/tools/api-anything
npm ci --no-audit --no-fund          # runs prepare=tsc build
npm install -g "$(npm pack --silent)"  # user-global install of the packed tarball
```

- **Install location (user-level, no admin):**
  `C:\Users\Salman Aslam Kadalgi\AppData\Roaming\npm\` (bin + `node_modules/api-anything`).
- **Version:** `api-anything` **0.1.0**.
- **CLI entry points:** `login`, `call`, `verify`, `sites`, `ops`, `heal`,
  `export`, `mcp`. **MCP entry point:** `api-anything mcp`.
- **Data dir:** `~/.api-anything` (override with `API_ANYTHING_HOME`). Not created
  until first use.

## Verification (non-destructive)

- Documented tier-1 health check (public API, no browser, no cookies):
  `api-anything call hacker-news search query=sqlite` → `{"ok":true,"class":"ok","tier":1,"data":[…]}` ✓
- `api-anything sites` → 9 bundled sites (airbnb, amazon, goodreads,
  google-flights, hacker-news, instagram, linkedin, x, youtube), logged-out reads.

## NOT done (requires separate, explicit authorization)

- **No `api-anything login`**, no browser-cookie import, no account sign-in (per
  the strict browser-session boundary). LinkedIn/X/Instagram authed ops are
  therefore unavailable until explicitly authorized per site.
- **No Claude Code MCP/skill wiring.** To avoid changing global agent config
  without need, I did **not** run step 4 of `INSTALL.md`. To enable it later
  (your call):
  ```sh
  claude mcp add --scope user api-anything -- api-anything mcp
  mkdir -p ~/.claude/skills/api-anything && cp "$(npm root -g)/api-anything/skills/api-anything/SKILL.md" ~/.claude/skills/api-anything/
  ```
  (A new agent session is needed to load the MCP tools.)

## Rollback / uninstall

```sh
npm uninstall -g api-anything           # remove the global CLI
rm -rf ~/tools/api-anything             # remove the dedicated clone
rm -rf ~/.api-anything                  # remove any data/sessions (only exists after use)
# if the MCP/skill wiring above was ever added:
claude mcp remove api-anything
rm -rf ~/.claude/skills/api-anything
```

## Limitations / unverified

- Only the **tier-1** path was exercised; tiers 2–3 (in-page fetch / browser) and
  the teach/`login` flows are **unverified** (require Chrome and, for authed
  sites, a login I did not perform).
- The "references, never values" guarantee was read in `src/secrets.ts` but not
  exercised end-to-end.
- No GradTools application integration is proposed; evaluate separately if ever.
