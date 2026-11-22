# Design systems & UI resources

**Inspected 2026-10-09 (bounded — homepage/repo opened, not exhaustive).** Rows
and licences are in the [registry](./research-registry.md#b-ui-libraries-design-systems--assets).
Findings are each author's claims unless marked independently verified.

## Binding GradTools constraint (applies to every resource)

GradTools uses **Shadcn/ui** with established design tokens and UI/UX master
rules (`docs/05_UI_DESIGN_SYSTEM.md`, `docs/27_ACCESSIBILITY_AND_RESPONSIVE_UX.md`;
identity: academic command-center, Linear-like hierarchy, **no generic AI-dashboard
look, no fake analytics, no decorative clutter**). So: reuse existing components
first; add compatible Shadcn pieces when needed; **never swap in a competing
general-purpose component library**; motion/assets only where they aid
understanding and clear accessibility (reduced-motion, contrast).

## Decision matrix (Phase B — evidence → decision; no code changed this pass)

| Resource | Decision | Why, mapped to GradTools |
|---|---|---|
| **Watermelon UI** (ui.watermelon.sh) | **Reject-as-default / Reference** | It's a whole competing component platform. Adopting it violates the one-system rule. Shadcn/ui stays. At most, study one specific pattern — never import the system. |
| **Motion Primitives** (MIT) | **Adapt (targeted), Defer adoption** | Compatible stack (motion.dev + Tailwind, copy-paste). When the frontend plan's identified motion opportunities are built, its patterns + the `apple-design` skill inform a *few* interruptible, reduced-motion-aware micro-interactions. Not a dependency; not animation everywhere. |
| **apple-design skill** (installed) | **Adapt** | Already available locally. Its fluid-motion principles (respond on pointer-down, 1:1 tracking, interruptibility, reduced-motion) are the right reference for any gesture/sheet work. No install needed. |
| **Haikei** | **Reference (optional), Defer** | A single hand-picked SVG background *might* suit a marketing/empty-state surface. For a data tool it's mostly clutter risk. Verify export terms if ever used. |
| **Libraries.dev effects** | **Reference / Defer** | Border-beam etc. are flashy AI-app effects at odds with the product's restraint. 5 are MIT. At most one subtle accent, deferred — no justification now. |
| **Rams.ai** | **Reference (methodology), Defer (tool)** | Its 348-rule critique categories echo GradTools' own UI/UX master rules and anti-slop review posture. Borrow the *checklist concept* for reviews; the hosted tool is paid → defer. |
| **User Interface Wiki** | **Reference** | Interaction demos/patterns for inspiration only. |
| **UI Skills** (ibelick/ui-skills) | **Reference** | Skill-discovery index. Overlaps the environment's existing curated skills; consult, don't bulk-install; vet each skill's source/licence first. |
| **Designmd .co/.supply** (DESIGN.md) | **Reference** | The "design-as-markdown-for-agents" idea is already embodied by GradTools' `docs/05` + tokens. Validates the approach; nothing to adopt. Sites were blocked (403/429) — revalidate. |
| **Agricidaniel Compass** | **Pending (unresolved)** | No canonical repo found; needs a URL from the user before evaluation. |

## GradTools opportunities (documented only — not implemented, per instruction)

1. **Motion pass** (when scheduled): apply `apple-design` + Motion Primitives
   patterns to the specific interactions the frontend plan flags, honouring
   `prefers-reduced-motion`. Its own approval/slice.
2. **Review checklist**: fold a Rams-style, category-based design-review pass
   into the existing UI/UX review practice (reference methodology, no tool).

Neither is a production-code change in this research pass.
