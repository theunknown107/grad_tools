# 35. Component coverage matrix, and the styling decision that gates it

**Baseline:** `21eb890`, revised at `c25c688` · **Method:** official registry
inspected over the network, not recalled; verdicts revised where BUILDING the
component proved the verdict wrong.

Phase 7B asks for thorough, faithful integration of the shadcn/ui component
universe. Step 3 of its own plan is this matrix, and Step 4 is inspecting the
official implementation before writing anything. Doing Step 4 first surfaced a
constraint that decides *how* every row below can be built, so it is stated
before the matrix rather than after.

---

## 35.1 What the official source actually is

Fetched from `ui.shadcn.com/r/styles/new-york/accordion.json`:

```
dependencies: ["@radix-ui/react-accordion"]

import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
```

…with class names like `flex`, `border-b`, `py-4`.

So an official shadcn component is three separable things:

1. **A Radix primitive** — the behaviour: keyboard, focus, roving tabindex,
   portals, dismissal, ARIA. This is the part Phase 7B §4 says must not be
   simplified away.
2. **Tailwind utility classes** — the appearance.
3. **`cn`** (clsx + tailwind-merge) and **lucide-react** — glue and icons.

GradTools has **none** of these. It has 29 CSS Modules, its own token system,
its own `icons.tsx`, and no Tailwind.

## 35.2 The conflict, stated plainly

Taking shadcn's *files* verbatim requires Tailwind, `clsx`, `tailwind-merge`,
`class-variance-authority`, `lucide-react`, ~24 Radix packages, plus `cmdk`,
`vaul`, `recharts`, `react-day-picker`, `date-fns`, `embla-carousel-react`,
`input-otp`, `react-resizable-panels`, `sonner` and `@tanstack/react-table`.
Roughly **thirty new dependencies and a second styling system** layered over the
existing one.

That collides with this brief's own rules:

- **§32** — "must not result in dependency bloat… avoid duplicate component
  libraries, duplicate animation libraries, **redundant icon libraries**".
  `lucide-react` is redundant; GradTools has an icon set.
- **§43** — must not "introduce another visual system". Tailwind alongside 29
  CSS Modules is exactly that.
- **§30** — "**ONLY COLORS / VISUAL TOKENS** should be customized". With
  Tailwind that is impossible: restyling means rewriting every utility class in
  every file, which is not customising a token.
- And every prior phase, including the one that froze the UI, said not to add
  Tailwind or another CSS framework.

## 35.3 The resolution: take the behaviour, not the stylesheet

**Install the Radix primitives. Do not install Tailwind.**

This is not a compromise on fidelity — it is where the fidelity actually lives.
Radix *is* the behaviour shadcn ships: the keyboard model, focus management,
roving tabindex, portal and dismissal logic, and ARIA semantics that §4 lists as
non-negotiable. Tailwind classes are the appearance, and the appearance is
already frozen and approved at `1151bb0`.

So each applicable component becomes: **official Radix primitive + GradTools
CSS Module + GradTools tokens + GradTools icons.** Behaviour identical to
shadcn's, appearance identical to the frozen reference, one styling system, and
no redundant icon library.

Where a component's substance is a non-Radix library — `recharts` for Chart,
`cmdk` for Command, `@tanstack/react-table` for Data Table, `embla` for
Carousel — that library is the real dependency and is judged on its own merits
per component below.

**This decision was confirmed before implementation** and is now in force. The
Radix primitives are installed; Tailwind, `clsx`, `tailwind-merge`,
`class-variance-authority` and `lucide-react` are not.

---

## 35.4 The matrix

Verdicts: **BUILD** (applicable, implement) · **HAVE** (equivalent already
exists and is used) · **HAVE→BUILD** (an equivalent exists and was ported onto
the primitive) · **NO** (no legitimate GradTools use) · **DEFER** (applicable
only to a product area that is currently out of scope).

