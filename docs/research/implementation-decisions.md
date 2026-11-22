# Decision ledger

Outcomes for each evaluated resource. **Adopt** (implement), **Adapt** (useful,
modified to fit), **Reference** (inspiration only, no code), **Defer** (promising,
not yet justified), **Reject** (unsuitable/insecure/duplicative). Do not
reintroduce a Reject without new evidence.

| Resource | Decision | Rationale (dated 2026-10-09) |
|---|---|---|
| awesome-freellm-apis | Reference / Defer | Real, MIT, active, but establishes none of GradTools' routing requirements ($0-per-read, ZDR, structured output). Useful only as a discovery shortlist for OpenRouter-routable free vision+JSON models. No code change without per-model verification + approval. |
| freellm.net | Reference / Defer | Same data as above with a UI/config generator; sponsored + paid elements. Discovery aid only. |
| Instagram post (DeB_xCxDT_F) | Reject-as-source | Login-walled; its counts are unverifiable and unmatched by the primary repo. Never cite a social post as the source of a technical claim. |
| New LLM provider in GradTools | **Defer (needs approval)** | GradTools already has a best-practice free-only router. Any addition is a 1–2 model append behind it, each with a $0-verification + privacy review + failure test. New infra/providers require explicit user approval (Phase 6 rule). |
| Watermelon UI (ui.watermelon.sh) | Reject-as-default / Reference | Competing component platform; Shadcn/ui stays the one system. MIT snippets; mine a single pattern at most. |
| Motion Primitives (MIT) | Adapt (targeted) / Defer | Compatible (motion.dev + Tailwind, copy-paste). Use a few interruptible, reduced-motion micro-interactions when a motion pass is scheduled — not a dependency, not everywhere. |
| apple-design skill (installed) | Adapt | Already local; the reference for gesture/sheet/spring work. |
| Haikei | Reference / Defer | At most one hand-picked SVG background for a marketing/empty surface; clutter risk for a data tool; verify terms. |
| Libraries.dev effects | Reference / Defer | Flashy AI-app effects vs. the product's restraint; 5 MIT; one subtle accent at most, deferred. |
| Rams.ai | Reference (methodology) / Defer (tool) | Borrow the category-based review checklist idea; hosted tool is paid. |
| User Interface Wiki | Reference | Interaction demos only. |
| UI Skills (ibelick/ui-skills) | Reference | Skill-discovery catalogue; overlaps existing curated skills; vet before use, don't bulk-install. |
| Designmd .co/.supply (DESIGN.md) | Reference | Design-as-markdown idea already embodied by `docs/05` + tokens; sites blocked (403/429), revalidate. |
| Agricidaniel "Compass" repo | Pending (unresolved) | No `agricidaniel/compass` found; needs a canonical URL. Not guessed. |

## Standing constraints that gate every future "Adopt" here

1. **No competing component library.** Shadcn/ui + the existing design tokens
   remain the system. Add compatible Shadcn components; don't swap the system.
2. **No gratuitous motion or decoration.** Motion must aid understanding;
   backgrounds/assets must earn their place and clear accessibility (reduced
   motion, contrast).
3. **No new dependency where existing capability suffices**; pin/constrain
   versions per project convention; verify licence before copying code/assets.
4. **AI never replaces deterministic academic rules.** AI reads documents; the
   engine computes facts.
5. **No new infra/providers/paid services without explicit approval**; never run
   remote install scripts blindly; never send secrets or student data to a
   third party to "test" it.

## This session's net effect on GradTools code

**None.** The only files added are this `docs/research/` knowledge base. All
adoption of external material is Defer/Pending pending inspection and/or approval.

## Research expansion decisions (2026-10-10)

| Resource | Decision | Rationale |
|---|---|---|
| Anti-UI-slop | **Adapt** | Authored a review rubric ([`anti-ui-slop.md`](./anti-ui-slop.md)) that references the existing `docs/05` bans and adds an objective-vs-judgment split + per-screen checklist. No design system, tokens, or components changed. Community concept — no canonical framework claimed. |
| Dqnamo Kitchen | **Reference-only / Reject** | Inspiration gallery, no code/license exposed; flourishes conflict with GradTools' design rules. Registry row only; nothing adopted. |
| API Anything | **Adopt as a user-global dev tool** | MIT, source-reviewed (no remote-exec on install; cookie access gated behind `login`). Installed user-global v0.1.0 + tier-1 health check. **Not** a GradTools dependency; **no** `login`/browser-cookie authorization; no Claude Code MCP/skill wiring (offered separately). |
| Technical SEO / `llms.txt` | **Defer (documented)** | No production domain → cannot configure/validate indexing. Conditional checklist authored; robots.txt is not an index-blocker (`noindex` is); `llms.txt` is experimental and ignored by Google Search. No SEO files created. |

**GradTools code change this pass:** **none** (docs only). Global filesystem
change this pass: API Anything installed user-global (outside the repo) — see
[`api-anything-setup.md`](./api-anything-setup.md).
