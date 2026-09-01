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

## 5.18 M9.5 — the layout, not just the palette

M9.4 revalued the tokens and left the layout alone, which produced a correct
but shallow result: the old GradTools with a violet coat on. The references
differ from GradTools structurally, and this section records what that
difference actually was.

### What a second reading of the references found

| Reference | Structure |
|---|---|
| The marketing site (three images) | **Horizontal top bar.** Brand at one end, four destinations, a text link and a pill at the other. No sidebar anywhere |
| The application (one image) | Sidebar, but also: breadcrumb + circular actions on a top row, a **two-column body** — wide main column plus a rail of small bordered modules — a chip row under the heading with the primary action pushed right, and list items as bordered cards |
| The phone screens (one image) | Repeating **section-header pattern**: solid dark label left, quiet "View All" right; horizontally scrolling rows; white modules; black pill actions; bottom bar |

GradTools had none of that shape. It had a 232px sidebar and a single narrow
column of hairline rows on every screen.

### Navigation: horizontal, in two tiers

The sidebar listed eleven destinations permanently, ten of which were not the
one being looked at, and it pinned the content to one column. It is gone.

```
TIER 1   [G] GradTools   Overview  Academics  Account            ( ) ( )
TIER 2   ▸ Dashboard    Announcements    Notifications
```

Tier 1 is the three areas. Tier 2 is the destinations inside the open area —
always visible, never a menu that opens, and it shows where you are rather than
listing everywhere you could be. Eleven destinations fit comfortably in two
short rows.

**Responsive behaviour.** Both tiers scroll sideways rather than wrapping: a
bar that grows to two rows on a narrow screen pushes the page down and changes
height as you move between areas. The account circle is hidden below 1024px
because Account already has a bottom tab, and those 46px were what clipped
"Account" to "Accou" at 390px. The bottom bar keeps its five chosen
destinations and now also selects the *area*, so the chip row follows it.

### `Module` comes back, deliberately

M9.3 removed containers because the app had one and used it 46 times, which
flattened every page into equal boxes. **The correction overshot.** With no
container at all, a page was one vertical column of hairlines and the eye had
nothing to rest against.

The application reference is neither: a main column of content with a rail of
bordered modules beside it. The border is not decoration — it marks content
that is *not part of the main reading order*.

> **The test before reaching for a module:** would this content still make sense
> lifted off the page entirely? If yes, it is a module. If it is the next
> paragraph of the page's argument, it is a section.

`Section` therefore remains the default and `Module` is for what sits beside it.

### Section headings are readable again

M9.3 set them at 13px uppercase in the muted colour, which made them recede so
far that a page read as one undifferentiated column. Both references do the
opposite: **a solid label at 16px, and a quiet link beside it.** That contrast
is what gives a stack of sections a rhythm. `Panel` headings were changed to
match, so a page mixing the two primitives does not look assembled from parts.

### The dashboard is two columns

| Main column | Rail |
|---|---|
| Where you stand, what is today, what needs attention | What changed, where else you can go |

Below 1024px it collapses to one column and the rail follows in the markup
order, which is also the right reading order on a phone. The rail is sticky on
a desktop, so it stays with the student as the attention list scrolls.

### What did NOT come from the references

Unchanged from §5.17, plus one addition: **the application reference's sidebar**.
It is the one structural element of the four images that GradTools already had,
and it is the one being removed.

## 5.19 M9.5.1 — the surface comes back

M9.5 got the architecture right and the surfaces wrong. With the sidebar gone
and the composition in two columns, most pages were still a page title, a rule,
a column of hairline rows and a footer — technically consistent, visually flat.

A third reading of the references, this time for micro-detail rather than
structure, found the reason.

### Content sits ON something

Every panel in the marketing reference is a faint hairline over a
near-transparent fill. The application reference's task list, its whole
right-hand rail, its empty state and its chart are all bordered cards. Neither
reference ever puts content directly on the page ground.

GradTools did, everywhere, because M9.3 stripped `Panel` of its surface. That
was the right call at the time — one container used 46 times gave every region
identical weight — but **the correction kept going**, and two visual milestones
later a page was still a column of hairlines with nothing for the eye to rest
against.

