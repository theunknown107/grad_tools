# 05 — UI Design System

**Status:** Phase 1 draft
**Scope:** visual language and component contracts. Interaction behaviour is in `04_UX_SPECIFICATION.md`.

---

## 5.1 Design principles

1. **Legible density over decorative spaciousness.** A student comparing eight subjects needs them on one screen. Giant cards with one number each are the single most common failure of student dashboards.
2. **Type carries the hierarchy, not colour.** Colour is reserved for status meaning. If a design reads correctly in greyscale, it will read correctly for a colour-blind user and in bright sunlight.
3. **Restraint as a credibility signal.** This product will be shown to faculty. Neon gradients and glassmorphism read as a toy; quiet, precise typography reads as a tool.
4. **One accent colour.** Everything else is neutral plus semantic status colours.
5. **Every visual element earns its pixels.** No decorative illustration, no background patterns, no unnecessary elevation.

### Explicit anti-patterns (prohibited)

- Walls of large cards each containing one number
- Invented metrics: "productivity score", "study streak", "academic health"
- Gauges, radial progress rings and donut charts for single values
- Glassmorphism, heavy blur, neon glow, multi-stop gradients
- Animated counters that tick up on load
- Skeleton screens whose shape does not match the loaded content
- Charts without axis labels or with fewer than 3 data points
- Icon-only buttons without an accessible label
- Colour as the sole carrier of meaning
- Dark patterns around account creation, notification opt-in or deletion

## 5.2 Colour tokens

Defined as CSS custom properties. Light is the base; dark redefines only the values.

### Neutrals

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0F1115` | Page background |
| `--surface` | `#F7F8FA` | `#161A21` | Cards, panels |
| `--surface-raised` | `#FFFFFF` | `#1D222B` | Dialogs, popovers |
| `--border` | `#E3E6EB` | `#2A303B` | Hairlines, dividers |
| `--border-strong` | `#C8CDD6` | `#3A4250` | Input borders |
| `--text` | `#12151A` | `#EEF1F5` | Primary text |
| `--text-muted` | `#5B6472` | `#9AA4B2` | Secondary text |
| `--text-subtle` | `#67707D` | `#8B95A3` | Timestamps, captions |

### Accent and status

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--accent` | `#1F5FD6` | `#5B93F5` | Primary actions, links, focus |
| `--accent-weak` | `#EAF1FD` | `#16243D` | Accent backgrounds |
| `--success` | `#136B33` | `#4ADE80` | Safe attendance, passed, verified |
| `--warning` | `#B45309` | `#FBBF24` | Below requirement, stale data, unverified |
| `--danger` | `#B91C1C` | `#F87171` | DX risk, failed, destructive |
| `--info` | `#0E7490` | `#22D3EE` | Neutral informational |

**Contrast:** every text/background pairing meets WCAG AA (4.5:1 body, 3:1 large text and UI boundaries) in both themes. This is verified by an automated test, not by eye — see `22` §Accessibility tests.

> **Corrected during M3 implementation.** The values originally published here were asserted, not measured, and two of them failed:
>
> | Token | Was | Measured | Now | Now measures |
> |---|---|---|---|---|
> | `--text-subtle` (light) | `#828C9B` | **3.40:1** on `--bg` | `#67707D` | 5.01:1 |
> | `--text-subtle` (dark) | `#6F7987` | **3.95:1** on `--surface` | `#8B95A3` | 5.75:1 |
> | `--success` (light) | `#15803D` | 4.50:1 on `--success-weak`, rejected by axe at 13px | `#136B33` | 5.93:1 |
>
> Both were caught by the axe-core sweep in `tests/visual-qa.mjs`, which is exactly the automated check this section promised. The lesson is recorded rather than quietly patched: a documented contrast claim is worth nothing until something measures it.

**Semantic pairing rule:** status colour never appears alone. Every status is colour + text label + icon shape. The attendance states are `Safe` (check), `Below requirement` (triangle), `DX risk` (octagon).

## 5.3 Typography

| Role | Font | Size / line-height | Weight |
|---|---|---|---|
| Display (the answer) | Inter | 40 / 44 | 600 |
| H1 | Inter | 28 / 34 | 600 |
| H2 | Inter | 22 / 28 | 600 |
| H3 | Inter | 18 / 24 | 600 |
| Body | Inter | 16 / 24 | 400 |
| Body small | Inter | 14 / 20 | 400 |
| Caption | Inter | 13 / 18 | 400 |
| Numeric / tabular | Inter (tabular figures) | inherits | 500 |
| Code / subject codes | JetBrains Mono | 14 / 20 | 400 |

