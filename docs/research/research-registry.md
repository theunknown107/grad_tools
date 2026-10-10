# Research registry

One row per supplied resource. **Inspected** = what was actually opened this
pass. **Status**: `verified-bounded` (primary source opened, specific claims
checked, but not exhaustively), `registered-unverified` (recorded from the brief,
not yet opened), `unresolved-identity` (name given, canonical source not yet
confirmed). **Decision**: Adopt / Adapt / Reference / Defer / Reject / Pending.

Findings are true as of the inspection date only. Re-validate before relying on
any row. See [`implementation-decisions.md`](./implementation-decisions.md) for
decision rationale and [`llm-providers.md`](./llm-providers.md) for the detailed
LLM findings.

## A. Free LLM APIs & model routing

| Resource | URL | Type | Licence | Inspected | Status | Decision | Caveats |
|---|---|---|---|---|---|---|---|
| awesome-freellm-apis | https://github.com/open-free-llm-api/awesome-freellm-apis | GitHub directory (README tables) | MIT | 2026-10-09 | verified-bounded | Reference / Defer | Self-contradictory counts (505+ / 134+ / 453); no structured-output info; "modalities" doesn't split input vs output; some "free" rows are credit-based. |
| freellm.net | https://freellm.net | Directory / comparison site + config generator | n/a (service) | 2026-10-09 | verified-bounded | Reference / Defer | "235 verified via live API"; sponsored listings; paid PLUS tier; some providers need phone verification. Establishes neither $0-per-read nor ZDR nor structured output. |
| Instagram post | https://www.instagram.com/p/DeB_xCxDT_F/ | Social post (promo) | n/a | not accessible | unverified | Reject-as-source | Login-walled; its "452+ APIs / 31 providers" claim is unverified and not matched by the primary repo. Use the repo/site, not the post. |

## B. UI libraries, design systems & assets

All rows below **inspected 2026-10-09** (homepage / repo opened; not exhaustive).
Findings are the resource author's claims unless marked independently verified.

| Resource | Canonical URL | Type | Licence | Status | Decision | Key finding / caveat |
|---|---|---|---|---|---|---|
| Watermelon UI | https://ui.watermelon.sh | Open-source React UI "platform" (copy-paste blocks/components/templates) | MIT on snippets; homepage names none | verified-bounded | Reject-as-default / Reference | A competing general-purpose component system. GradTools keeps **Shadcn/ui**; mine only a specific pattern if ever. New (Apr 2026). |
| Motion Primitives | https://motion-primitives.com · gh ibelick/motion-primitives | Copy-paste animated UI kit | **MIT (verified in repo)** | verified-bounded | Adapt (targeted) | motion.dev + Tailwind; shadcn-style CLI/copy-paste; beta; 6.5k★. Use specific micro-interaction patterns where motion aids understanding — not animation everywhere. |
| Haikei | https://haikei.app/ | Web app: data-driven SVG backgrounds (waves/blobs/gradients/low-poly) | "Free, no signup"; full terms not read | verified-bounded | Reference (optional assets) | PNG/SVG export. GradTools is a data tool — avoid decorative clutter; verify asset terms before any use. |
| Libraries.dev | https://libraries.dev/ | "UI effects for AI agents" (border beam, orbs, gooey, voice, bot avatars, liquid metal, image-gen); ships as agent prompts | 5 of 7 are MIT npm pkgs; Pro tier paid | verified-bounded | Reference / Defer | Flashy AI-app effects; not aligned with GradTools' academic-command-center restraint. At most one MIT accent, deferred. React 18+. |
| User Interface Wiki | https://userinterface.wiki/ | Demos + a skill, by raphaelsalaja (gh raphaelsalaja/userinterface-wiki) | not stated | verified-bounded | Reference | Interaction demos/patterns for inspiration. |
| UI Skills | https://ui-skills.com/ | Curated directory of design-engineering **agent skills** (gh ibelick/ui-skills, 9.4k★; authors incl. anthropics, shadcn, emilkowalski) | per-skill; site none stated | verified-bounded | Reference | Skill-discovery index; `npx ui-skills` / MCP. Overlaps this env's existing curated skills — don't bulk-install; check each before use. |
| Rams | https://rams.ai/ | Automated design-review tool: 348 rules, Skill + MCP + GitHub App + CI (HSLA0001 Inc) | free→$399/mo (paid tool) | verified-bounded | Reference (methodology) / Defer (tool) | Rule categories align with GradTools' UI/UX master rules + anti-slop posture; borrow the *checklist idea*, defer the paid service. No link to Dieter Rams on the page. |
| Designmd | https://designmd.co/ | Design-as-markdown resource (DESIGN.md ecosystem — design context for agents) | n/a | identity-partial / blocked (HTTP 403) | Reference | Could not load (anti-bot). DESIGN.md concept = exactly what GradTools already does via `docs/05` + tokens. Revalidate. |
| Designmd Supply | https://designmd.supply/ | Design-as-markdown assets (DESIGN.md ecosystem) | n/a | identity-partial / blocked (HTTP 429) | Reference | Could not load (rate-limited). Revalidate; verify asset licences before any use. |
| Agricidaniel "Compass" repo | **not found under this owner** | Agent instructions / rules repo (claimed) | unknown | unresolved-identity | Pending | Search found no `agricidaniel/compass`; only unrelated Compass projects. **Not guessed.** Needs a canonical URL from the user. |
| Apple design skill | `~/.claude/skills/apple-design/SKILL.md` (installed) | Installed agent skill | local | verified (local) | Adapt (already available) | Apple fluid-interface principles for web (springs, interruptibility, 1:1 pointer tracking, reduced-motion). Apply to gesture/sheet work per the frontend plan. |