`Panel` draws a surface again: `--surface`, a 1px `--border`, `--radius-lg`,
`--space-5` of padding. `Section` — which had become a surface-less duplicate
with no callers left — is **deleted**. One primitive, not two.

> **The rule that replaces "a border is not a box":** hierarchy comes from
> **size, position and type**, not from which regions are allowed a border.
> Every panel may have one; not every panel may be the largest thing on screen.

`flush` runs the body to the panel's edges with a negative margin, so a list's
dividers reach the border — which is how the reference's list cards are built,
rows separated edge to edge rather than floating inside a padded box.

### The measurements that were wrong

| | Was | Now | Measured off |
|---|---|---|---|
| Top bar height | 56px | **64px** | The marketing bar is ~76px at its scale |
| Area tabs, gap | 4px | **8px**, 16px padding, 38px tall | Its four destinations sit ~50px apart |
| Button side padding | 16px | **20px** (24px for primary) | Every control in both references is notably wider than its label needs |
| Panel radius | 16px | **18px** | 16 read mechanical beside them; 20 looks inflated |
| Border | `#262238` | **`#221e33`** | Their panels are drawn by a hairline you have to look for |
| Metric column cap | 132px | **124px** | So five figures stay on one line beside the 320px rail |

That generosity in the controls is most of why the references read as
considered rather than as form furniture.

### Density without fifty cards

The library was the test case. Fifty bordered cards is the 8,000px page M9.3
removed; fifty rows floating on the page ground is what M9.5 shipped. **The
reference does neither** — its list is *one* bordered surface with dense rows
and hairlines inside it. That costs one border for the whole library.

Applied to Question papers (one panel, 50 rows), Results (one panel per
semester, six subject rows inside each) and Attendance (one panel, six course
rows).

### A page of prose is not a page of data

`--settings-max: 860px` caps Notifications, Account and Profile. Neither
reference runs a paragraph or a grid of switches the full width of a window;
without the cap, eleven category checkboxes spread across 1770px and read as
eleven unrelated settings in an empty room.

### Scrolling rows say so

Both navigation tiers scroll sideways below 1024px, and a word cut flat at the
edge reads as a bug rather than as an affordance. A `mask-image` fades the last
20px — a mask rather than an overlay, so it cannot cover a focus ring and costs
no element. It is removed once the row fits.

## 5.20 The icon set

Referenced by `apps/web/src/components/icons.tsx` and `icons.module.css`.

### Why it is drawn rather than installed

The set was Lucide, re-exported from one module — coherent, and the right call while the
product had no visual language of its own. It stopped being the right call in M9.4:
Lucide draws at a **2px stroke on a 24px grid**, and at the 15–16px these icons actually
render that reads *heavier* than the type beside it. The references do the opposite —
their icons are thin and precise, and they sit under the typography rather than competing
with it.

Stroke weight is not something a library exposes per icon, so the choice was to fight the
library or to draw the shapes this product actually uses. Drawing them also removed a
dependency: **`lucide-react` is gone.**

### The rules every icon follows

| | |
|---|---|
| viewBox | `0 0 24 24`, always |
| stroke | **1.5**, round caps, round joins, no fill |
| colour | `currentColor` — an icon takes the colour of its text |
| construction | geometric: circles, rounded rects, straight runs |

The one exception is a dot — a `0.95r` circle filled with `currentColor`, because a
stroked dot at 14px renders as a ring.

Measured across 12 routes: **one** distinct `stroke-width` and **one** distinct
`viewBox` in 165 rendered instances.

### Sizes are tokens, not numbers

`--icon-micro` 12 · `--icon-small` 14 · `--icon-nav` 16 · `--icon-medium` 18 ·
`--icon-large` 22. They live in `tokens.css` and `icons.module.css` reads them, so a
stylesheet and the component cannot drift. `<Icon>` takes a size *name*; there is no
numeric `size`, no `stroke` and no `color` prop, because each is a way for one icon to
stop matching the others.

They step with the **type** scale rather than the spacing scale: an icon's job is to sit
beside a label, and 14px text wants a 16px glyph.

Measured across 12 routes: 12px ×1, 14px ×50, 16px ×91, 18px ×24, 22px ×3 — **all five
tokens in use and no arbitrary value anywhere**.

### Accessibility is in the component, not the call sites