**Base size never below 16 px for body text** — this is a mobile product and 14 px body text is a readability failure on a phone in sunlight.

**Tabular figures (`font-variant-numeric: tabular-nums`) are mandatory** in every table, grade card and calculator column so digits align vertically. Without this a marks table looks visibly wrong.

Font loading: self-hosted, `font-display: swap`, subset to Latin, preloaded for the body weight only. Fallback stack: `Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

## 5.4 Spacing and layout

4 px base scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

| Token | Value | Use |
|---|---|---|
| `--space-1` … `--space-9` | 4 … 64 px | General spacing |
| `--gutter-mobile` | 16 px | Page horizontal padding < 768 |
| `--gutter-desktop` | 24 px | Page horizontal padding ≥ 768 |
| `--content-max` | 1200 px | Max content width |
| `--reading-max` | 720 px | Max width for prose (syllabus, policies) |

Grid: 4 columns mobile, 8 tablet, 12 desktop, 16/24 px gaps.

## 5.5 Breakpoints

| Name | Range | Notes |
|---|---|---|
| `xs` | < 480 | Small phones — must be tested, not an afterthought |
| `sm` | 480–767 | Phones |
| `md` | 768–1023 | Tablets, small laptops |
| `lg` | 1024–1439 | Laptops |
| `xl` | ≥ 1440 | Large screens; content stays capped at `--content-max` |

Mobile-first CSS: base styles target `xs`, media queries only add.

## 5.6 Surfaces, borders, elevation

Elevation is expressed primarily by **border and background**, not shadow. Shadows are reserved for genuinely floating layers.

| Level | Treatment | Use |
|---|---|---|
| 0 | `--bg` | Page |
| 1 | `--surface` + 1 px `--border` | Cards, list rows |
| 2 | `--surface-raised` + shadow-sm | Popovers, dropdowns |
| 3 | `--surface-raised` + shadow-md | Dialogs, bottom sheets |

**Z-index scale** (added in M3, applying the UI/UX Pro Max `z-index-management` rule): `--z-base: 0`, `--z-sticky: 10`, `--z-nav: 20`, `--z-overlay: 30`, `--z-toast: 50`. Components reference these tokens; arbitrary `z-index` values are not used.

```
--radius-sm: 6px    inputs, chips
--radius-md: 10px   cards, buttons
--radius-lg: 14px   dialogs, sheets
--shadow-sm: 0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.08)
--shadow-md: 0 4px 12px rgba(0,0,0,.10)
```

In dark mode shadows are weaker and separation comes from `--border`, since shadows are nearly invisible on dark backgrounds.

## 5.7 Components

### Button

| Variant | Use | Style |
|---|---|---|
| Primary | The one main action per screen | `--accent` fill, white text |
| Secondary | Alternative actions | `--surface` fill, `--border-strong` |
| Ghost | Tertiary, toolbar | Transparent, text `--accent` |
| Danger | Destructive | `--danger` fill |

Sizes: `sm` 32 px, `md` 40 px, `lg` 48 px. **Minimum touch target 44×44 px** — a 32 px button gets invisible padding to reach it. States: default, hover, active, focus-visible (2 px `--accent` ring, 2 px offset), disabled (60% opacity, `cursor: not-allowed`), loading (spinner replaces label, width preserved to prevent layout jump).

### Input

40 px height, 1 px `--border-strong`, `--radius-sm`. Always a visible `<label>`. Error state: `--danger` border plus a message node referenced by `aria-describedby`. Numeric inputs use tabular figures and `inputmode="numeric"`.

### Card

`--surface`, 1 px `--border`, `--radius-md`, 16 px padding (20 px desktop). Optional header row with title and one action. **A card must contain related content, not a single number.** A card holding only "CGPA 8.24" is a design failure — it should be a stat row inside a card with the other academic figures.

### Stat row (replaces the "stat card" anti-pattern)

```
┌──────────────────────────────────────────────┐
│ Academic summary                             │
│                                              │
│ CGPA        8.24    82.4%   First Class Dist │
│ Credits     112 earned · 148 required        │
│ Backlogs    1 active (CS304)                 │
└──────────────────────────────────────────────┘
```

Dense, comparable, scannable — one card, three facts, no wasted space.

### Table

Header row `--surface` with 600 weight, 13 px, uppercase-free. Rows 44 px minimum. Zebra striping is **not** used; a 1 px `--border` row separator is used instead (striping fights with status colours). First column sticky on mobile with a scroll shadow. Numeric columns right-aligned with tabular figures. Sortable headers carry `aria-sort`.

### Status pill

Small, `--radius-sm`, 12/16 type, icon + label. Background is the status colour at ~12% alpha, text is the full-strength status colour, meeting 4.5:1.

### Chart

Charts appear only where a trend genuinely exists.

- Allowed: line (SGPA across semesters), horizontal bar (module frequency), stacked bar (CIE vs SEE split).
- Prohibited: pie, donut, radial gauge, 3D anything, sparklines without axis context.
- Every chart has axis labels, units and an accessible table alternative (`<figure>` + visually-hidden `<table>`).
- Minimum 3 data points; below that, show the numbers as text instead.
- Colours come from the status/accent tokens, never a rainbow scale.

### Provenance chip

```
[ (i) vtu.ac.in · 22 min ago ]
```
Caption type, `--text-subtle`, opens the provenance sheet on activation. Appears wherever external data is displayed (`04` §4.10).

### Dialog / bottom sheet

Dialog on desktop (max 560 px, centred), bottom sheet on mobile (max 90 vh, drag-to-dismiss plus a visible close button). Focus trapped, `Esc` closes, backdrop `rgba(0,0,0,.5)`, scroll locked behind.

### Empty state

Icon (24 px, `--text-subtle`), one line of explanation in body type, one primary button. No illustration, no heading larger than H3.

## 5.8 Iconography

Single set (Lucide), 1.5 px stroke, 20 px default / 16 px inline / 24 px navigation. Icons never carry meaning alone: every icon-only control has `aria-label` and a tooltip. Status icons are shape-differentiated so they are distinguishable without colour.

## 5.9 Motion

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 120 ms | Hover, focus, colour change |
| `--motion-base` | 200 ms | Expand/collapse, toast |
| `--motion-slow` | 280 ms | Sheet, dialog entry |
| easing | `cubic-bezier(.2,0,0,1)` | Enter |
| easing-exit | `cubic-bezier(.4,0,1,1)` | Exit |

Animate `transform` and `opacity` only. Exits are faster than entries. Nothing loops. No animated number counters.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
}
```
Reduced motion removes movement but never removes the state change itself.