| Component | Verdict | GradTools use / reason |
|---|---|---|
| Accordion | HAVE→BUILD | `ToneAccordion` exists and is used for the week; port onto `@radix-ui/react-accordion` for real keyboard semantics |
| Alert | BUILD | Import errors, DX warnings, scheme-mismatch notices; today `Notice` |
| Alert Dialog | BUILD | Destructive confirms: delete result, delete account, replace timetable |
| Aspect Ratio | NO | No media of fixed ratio anywhere in the product |
| Attachment | BUILD | Import review: the uploaded PDF with parse status (§25) |
| Avatar | DEFER | Only a signed-in identity glyph; no photos, no people lists |
| Badge | HAVE | `StatusPill` covers status/semantic labels |
| Breadcrumb | NO | Flat route space; sidebar already marks position |
| Bubble | NO | No conversational surface in GradTools |
| Button | HAVE | `Button` with variants, used throughout |
| Button Group | BUILD | Attended/Missed pair; import actions |
| Calendar | BUILD | Academic calendar dates, timetable effective-from |
| Card | HAVE | `Panel` + `PastelCard` |
| Carousel | NO | `Rail` already scrolls; a carousel adds controls the reference deliberately omits |
| Chart | ~~BUILD~~ **NO** | Reclassified — see §35.6. One chart exists, its correctness depends on NOT connecting across gaps, and there is no second series to plot |
| Checkbox | BUILD | Notification filters, bulk selection |
| Collapsible | BUILD | "Add a class" disclosure, explanation disclosures |
| Combobox | BUILD | Subject/college/branch/scheme selection from reference data — the strongest fit in the whole list |
| Command | HAVE→BUILD | `GlobalSearch` exists; `cmdk` would give proper filtering/roving focus |
| Context Menu | NO | No right-click affordance in the reference; duplicates row actions |
| Data Table | BUILD | Result subjects, attendance records — sorting/filtering genuinely helps |
| Date Picker | BUILD | Pairs with Calendar for effective-from and event dates |
| Dialog | HAVE→BUILD | Used; port to `@radix-ui/react-dialog` for focus trapping |
| Direction | NO | No RTL requirement stated; would be unverifiable |
| Drawer | BUILD | Mobile detail surfaces (`vaul`) |
| Dropdown Menu | HAVE→BUILD | Exists; port for roving focus and typeahead |
| Empty | HAVE | `EmptyState`, used on every list |
| Field | BUILD | Every form field — labelling, description, error wiring |
| Hover Card | DEFER | Subject preview on hover; needs subject detail pages first |
| Input | HAVE | `TextField` |
| Input Group | BUILD | Marks entry with unit suffixes; search with shortcut |
| Input OTP | NO | No OTP flow; auth is provider-based, and §P forbids credential collection |
| Item | BUILD | List rows — attendance, notifications, resources |
| Kbd | HAVE | Search shortcut renders `<kbd>`; formalise |
| Label | HAVE | Form labels exist; folds into Field |
| Marker | NO | No map or annotation surface |
| Menubar | NO | Desktop-app menu bar; the sidebar is the navigation model |
| Message / Message Scroller | NO | No chat/messaging feature |
| Native Select | HAVE | `SelectField` uses a native select deliberately for mobile |
| Navigation Menu | NO | Sidebar covers navigation; this is for mega-menus |
| Pagination | DEFER | No dataset large enough yet; announcements are short |
| Popover | HAVE→BUILD | Appearance popover exists; port for dismissal semantics |
| Progress | HAVE | `Bar` and the pastel card's progress |
| Questionnaire | DEFER | Genuine fit for first-run profile setup; not a current flow |
| Radio Group | BUILD | Appearance choice, mutually exclusive settings |
| Resizable | NO | No split-pane workflow; harms the mobile-first layout |
| Scroll Area | BUILD | Long lists, the sidebar at small heights |
| Select | HAVE | See Native Select |
| Separator | HAVE | Hairlines via CSS |
| Sheet | HAVE→BUILD | Exists; port for focus trap |
| Sidebar | NO | The reference sidebar is already built and frozen; shadcn's brings its own layout model and would fight it |
| Skeleton | HAVE | Used on dashboard and lists |
| Slider | BUILD | Bunk planner "classes to miss", target-SGPA input |
| Spinner | BUILD | OCR/parse processing state |
| Switch | BUILD | Notification and appearance preferences |
| Table | HAVE | Result tables exist; Data Table supersedes where dense |
| Tabs | HAVE→BUILD | `IslandTabs` with the travelling pill; port for keyboard semantics, keep the animation |
| Textarea | DEFER | No user-authored free text yet |
| Toast | BUILD | Import saved, attendance marked, undo — currently silent |
| Toggle | BUILD | Unread-only filter |
| Toggle Group | BUILD | Today/Week, overview/subjects modes |
| Tooltip | HAVE→BUILD | Exists; port for correct delay/dismiss |
| Typography | HAVE | The frozen type scale is the contract |

**Totals — corrected.** The first draft of this document said "BUILD 26 · HAVE
18 · NO 15 · DEFER 5", which is 64 and does not match its own table. Counting
the rows:

| Verdict | Rows | State |
|---|---|---|
| BUILD | 23 | 22 built · 1 reclassified to NO (Chart, §35.6) |
| HAVE→BUILD | 8 | all 8 ported onto their primitive |
| HAVE | 14 | audited, §35.7 |
| NO | 13 (+1) | reasons in the table; Chart joins them |
| DEFER | 5 | reasons in the table |
| **Total** | **63** | |

So **30 components were implemented**, not 26 — the corrected count is larger
than the stated one, not smaller. Nothing is "skipped".

---

## 35.5 What is unblocked regardless

The academic-data half of Phase 7B does not depend on the styling decision and
can proceed immediately:

- **Exam / ExamSession model** (§17) — the gap `docs/34` already identified.
  The regulations state a course without an SEE takes its letter grade from CIE
  alone, so SEE participation must be modelled rather than assumed.