Every icon is `aria-hidden="true"` and `focusable="false"` **always, with no way to turn
it off**. An icon is decoration; the meaning belongs to the text beside it or to the
`aria-label` of the control containing it (docs/27 §27.5). Enforcing it in one place
rather than trusting thirty call sites is the whole point.

Measured: 0 icons missing either attribute, and **31 icon-only controls, every one with
an accessible name**.

### A glyph inside a container needs a container-sized icon

`gpa` first drew a sigma inside a rounded rect, like the other destination glyphs. At
16px the container left the sigma **3.6px wide** and it mushed into a blob in the second
navigation tier — caught by screenshot inspection, not by any automated gate. Redrawn as
a bare sigma filling the viewBox.

**At navigation size the glyph has to BE the icon.**

### Only what is rendered

An earlier draft carried the full action vocabulary — edit, copy, download, sort, filter,
close, more and a dozen others — on the theory that a design system should be complete.
It cost **1.77 kB (0.53 kB gzipped)**, which is affordable, and it was still wrong: a
name registry cannot tree-shake, so every unused shape shipped to every student to be
rendered by nothing.

**An icon nobody renders is not part of a system; it is a file of intentions.** The set
is 32 shapes. Adding one back is five lines, and it arrives with the call site that
justifies it.

### Where icons are deliberately absent

Metric labels (CGPA, Attendance, Backlogs) get none: they are already words, and a mark
beside each would be five marks competing with five numbers. The one-line `Empty` gets
none — a mark beside a single sentence is decoration. Only the block `EmptyState` has
one, drawn in `--text-subtle` at 70% opacity, because an empty state should read as a
quiet absence rather than as an error.

## 5.21 Theme customisation (M9.6A)

M9.4 deferred this and predicted its own fix: *"every themeable value is a
custom property on `:root`, so a future milestone overrides properties instead
of rewriting components."* That held. **No component changed to gain themes.**

### Two orthogonal axes

| Axis | Values | Carrier |
|---|---|---|
| Appearance | `light` · `dark` · `system` | `data-theme` on `<html>` |
| Accent | `violet` · `cyan` · `amber` · `rose` · `green` | `data-accent` on `<html>` |

Orthogonal on purpose: 2 × 5 = **ten palettes from one extra block per accent**,
not ten hand-written themes. Accent blocks define hue stops (`--a-*`) and never
name a background; appearance blocks decide which stop each semantic token
takes and never name a hue. Adding a sixth accent is one CSS block plus one
array entry.

### Three states, not two

`system` is the default, and it is the reason `data-theme` is **removed**
rather than set to `"system"`. The absence of the attribute is what hands
control to `prefers-color-scheme`; an attribute value of `"system"` would match
no block and strand the page on the dark defaults. A test pins the removal.

`color-scheme` is set alongside, so the browser's own scrollbars and form
controls follow the choice instead of staying light on an explicitly dark page.

### The primary fill is structural, not accent

In dark the primary action is the accent fill. In light it stays **near-black
ink**, from the M9.4 mobile reference — that button is part of the identity,
not a colour waiting to be themed. Accent still drives text, selection, focus,
chips, charts, glow and ambient in both appearances. Recorded as `32/DEC-038`;
reversible if the product decides otherwise.

### Contrast is computed, not eyeballed

Ten palettes is more than anyone will check by hand, so `theme.test.ts` **parses
`tokens.css` itself** and computes WCAG ratios for every accent against every
ground it can land on — dark bg, dark surface, light bg, light surface, plus
white-on-fill for the button. A hue below 4.5:1 anywhere cannot be committed.
Measured range: **4.87:1 to 11.41:1**.

This is also why the accents are a **fixed list rather than a colour picker**.
An arbitrary hex cannot be checked, and would eventually produce an unreadable
interface that reads as our bug rather than the person's choice.

### No flash

An inline blocking script in `index.html` applies the stored attributes before
first paint. It duplicates a dozen lines of `lib/theme.ts` deliberately: the
React bundle is a module and therefore deferred, so applying the theme there
would paint the default palette first and repaint into the chosen one.

## 5.22 The glass material system (M9.6B)

Five materials, declared once in `tokens.css` and consumed by five classes in
`global.css`. A component asks for a material **by name** and never assembles
one from tint + blur + border itself.

