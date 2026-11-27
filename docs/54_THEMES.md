# Themes

Every palette GradTools offers, where it came from, and how it is built. The
list in code is `ACCENTS` / `ACCENT_INFO` in `apps/web/src/lib/theme.ts`; the
colours are in `apps/web/src/styles/index.css`; `apps/web/test/theme.test.ts`
holds the two together and checks every contrast pair.

## Settings

| Setting | Values | Stored as |
| --- | --- | --- |
| Appearance | Light (default), Dark, System (follows the OS live) | `appearance` |
| Palette | 18, in three groups (below) | `accent` (the id) |
| Density | Comfortable (default), Compact | `density` |
| Reduced motion | on / off, in addition to the OS setting | `reducedMotion` |
| Reduced transparency | on / off, in addition to the OS setting: every glass surface goes opaque | `reducedTransparency` |

All five live in one device-scoped key, `gradtools:v1:theme` (never synced; see
the header of `lib/theme.ts`). `index.html` applies them before first paint.

## Palettes

Ids never change; names are display text. Three names repeat across groups, so
the original palettes announce themselves as "Violet (original)" and so on.

| Id | Name | Group | Light accent | Dark accent |
| --- | --- | --- | --- | --- |
| `mono` | Mono | Current | `#1b1a17` | `#f4f3f1` |
| `violet` | Violet | Current | `#5b4cc4` | `#8f80f0` |
| `matrix` | Matrix | Current | `#2a7147` | `#4bbd7f` |
| `crimson` | Crimson | Current | `#8b0015` | `#bd1a33` |
| `turquoise` | Turquoise | Current | `#0a7580` | `#35c2cf` |
| `ocean` | Ocean | Current | `#2b6cb0` | `#5ea1e6` |
| `amber` | Amber | Current | `#8f5d12` | `#e0a848` |
| `rose` | Rose | Current | `#be2f65` | `#f0709b` |
| `indigo` | Indigo | Current | `#4338ca` | `#818cf8` |
| `emerald` | Emerald | Current | `#047857` | `#34d399` |
| `solar` | Solar | Current | `#a14a08` | `#f0932e` |
| `slate` | Slate | Current | `#475569` | `#94a3b8` |
| `original-violet` | Violet | Original August 2026 | `#6d4de0` | `#a48bff` |
| `original-cyan` | Cyan | Original August 2026 | `#0e7490` | `#55d6e8` |
| `original-amber` | Amber | Original August 2026 | `#a3620a` | `#f0b445` |
| `original-rose` | Rose | Original August 2026 | `#be123c` | `#ff8fa3` |
| `original-green` | Green | Original August 2026 | `#15803d` | `#4fd9a0` |
| `crimson-tinted` | Crimson tinted | New | `#b0142f` | `#dc2a47` |

**Current** — the twelve accents since 3c15ff5 (2026-09-09), unchanged here.
Each sets only `--accent`, `--accent-weak`, `--accent-ink`, `--accent-contrast`
and `--ring`; surfaces stay neutral.

**Original August 2026** — the five accents of the first theme system, 177a23e
(2026-08-31) to bd4d2a3 (2026-09-04), from its hue stops. In light the accent is
its fill (`--a-fill`, white text on it) and accent text is `--a-on-light`; in
dark the accent is `--a-on-dark`, which is what that system itself set
`--accent` to in dark. When the current set replaced it, Cyan was renamed
Turquoise and Green Emerald, and every hue changed value, so these are separate
palettes rather than aliases.

> **Not recovered:** that first system's surfaces (a violet-black product with an
> ink-black primary button in light). Only its accents are restored, on the
> current surfaces. These palettes are not reproductions of the August 2026
> interface.

**New** — Crimson tinted, the near-black, red-accented theme approved in the
design exploration. It is the one palette that also sets surfaces (the
`html[data-accent='crimson-tinted']` blocks): a warm red cast on canvas, panels,
borders and text, red-tinted glass, pink only for highlights (accent text, ring),
and an orange-leaning danger so a below-85% status never reads as the brand
colour. It is a different palette from production **Crimson**, which keeps its
own values and neutral surfaces.

## Saved preferences from earlier versions

- Every id above is kept as saved.
- `cyan` and `green` (pre-September ids) still migrate to Turquoise and Emerald,
  the colours those devices have shown since September; the originals are chosen
  explicitly by their `original-*` ids.
- Any other unknown id falls back to Mono.

## Material

Glass is for the navigation and control layer only: the phone's floating tab
capsule and Mark-today button, the sidebar panel, bars, bubbles and glass
buttons (`.gt-float`, `.gt-orb`, `.gt-bar`, `.gt-bubble`, `.gt-glass`). Content
stays on solid surfaces, so glass never sits on glass. Every material is legible
with no `backdrop-filter`, and goes opaque under reduced transparency (the in-app
switch or the OS setting). There is no official web "Liquid Glass"; this is an
approximation.

## Phone layout

The tab capsule and the Mark-today button sit one gutter in from the screen
edges (16px; 12px under 360px, matching the page content) and above the gesture
bar (`max(0.75rem, safe-area-inset-bottom)`). They share one 64px height. Under
360px the tab names are visually hidden and stay available to screen readers.
Mark today opens the Attendance page's own Today list in a sheet, with the same
scheme gate and marking path.