## C. Skills & agent workflows

Resolved from B: **Apple design skill** = the installed `apple-design` skill
(inspected, local). **UI Skills** = `ibelick/ui-skills` directory (inspected).
**Compass repo** = unresolved (no `agricidaniel/compass` found). Detail and the
install-safety rules are in
[`skills-and-agent-workflows.md`](./skills-and-agent-workflows.md).

## D. Research expansion (inspected 2026-10-10)

| Resource | Canonical URL | Type | Licence | Status | Decision | Key finding / caveat |
|---|---|---|---|---|---|---|
| Anti-UI-slop | *(no canonical source — community concept)* [ban list](https://github.com/Laith0003/ux-skill/wiki/Anti-AI-slop-ban-list), [skills.sh](https://www.skills.sh/discountry/ritmex-skills/anti-ui-slop), [MengTo](https://tessl.io/registry/skills/github/MengTo/Skills/no-ai-design-slop), [Canatselis](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) | Design-critique principles | n/a | verified-bounded | **Adapt** | No canonical framework. Core: convergence to default templates = slop; split objective (contrast/a11y/states) from judgment (specificity/hierarchy/density); replace tells with context-derived choices. GradTools `docs/05` already bans the main tells → authored [`anti-ui-slop.md`](./anti-ui-slop.md) rubric, no new design system. |
| Dqnamo Kitchen | https://www.dqnamo.com/kitchen | Personal inspiration gallery | none stated | verified-bounded | **Reference-only** | NOT a library/tool/dependency — interface-study demos (tactile button, receipt printer, cassette player). No code/license/npm/repo exposed. Flourishes conflict with GradTools' "quiet tool" rules. Adopt nothing; copy no assets. |
| API Anything | https://github.com/goodnight000/api-anything | Dev tool: site→callable API (CLI/MCP/TS) | MIT | verified-local (installed) | **Adopt (dev tool only)** | Source-reviewed (only lifecycle script = `prepare`=tsc; `playwright-core` no browser DL; cookie access gated behind `login`). Installed **user-global** v0.1.0, tier-1 health check passed. NOT a GradTools dep; `login`/cookies NOT authorized. Setup/rollback: [`api-anything-setup.md`](./api-anything-setup.md). |
| Technical SEO / `llms.txt` | [Google robots intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro), [JS SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) | SEO guidance | n/a | verified (primary docs) | **Defer (documented)** | robots.txt is NOT an index-blocker (use `noindex`); SPA shared-shell risks soft-404/duplicates; `llms.txt` is an informal convention Google Search ignores. GradTools has no production domain → conditional checklist only: [`technical-seo-checklist.md`](./technical-seo-checklist.md). Instagram Reel (DcVYNPftRoV) login-walled, not accessed. |

## Revalidation policy

- LLM rows: re-check before adding any provider (model ids, $0 tier, ZDR, limits
  all drift). Treat anything older than ~30 days as stale.
- SEO/`llms.txt` rows: re-verify against Google Search Central (conventions shift).
- API Anything: re-review on version change; re-confirm before authorizing `login`.
- UI/asset rows: re-confirm licence at adoption time.
- `unresolved-identity` rows must be resolved to a canonical source before they
  can move to any decision other than Reject.