## 5.10 Theming

Three settings: light, dark, system (default). Implementation: tokens on `:root`; a `@media (prefers-color-scheme: dark)` block for the system case; a `[data-theme="dark"]` / `[data-theme="light"]` attribute for the explicit override, so the toggle wins in both directions. The chosen theme is written to local storage and applied by a small inline script before first paint to prevent a flash.

## 5.11 Density

Two modes, since Persona A (phone, glance) and Persona B (laptop, comparison) want different things:
- **Comfortable** (default on mobile): 44 px rows, 16 px card padding.
- **Compact** (opt-in, desktop): 36 px rows, 12 px padding, for long grade tables.

Touch targets never shrink below 44 px on touch devices regardless of density.

## 5.12 Content-specific patterns

### Academic number display
The value is Display type; its qualifier sits directly beneath in caption type; the derivation trigger follows.
```
8.24
CGPA · 4 semesters · 112 credits
[ How this was calculated ]
```

### Attendance meter
A horizontal bar with a marked threshold at 85% and a second at 75%, the current value labelled numerically. Not a radial gauge.

### Grade badge
Fixed-width monospace badge showing the letter and, on hover/focus, the grade point and mark range.

## 5.13 Implementation notes

- CSS custom properties for all tokens; no hard-coded colour or spacing in components.
- **Implemented with plain CSS Modules rather than Tailwind** (M3 decision, `32/ED-21`). This section already warned that Tailwind decays the token system unless arbitrary values are lint-blocked; CSS Modules reach the same result with no configuration to maintain and no escape hatch to police. Every declaration references a `var(--token)`.
- Component library: build the ~15 components listed here rather than adopting a large kit. Use unstyled, accessible primitives (Radix) for dialog, popover, select and tabs — these are the ones that are genuinely hard to get right for keyboard and screen readers.
- Every component ships with its states documented and an accessibility note.

## 5.14 The M9.3 redesign — containers, hierarchy and density

### What was wrong