| Class | Where | Why it differs |
|---|---|---|
| `.glassNav` | top bar, bottom bar, landing navbar | Sits over moving content |
| `.glassPanel` | popovers, menus, modals | Denser — text sits directly on it |
| `.glassSurface` | raised content panels, island tabs | Barely translucent; readability wins |
| `.glassOverlay` | modal scrims | Darkens rather than tints |
| `.glassInput` | search trigger, select trigger, drop zones | Recessed, not raised |

### The highlight is the part that matters

Blur and alpha alone give a frosted `div`. What makes a surface read as *glass*
is a single bright 1px line along its top edge — light catching a physical
bevel. That is `--glass-highlight`, one inset box-shadow, and it is the
difference between "transparent" and "material".

### Restraint by scarcity

There are five materials and each names the one surface class it belongs to.
Anything that is not navigation, a popover, an overlay, a raised panel or an
input **is not glass**. `backdrop-filter` is never applied to a scrolling list
or to a surface that repeats down a page: repeated blur is both slow and
illegible.

### A material has to be trustworthy for anything placed on it

The nav tint started at 62% (dark) / 72% (light). The M9.6B sweep found the
bottom bar's 11px labels failing AA at 390/light — a dark row scrolling under
the bar dragged the effective background to `#bebdc0`, giving 4.0:1. Fixed by
**densifying the material to 80% / 90%** rather than darkening the label: the
label was already the darkest muted token, and the material must be safe for
whatever is placed on it, not just for the one case that failed.

## 5.23 Motion (M9.6B)

Two easings and four durations, all in tokens. `--ease-spring` is a bezier with
~3% overshoot for things that ENTER; `--ease-glide` is for things that MOVE
between two known positions — the nav indicators.

Every entrance is opacity plus **one** transform. Opacity + scale + blur +
rotation is how a menu ends up feeling like a slot machine.

**One continuous animation exists in the product**, and it is argued rather
than assumed: a 22-second positional drift on the landing hero's blurred
aurora. It carries no information, has no edges, and is far too slow to pull
the eye — it reads as light in a room. Everything else animates only in
response to an action.

`prefers-reduced-motion` is honoured globally, set to `0.01ms` rather than `0`
so animation end-events still fire and nothing waiting on one can hang.

## 5.24 The M9.6C visual reset

M9.4's identity was violet-black. By M9.6B the product read as "purple cards on
a purple background", and the cause was not careless accent use — the accent
was already rationed. It was structural.

### What was actually wrong

| | M9.4–M9.6B | M9.6C |
|---|---|---|
| Ground | `#0b0a12` violet-black | `#05070d` near-black **blue** |
| Surface | `#161423` **solid** violet | `rgb(255 255 255 / 4.5%)` translucent |
| Raised | `#1e1b30` **solid** violet | `rgb(255 255 255 / 7%)` |
| Border | `#221e33` violet | `rgb(255 255 255 / 9%)` light |
| `--accent-weak` | `#1d1733` **solid block** | 14% accent tint |
| Primary button | `#6d4de0` solid violet | neutral glass + luminous accent edge |
| Nav active | filled violet capsule | lit lozenge, accent on the lower edge only |

**The two largest areas on every screen were both violet** — the page and the
panels. Glass cannot exist over an opaque violet rectangle, so no amount of
blur was going to help.

### The rule that replaced it

> The ground is the only opaque colour. Surfaces are translucent **white** laid
> over it. Elevation is more light, not different paint.

That is what makes the material honest: a surface inside a surface reads
brighter on its own, and a surface over the ambient light picks the light up.

### Glass is a gradient, not a flat alpha

A single change did most of the visual work: the material runs 8% white at its
top edge down to 3.5% at its bottom. Real glass is brighter where light strikes
it. Flat alpha reads as a grey rectangle no matter how much blur is behind it.

### Glass must mark hierarchy, so it cannot be the default

`Panel` gained `material="quiet"` — no surface, no blur, one hairline. A page
of five glass panels is the same failure as the 46 identical boxes M9.3
removed, wearing a better material. Ordinary lists are quiet; groups that own
their content stay glass.

### Accent is a light source

Violet appears in: accent text, the focus ring, the lower edge of the active
nav marker, the primary button's border and glow, the chart line, status-free
chips, and one small atmospheric light. It appears as a **fill** nowhere.
