# Anti-UI-slop review rubric

A practical review checklist for catching "AI-slop" UI. Inspected 2026-10-10.

**On the term:** "UI slop" / "AI design slop" is a **community-convergent concept,
not a canonical framework** — do not attribute it to a single author. Sources
actually inspected (2026-10-10):

- GitHub wiki, ["Anti AI slop ban list"](https://github.com/Laith0003/ux-skill/wiki/Anti-AI-slop-ban-list) — 8 principles, "specificity beats genericity," per-pattern "do instead."
- [skills.sh "anti-ui-slop"](https://www.skills.sh/discountry/ritmex-skills/anti-ui-slop) — separates objective quality rules from judgment-based "slop rules"; warns that swapping one default for the next "safe" default just makes next year's slop.
- [MengTo "no-ai-design-slop"](https://tessl.io/registry/skills/github/MengTo/Skills/no-ai-design-slop) — passive quality gate that preserves product direction.
- Kosta Canatselis, ["Spot the Slop"](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) — "slop is design with no author."
- besthub, ["7 anti-generative principles"](https://www.besthub.dev/articles/7-anti-generative-design-principles-for-ai-assisted-ui-constrain-delete-iterate-e8abc6337227) — constrain → solution → review; avoid "design whack-a-mole."

**This does not replace GradTools' design system.** `docs/05_UI_DESIGN_SYSTEM.md`
already bans the main slop tells (glassmorphism, neon glow, multi-stop gradients,
dot-grid backgrounds, giant single-number stat cards, "three cards because three
looks good," bento-as-decoration, fake testimonials/stats, marketing hero rows —
see §"Explicitly banned") and states the guiding principles (legible density
over decorative spaciousness; restraint as credibility). This rubric is a
**review lens** that points at those rules; it adds no tokens or components.

## Two kinds of check — keep them separate

**A. Objective (pass/fail, measurable or observable)** — these are not matters of
taste; a failure is a defect regardless of aesthetic:

- [ ] **Contrast** ≥ WCAG AA (4.5:1 body, 3:1 large/UI) — verify, don't eyeball (`docs/27`).
- [ ] **Focus states** visible on every interactive element; tab order matches visual order.
- [ ] **Touch targets** ≥ 44px; hit area not smaller than the glyph.
- [ ] **State completeness:** every async surface has loading, empty, error, retry, and success states (not just the happy path).
- [ ] **Responsive:** no horizontal scroll / clipped controls / overlapping text at 320, 375, 768, 1024, 1440.
- [ ] **Interaction works:** every control navigates, mutates, opens a surface, or is disabled-with-a-reason — no dead affordances.
- [ ] **Colour is never the sole signal** (status, active nav, validation also carry shape/text/icon) — the project's standing rule.
- [ ] **Real content / no fake data:** no fabricated testimonials, reviews, stats, logos, or placeholder lorem shipped as if real.
- [ ] **Reduced motion** honoured (`prefers-reduced-motion`); no motion required to understand state.

**B. Judgment (is this choice authored, or a default?)** — reviewer argues each:

- [ ] **Specificity > genericity:** would this screen look identical in any other product? If yes, it's slop. Each notable choice should be derivable from *GradTools'* context (an academic tool shown to faculty), not "the statistical median of every Tailwind template."
- [ ] **Hierarchy:** the most important figure on the screen is the most prominent; secondary data recedes. No uniform wall where everything competes.
- [ ] **Density:** comparable data is dense and scannable (a marks table, SGPA across semesters), not one-number-per-giant-card. Tabular figures where digits must align (`docs/05`).
- [ ] **Purposeful components:** every card/border/panel groups genuinely related content (a card holding one number is a `docs/05` failure). Elevation/dividers used only where they signal real structure.
- [ ] **Decoration audit:** remove anything that isn't carrying information — gradients, glass, glow, floating shapes, decorative terminals, parallax (all already banned).
- [ ] **Motion restraint:** micro-interactions clarify a state change; none is ambient/looping/attention-grabbing for its own sake.
- [ ] **Replacement, not substitution:** when a slop tell is removed, the fix is a context-derived choice — not the next safe default.

## Per-screen pass (run A then B)

1. Screenshot the screen at phone + desktop width.
2. Run every **A** box; any failure is a bug to fix before shipping.
3. Run every **B** box; for each, write one sentence justifying the choice from GradTools' context — if you can't, it's a default to reconsider.
4. Record findings as fix / keep-with-reason. Prefer deletion over addition.

## Candidate GradTools screens for a later bounded UI pass

Reported for a **separate** implementation step (no redesign here). Ranked by
slop-risk × visibility:

1. **`/welcome` landing (`features/landing/LandingPage.tsx`)** — the only public,
   "marketing-shaped" page and the most slop-prone (hero/feature-card temptation).
   Highest value for the rubric.
2. **Dashboard (`features/dashboard/DashboardPage.tsx`)** — the stat-card
   anti-pattern's natural home; verify density/hierarchy against the rubric.
3. **Empty/error states** across results, attendance, import — the "state
   completeness" objective check most likely to find gaps.

No components or tokens were changed by this document.