The interface was functionally complete and read like an internal admin tool.
One measurement explains most of it: **`Panel` was used 46 times, 17 of them on
the dashboard alone.** Every region of every page therefore carried the same
background, the same border and the same radius, so nothing could be more
important than anything else. A screen made entirely of equal boxes has no
hierarchy — it just has boxes.

The consequences were measurable rather than a matter of taste:

| Page | Before | After |
|---|---|---|
| Dashboard (1280) | 2,053 px | **1,101 px** |
| Dashboard (390) | 2,819 px | **1,399 px** |
| Attendance (1280) | 2,049 px | **1,353 px** |
| Question papers (1280) | 7,436 px | **5,031 px** |

Results grew by 3% (2,312 → 2,392 px) because subject **names** were added
beside their codes. That is the trade made deliberately: a line per subject buys
"Database Management Systems" instead of `BCS403`.

### The rule

**A border clarifies a grouping; it does not draw a box.** Where a heading and
some space already say "these things belong together", a border adds weight and
no information.

So `Panel` is now a section by default — heading, spacing, content — and takes
`boxed` for the few places a real container is earned: a form, an embedded
document, a distinct sub-surface. Those places now stand out because they are
rare.

### The primitives

`components/ui/layout.tsx`:

| Primitive | For |
|---|---|
| `Section` | A titled region. No border, no background |
| `MetricStrip` | A dense row of figures, grouped rather than stretched |
| `Rows` / `Row` | A list separated by hairlines, with an optional lead, meta and trailing column |
| `Bar` | A percentage as a plain horizontal bar — never a gauge or a ring |
| `Empty` | One sentence and at most one action |
| `LoadError` | One sentence and a retry |
| `Skeleton` | A placeholder shaped like its content, silent under `prefers-reduced-motion` |

### Metrics are information, not statistics

22px, not 40px, and grouped at the start of the line rather than stretched edge
to edge. Four figures spread across a full-width row stop reading as one summary
and start reading as four unrelated announcements. Tabular figures so a column
aligns on the decimal point.

A figure that does not exist is an em dash. **No SGPA is ever projected for a
semester still running.**

### Measure

`--content-max` went from 1200px to **960px**. Beside a 244px sidebar the old
value produced roughly 120-character lines — about double a comfortable measure.

### A latent defect found and fixed

Six stylesheets referenced tokens that do not exist — `--color-text-muted`,
`--color-border`, `--text-sm`, `--text-xs`, `--text-lg`, `--ok`,
`--warn-border`, `--text-base`, `--text-xl` — mostly introduced with the papers
and auth screens. CSS custom properties fail silently, so those rules had been
inheriting or falling back since M8 and nobody could see it.

All 33 references now resolve, and a check for undefined tokens is part of the
visual QA script. Genuinely component-scoped properties (`--accent-mode`,
`--state-accent`) are declared where they are used and are not affected.

## 5.15 Anti-template constraints (permanent)

GradTools is an application, not a landing page. The following are prohibited
unless a specific product requirement demands one and the owner approves it.

**Aesthetic:** AI-purple or violet themes · black-and-neon palettes · neon
accents without semantic purpose · glassmorphism or frosted containers ·
glowing orbs · gradient blobs · dot-grid backgrounds · decorative terminal
windows · animated gradients · parallax · decorative floating shapes.

**Structure:** marketing hero sections · feature-card rows · exactly three cards
because three looks good · bento grids as decoration · giant identical cards ·
huge radii or shadows on everything · decorative left stripes on ordinary
content · huge empty-state cards with a large call to action.

**Content:** fake testimonials, reviews, statistics or social proof · pricing
tiers · Free/Pro/Enterprise framing · "AI-powered", "next generation",
"revolutionary" · "it's not X, it's Y" · checkmark marketing lists · emoji as
navigation or section icons · sparkle icons.

**Motion:** hover arrows on every link · shimmer · bouncing · scroll-triggered
decoration · excessive micro-animation.

The build carries **one** keyframe animation (a skeleton pulse), and it is
suppressed under `prefers-reduced-motion`.

**The objective is not minimalism. It is appropriateness.** Replacing a
prohibited pattern with a visually equivalent generic one is not compliance.

## 5.16 The M9.4 visual language

M9.3 fixed the structure. Every screen had the right information in the right
order, and it still looked like an internal tool — correct, and anonymous.
M9.4 gives the product a face.

### The references, and what they actually were

Five images were supplied. Grouped by content rather than by filename:

