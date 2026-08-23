# 04 — UX Specification

**Status:** Phase 1 draft
**Scope:** interaction behaviour. Visual tokens live in `05_UI_DESIGN_SYSTEM.md`; accessibility requirements are expanded in `27_ACCESSIBILITY_AND_RESPONSIVE_UX.md`.

---

## 4.1 UX principles

1. **Answer first, explain on demand.** The number appears immediately; the derivation is one tap away, never mandatory reading.
2. **Honest empty states.** An empty dashboard is the most common first experience. It is designed as a real screen with one action per region, not a shrug.
3. **Uncertainty is visible, not hidden.** Stale, unverified or low-confidence data is labelled at the point of use. We never smooth over what we don't know.
4. **No dead ends.** Every error and empty state offers a next action.
5. **Thumb-first.** Primary actions sit in the lower half of the phone viewport; destructive actions never do.
6. **Nothing moves without a reason.** Motion communicates state change or spatial relationship. Decorative animation is a defect.

## 4.2 Information hierarchy

Global priority order, applied on every screen:

```
1. The answer the student came for       (largest, highest contrast)
2. The status/qualifier of that answer   (freshness, confidence, constraint)
3. The action to change or extend it
4. The evidence and derivation           (collapsed by default)
5. Navigation and chrome
```

Applied to the SGPA screen: the SGPA value, then "based on 6 courses, 28 credits", then "Add course", then the collapsed derivation, then the nav bar.

## 4.3 Navigation

### Structure

```
Dashboard
Results          → Semesters · Backlogs · Marks analytics
Academics        → SGPA · CGPA · Marks needed · Target CGPA
Attendance       → Overview · Bunk planner
Timetable
Papers           → Previous papers · Model papers
Syllabus
Notifications
Profile & Settings
```

### Rendering by breakpoint

| Breakpoint | Pattern |
|---|---|
| < 768 px | Bottom tab bar with **5** items: Dashboard, Academics, Attendance, Papers, More. Everything else lives under "More". |
| 768–1023 px | Collapsible left rail, icons + labels |
| ≥ 1024 px | Persistent left sidebar, grouped sections |

**Rationale for 5 bottom tabs:** thumb reach and label legibility degrade past five on a 360 px viewport. The grouping puts the two daily-use features (Academics, Attendance) at the top level and demotes the occasional ones.

**Stage 1 reduction:** the experimental website ships Dashboard, Academics, Attendance only. Unbuilt sections are absent, not disabled — an app full of dead links reads as broken, not as ambitious.

### Routing rules
- Every screen has a URL; back always works and never loses entered form data.
- Deep links are shareable but contain no personal data (no USN, no result values in query strings).
- Unknown route → a 404 that offers search and the four most common destinations.

## 4.4 Loading states

| Duration | Treatment |
|---|---|
| < 200 ms | Nothing. Do not flash a spinner. |
| 200 ms – 1 s | Inline skeleton matching the final layout's shape |
| > 1 s | Skeleton plus a text hint ("Checking announcement source…") |
| > 5 s | Offer a cancel or retry action; never leave an indefinite spinner |

**Skeletons must match final dimensions** to avoid layout shift (CLS budget in `23`).

**Calculators never show a loading state** — they are synchronous client-side functions (NFR-002). A spinner on a calculator indicates an architectural mistake.

## 4.5 Empty states

Every empty state has three parts: what is empty, why that is normal, and one action.

| Screen | Text | Action |
|---|---|---|
| Dashboard, no data | "Nothing tracked yet. Add your attendance or a past result and this page fills in." | [ Add attendance ] |
| Attendance | "No courses added. Add the courses you're taking this semester." | [ Add course ] |
| Results | "No results saved. Enter a semester result to see SGPA, CGPA and backlogs." | [ Add result ] |
| Papers, subject with none | "No papers for CS304 yet. If you have one, you can contribute it." | [ Upload a paper ] |
| Module priority, too few papers | "Only 2 past papers available — not enough to show reliable frequency. We'll show this once there are at least 4." | [ Browse papers ] |
| Notifications | "No announcements yet. We check the public VTU page a few times a day." | [ Notification settings ] |
| Search, no match | "Nothing matched 'xyz'. Try a subject code like CS304." | — |

**Never** use an empty state to display fake sample data as though it were the user's.

## 4.6 Error states

Every error answers three questions: **what happened, is my data safe, what now.**

| Class | Example message | Action |
|---|---|---|
| Network | "Couldn't reach GradTools. Your entries are saved on this device." | [ Retry ] |
| Validation | "Attended (52) can't be more than conducted (48)." | Inline, at the field, non-blocking |
| Server (5xx) | "Something broke on our side. Your data wasn't changed." | [ Retry ] + reference ID |
| Not found | "That paper isn't available any more." | [ Back to subject ] |
| Rate limited | "Too many requests. Try again in 30 seconds." | Countdown |
| Stale data | "This announcement list is from 6 hours ago — the source is currently unreachable." | Banner, not a modal |
| Upload rejected | "This file couldn't be accepted. It must be a PDF under 20 MB." | [ Choose another file ] |

**Rules**
- No raw error codes, stack traces or exception text in the UI.
- A server reference ID is shown for 5xx so a bug report is actionable.
- Errors never clear the user's input.
- Toasts are for transient success only. Errors requiring a decision are inline or in a dialog.