- **Credit resolution** from reference data (§11) rather than from the result
  card, which need not print credits.
- **Non-credit mandatory courses** excluded from SGPA/CGPA (§19).
- **Backlog logic per RuleSet** (§18) — DX, AB, IC, W, PP are distinct states,
  not all "backlog".
- **Verifying the grade bands and passing rules against the supplied
  regulations PDF** (§9, §10) rather than against the values quoted in the
  brief.

---

## 35.6 Chart: why it was built into a NO

Phase 7B §11 says a component that proves inapplicable on deeper inspection
should have its verdict changed and the reason recorded, and this is the one
row where that happened. It is recorded here rather than quietly dropped.

**The verdict was BUILD on the strength of "SGPA trend, attendance trend".**
Inspecting the data model found only one of those two is real:

- `AttendanceRecord` holds `attended` and `conducted` — RUNNING COUNTS, with a
  single `updatedAt`. There is no dated series anywhere in the domain, so an
  attendance trend could only be drawn by inventing the points between. docs/37
  forbids exactly that.
- The SGPA trend exists and is `SgpaTrend`, sixty lines of hand-written SVG.

**And the one chart that exists has a correctness requirement a library
weakens.** A semester with no result must appear as a GAP, and the line must
break across it. Joining semester 3 to semester 6 would draw two SGPAs the
student never earned. `SgpaTrend` cannot do that — it emits one polyline per
unbroken run, so the gap is structural. Recharts can do it, and only refrains
while a prop says so; `connectNulls` is one edit away from a fabricated figure.

So adopting recharts would have meant ~90KB gzipped, a second styling model,
and a correctness property demoted from "impossible" to "configured" — in
exchange for hover tooltips on one chart. §32 forbids dependency bloat, and
this would have been it. `recharts` was installed, evaluated and removed.

**What would reverse this:** a second real time series. Dated attendance —
`classMarks` already stores per-day outcomes and could be aggregated into one —
would make a genuine trend, and at two charts the shared axis, tooltip and
legend logic starts to earn a library. That is a data-model change first and a
component decision second.

## 35.7 The HAVE components, audited

Phase 7B §3 asks that the 14 HAVE rows be checked against the same standard,
not assumed. Each was read; the verdicts stand, with three notes.

| Component | Stands as | Note |
|---|---|---|
| Badge | `StatusPill` | Icon + text, never colour alone. Meets §27.6 |
| Button | `Button` + `buttonClassName` | Navigation renders an anchor, not a button wrapping one |
| Card | `Panel`, `PastelCard` | — |
| Empty | `EmptyState`, `Empty` | Two by design: a panel-sized absence and a one-line one |
| Input | `TextField` | Visible `<label>`, hint and error both referenced |
| Kbd | raw `<kbd>` in search | **Not formalised.** One use site; a component for one caller is the abstraction the ladder says to skip |
| Label | inside the field components | Folded into `Field` for controls that are not labelable |
| Native Select | `SelectField` | Deliberately native: the platform picker on a phone beats anything shipped here |
| Progress | `Bar`, `Meter` | `Meter` carries a threshold marker, which shadcn's Progress has no notion of |
| Select | `Select` | **Still hand-rolled.** See below |
| Separator | CSS hairlines | A `<div role="separator">` for a border is markup for nothing |
| Skeleton | `Skeleton`, `ShapedSkeleton` | Shaped like what replaces it, so the layout does not jump |
| Table | `TableScroll` + `tableClass` | Focusable scroll container, per `scrollable-region-focusable` |
| Typography | the frozen type scale | The contract, not a component |

**`Select` was left hand-rolled, and that is a judgement call.** It is 235 lines
implementing the listbox pattern, it has its own passing keyboard tests
(`interaction-components.test.tsx`), and it opens on the current value rather
than the top of the list. Porting it to `@radix-ui/react-select` would add a
primitive whose behaviour those tests already demonstrate. The place it would
genuinely pay is a long list — and a long list is a `Combobox`, which now
exists. Recorded as a candidate, not a defect.

## 35.8 Dependencies added

| Package | For | Why it, specifically |
|---|---|---|
| 17 × `@radix-ui/react-*` | the behaviour of 20 components | The primitives shadcn itself ships |
| `cmdk` | Command, Combobox | Scored matching and `aria-activedescendant` while focus stays in the input |
| `@tanstack/react-table` (v8) | Data Table | Headless: no styling to fight |
| `react-day-picker` + `date-fns` | Calendar, Date Picker | `modifiers`, which is the only reason not to use `<input type="date">` |
| `vaul` | Drawer | Velocity-based drag-to-dismiss, built on Radix Dialog |

**Not added:** `tailwindcss`, `clsx`, `tailwind-merge`,
`class-variance-authority`, `lucide-react`, `sonner`, `recharts`,
`embla-carousel-react`, `input-otp`, `react-resizable-panels`. Each is either a
second styling system, a redundant icon set, or a component with no GradTools
caller.