| | What it is |
|---|---|
| Three images | One marketing site for a developer product: violet-black ground, one soft radial glow, light widely-tracked display type with a single bolded phrase, low-contrast panels defined by a hairline rather than a fill, pill buttons, one glowing primary action |
| One image | A task-management **application**: deep ground, narrow sidebar, tinted selected row, small modules in a right rail, chips, compact task rows |
| One image | Four **phone** screens of a travel app: lavender-white ground, white modules at a large radius, solid near-black pill buttons, circular icon buttons, tinted status chips, bottom navigation with an active indicator |

**Three of the four "desktop" references are a landing page**, and GradTools is
not one. What was taken from them is atmosphere, type and surface treatment.
What was ignored is everything a marketing page does that an application must
not: the hero, the centred manifesto, the decorative 3-D artwork, the
feature-card grid, the closing call to action. The single reference that is a
real application contributed the parts an application needs — sidebar, selected
state, module scale, chips, dense rows.

### The rule the mobile reference forced

The obvious reading of "dark desktop, light mobile" is to key the theme to the
viewport. It is wrong, and it looks right until it is built: the product then
changes colour when a window is dragged across 768px, a tablet is two different
applications depending on how it is held, and the one signal that actually says
what a person wants — the system preference — is ignored.

**The viewport decides density and chrome. The system decides theme.**

Dark is the default and the identity, at every width. The light theme is the
mobile reference's lavender palette and arrives when the OS asks for it. What
the mobile reference really contributes is structural, and survives in both
themes: large rounded modules, a solid high-contrast pill for the primary
action, circular icon buttons, a bottom bar with an active indicator, and soft
tinted chips.

### Two violets, because one cannot do both jobs

`--accent` is a **text** colour and must clear 4.5:1 on the ground.
`--action-bg` is a **fill** and must clear 4.5:1 against the white sitting on
it. A single mid-violet fails one or the other, and M9.4 began by finding
exactly that failure: `.primaryLink` on the account screen was white text on
`--accent` at **2.72:1**.

`--action-bg` is violet in the dark theme and near-black ink in the light one —
the mobile reference's black pill. One rule underneath both: *the most confident
fill this ground allows*. It is one button, not two.

### Glow and ambience are different things

| | What it is | How many |
|---|---|---|
| **Ambience** (`--ambient`) | One soft violet radial, fixed behind the window | **One per page.** Fixed, not scrolling: a glow that scrolls away is decoration; one that stays is a room |
| **Glow** (`--glow-accent`) | A focal cast under a single element | **One per screen.** The primary action, or the brand mark. A second one makes both meaningless |

The sidebar's selected item deliberately does **not** glow. There is a selected
item on every screen, and something that is always lit is not emphasis.

### Typography

The references' headings are **light and widely set**, not bold and tight. The
hierarchy comes from size, colour, and from bolding one phrase inside an
otherwise light line — never from making every heading heavy. Page titles and
the dashboard's semester heading are `--weight-light` with `--tracking-display`.

The top of the scale came down: display 40 to 32, h1 28 to 25, h2 22 to 19.
Body and below are unchanged, because an academic record is read, not admired.
Form fields are pinned to at least 16px so iOS does not zoom the page on focus.

### Where the shapes come from

| Token | Value | Why |
|---|---|---|
| `--radius-xl` | 22px | Mobile modules only. The reference's phone cards are markedly rounder than its desktop panels, and that difference is real |
| `--radius-lg` | 16px | The same container on a desktop, where a 22px corner on a wide form looks inflated |
| `--radius-pill` | 999px | Every button, every chip. It is the one shape both reference groups share |

### The metric strip changes shape, not content

On a phone it is a **module**: a student's five headline figures are the one
grouping on the dashboard that genuinely is a group, which is the test the
mobile reference's rounded cards have to pass. On a desktop it goes back to a
bordered strip, because a wide box around five numbers is the giant stat card
two milestones have been spent removing.

## 5.17 What was NOT taken from the references

Recorded so a later milestone does not "restore" them.

| Not taken | Why |
|---|---|
| The hero section | GradTools opens on a student's own semester, not a headline |
| Centred display type over a dark field | That is a landing page's opening move |
| The 3-D chrome sphere and prism artwork | Decoration with no product meaning |
| The feature-card grid | Marketing structure. The app has sections, not features |
| A decorative code-editor panel | A screenshot of a different product |
| The photographic backdrop behind the app window | The application is not a poster of itself |
| Avatar stacks and "+8 people" | GradTools is single-player |
| The closing call to action | There is nothing to sign up for on a dashboard |