## 4.7 Forms

- **Labels are always visible.** Placeholder-as-label is prohibited (fails accessibility and disappears on input).
- **Validation on blur**, not on every keystroke; re-validate on submit. Exception: numeric range hints update live.
- **Errors are announced** via `aria-live="polite"` and associated with the field via `aria-describedby`.
- **Correct mobile keyboards:** `inputmode="numeric"` for marks, credits, attendance counts; `type="email"` for email.
- **Autosave** for attendance and result entry, with a subtle "Saved" indicator. No "Save" button that can be forgotten.
- **Destructive confirmations** require typed confirmation, not a second click (account deletion, clearing a semester).
- **Never disable the submit button silently** — allow the click and explain what is missing.

### Numeric input specifics

Marks entry is the highest-friction interaction in the product. Rules:
- Accept `8`, `08`, `8.0` identically.
- Reject and explain out-of-range values inline rather than clamping.
- Credits use a select (values are a small known set), not free text.
- Grades use a select showing both letter and point ("A+ — 9").

## 4.8 Notifications (in-product)

| Type | Presentation | Dismissal |
|---|---|---|
| Success toast | Bottom on mobile, top-right on desktop, 4 s | Auto + manual |
| Warning banner | Inline at the top of the affected region | Manual |
| Critical (DX risk) | Persistent card on Dashboard and Attendance | Only by resolving |
| Push (system) | OS notification | OS |

Never more than one toast at a time; queue them.

## 4.9 Search and filters

- Single search field on Papers and Syllabus; matches subject code, subject name and paper year.
- Subject code match ranks first — students search by code far more than by name.
- Debounce 250 ms; minimum 2 characters.
- Filters (year, semester, session) are chips, reflected in the URL, with a visible "Clear all" once any is active.
- Result count is always displayed ("12 papers").

## 4.10 Data-freshness and provenance surfaces

Any externally-sourced value carries a freshness affordance:

```
┌─────────────────────────────────────────────┐
│ VTU Announcements                           │
│ Checked 22 minutes ago · vtu.ac.in      (i) │
└─────────────────────────────────────────────┘
```

Tapping (i) opens a provenance sheet: source name and URL, retrieval time, extraction method, validation status, parser version, and a link to the original document.

Staleness thresholds:

| Age | Treatment |
|---|---|
| < 1 h | Normal, quiet timestamp |
| 1–12 h | Timestamp emphasised |
| > 12 h, or source unhealthy | Warning banner: "This may be out of date — we couldn't reach the source since 09:14." |

**Never** hide staleness to keep a screen looking clean.

## 4.11 Confirmations

Confirm only when the action is destructive, irreversible or has an external effect (deleting an account, clearing a semester, sending nothing to a third party). Do not confirm ordinary saves. Every confirmation dialog names the object ("Delete the 4th-semester result?") rather than asking "Are you sure?".

## 4.12 Keyboard behaviour

| Key | Behaviour |
|---|---|
| `Tab` / `Shift+Tab` | Logical DOM order; no positive `tabindex` anywhere |
| `Enter` | Submit the focused form |
| `Esc` | Close dialog/sheet, returning focus to the trigger |
| `/` | Focus search (when a search exists on the screen) |
| Arrow keys | Move within grids, tab lists and the timetable |

Dialogs trap focus while open and restore it on close. A visible skip-to-content link is the first focusable element on every page. Focus is never removed by CSS; the focus ring is restyled, never suppressed.

## 4.13 Responsive behaviour

| Element | Mobile (< 768) | Desktop (≥ 1024) |
|---|---|---|
| Navigation | Bottom tabs | Left sidebar |
| Calculator rows | Stacked cards | Table rows |
| Result tables | Horizontally scrollable with a sticky first column | Full table |
| Derivation panel | Full-height bottom sheet | Inline expander |
| Timetable | Day-at-a-time with swipe | Full week grid |
| Charts | Simplified, fewer ticks | Full detail |

**Tables are the hard case.** A VTU grade card has 7+ columns. On mobile the pattern is: sticky subject column, horizontal scroll for the rest, with a scroll-affordance shadow — not a card-per-row transformation, which triples vertical scrolling and makes comparison impossible.

## 4.14 Offline and degraded behaviour

| Condition | Behaviour |
|---|---|
| Offline | Calculators, attendance, timetable and saved results all work from local storage. Banner: "Offline — changes save on this device." |
| API down, client fine | Same as above; only announcements, sync and papers are unavailable, each showing a local error region |
| Local storage unavailable | Ephemeral mode with a persistent banner |
| Push unsupported (iOS PWA not installed) | Notification settings explain the limitation rather than silently failing |

## 4.15 Onboarding and progressive disclosure

- No tutorial, no coach marks, no forced tour. The three primary actions on the landing page are the onboarding.
- Advanced options (condonation threshold, projection mode, grade override) are hidden behind a disclosure control, defaulted to the regulation's values.
- The account prompt appears once per session, after a completed action, and is dismissible permanently.

## 4.16 Copy behaviour in UX contexts

Full rules in `28`. The UX-binding ones:
- Never "Your result is out" — always "A change was detected in the configured public source."
- Never "predicted" — always "appeared in N of the last M papers."
- Never "official" for anything not verified as such.
- Numbers always carry their unit and denominator ("42 / 100 in the SEE", not "42").
