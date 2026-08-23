# 27 — Accessibility and Responsive UX

**Status:** Phase 1 draft
**Target:** WCAG 2.1 Level AA
**Position:** accessibility is a correctness requirement, not a feature. A student who cannot read their attendance percentage has been failed by the product exactly as thoroughly as one shown the wrong number.

---

## 27.1 Why this matters concretely here

The target user runs a mid-range Android phone, often outdoors, often on a cracked screen, often one-handed while walking. The accessibility techniques that serve a screen-reader user — sufficient contrast, large touch targets, clear focus, semantic structure, text that survives zoom — are the same ones that serve *every* user of this product in its actual usage context.

This is not a compliance exercise appended to the design. It is the same work as making the product usable on a phone in sunlight.

## 27.2 Conformance commitments

| Guideline | Commitment |
|---|---|
| Perceivable | Text alternatives, 4.5:1 body contrast, 3:1 for large text and UI boundaries, meaning never conveyed by colour alone, content reflows at 320 px, 200% zoom without loss |
| Operable | Full keyboard operability, no traps, visible focus, 44×44 px touch targets, no time limits, reduced-motion respected |
| Understandable | Consistent navigation, labelled inputs, clear errors with correction guidance, predictable behaviour |
| Robust | Semantic HTML, valid ARIA only where semantics are insufficient, tested with real assistive technology |

## 27.3 Semantic structure

```html
<header>   site identity, theme toggle
<nav aria-label="Main">      primary navigation
<main id="main">             one per page, skip-link target
  <h1>                       exactly one, matching the page title
  <section aria-labelledby>   for each major region
<footer>   affiliation disclaimer, policy links
```

Rules: one `<h1>` per page; heading levels never skip; lists are `<ul>`/`<ol>`; tables use `<th scope>` and `<caption>`; buttons are `<button>` and links are `<a>` (an `onClick` on a `<div>` is a defect); forms use real `<label>` elements; `<fieldset>`/`<legend>` group related inputs.

**ARIA is a last resort.** `role="button"` on a `<div>` is worse than a `<button>` in every way — it requires reimplementing keyboard activation, focus and disabled semantics that the native element provides free.

## 27.4 Keyboard

| Key | Behaviour |
|---|---|
| `Tab` / `Shift+Tab` | Logical DOM order; **no positive `tabindex` anywhere** |
| `Enter` | Activate a link or button; submit the focused form |
| `Space` | Activate a button; toggle a checkbox |
| `Esc` | Close a dialog or sheet, returning focus to the trigger |
| Arrows | Move within tab lists, grids and the timetable |
| `Home` / `End` | First/last item within a composite widget |
| `/` | Focus search where one exists |

**Focus management:**
- A visible skip-to-content link is the first focusable element on every page.
- Dialogs trap focus while open and restore it to the trigger on close.
- Route changes move focus to the new page's `<h1>` and announce the title via a live region — without this, a screen-reader user has no idea navigation occurred in an SPA.
- Focus is **never** removed with `outline: none` without an equivalent visible replacement. The focus ring is restyled, never suppressed.
- Newly revealed content (an expanded derivation panel) is inserted immediately after its trigger in the DOM, so tab order follows visual order.

Every critical flow (`22` §7) is verified keyboard-only, end to end.

## 27.5 Screen readers

Tested against: **NVDA + Firefox** (Windows), **VoiceOver + Safari** (iOS), **TalkBack + Chrome** (Android). iOS and Android matter more than usual because the target user is on a phone.

| Pattern | Implementation |
|---|---|
| Page title | Updated on every route change |
| Route announcement | Polite live region |
| Form errors | `aria-describedby` on the field, plus `role="alert"` on the summary |
| Loading | `aria-busy` on the region; skeletons `aria-hidden` with a visually-hidden "Loading" |
| Toasts | `role="status"` (polite) for success, `role="alert"` (assertive) for errors |
| Icon-only buttons | `aria-label` on every one |
| Status pills | Text label always present, never colour or icon alone |
| Tables | `<caption>`, `scope`, `aria-sort` on sortable headers |
| Charts | `<figure>` with `<figcaption>` plus a visually-hidden data table — **the table is the accessible chart** |
| Numeric values | Marked up so "8.24" is announced with its context ("CGPA 8.24 out of 10") |

The chart rule deserves emphasis: an SVG chart with `aria-label="Chart showing SGPA trend"` conveys nothing. The underlying `<table>` conveys everything, and it also serves users who simply want the numbers.

## 27.6 Colour and contrast

- Every token pair meets AA in both light and dark themes, verified by an automated test rather than by eye (`22` §8).
- **Status is never colour alone.** Attendance states carry colour + text + a distinct icon shape: Safe (check), Below requirement (triangle), DX risk (octagon).
- Charts differentiate series by pattern or direct labelling, not only hue.
- Link text is distinguishable from body text by more than colour within body copy.
- The design survives greyscale, which is the practical test for both colour-blindness and sunlight.

## 27.7 Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Reduced motion removes movement, never the state change itself — a panel that expands instantly is correct; one that fails to expand is broken. Nothing auto-plays, nothing loops, nothing flashes more than three times per second, and no animated number counters exist anywhere (`05` §Anti-patterns).

## 27.8 Touch and pointer

| Requirement | Value |
|---|---|
| Minimum touch target | 44×44 px, including invisible padding on smaller visual controls |
| Spacing between targets | ≥ 8 px |
| Primary actions | Lower half of the phone viewport (thumb reach) |
| Destructive actions | **Never** in the thumb zone, and never adjacent to a common action |
| Gestures | Every gesture has a button equivalent — swipe-to-dismiss always has a close button |
| Hover | Never the only way to reach information; hover content is also available on focus and tap |

## 27.9 Responsive behaviour

Breakpoints in `05` §5.5. The behavioural rules:

| Element | Mobile | Desktop |
|---|---|---|
| Navigation | Bottom tabs (5 items) | Left sidebar |
| Calculator rows | Stacked cards | Table rows |
| Result tables | Sticky first column + horizontal scroll | Full table |
| Derivation panel | Full-height bottom sheet | Inline expander |
| Timetable | Day-at-a-time, swipe + buttons | Full week grid |
| Charts | Fewer ticks, simplified | Full detail |

**Tables are the hard case, and the resolution is deliberate.** A VTU grade card has 7+ columns. The common responsive pattern — one card per row — triples vertical scrolling and destroys the column comparison that is the entire point of looking at a grade card. GradTools instead uses a sticky subject column with horizontal scroll and a scroll-affordance shadow. The scroll container is keyboard-focusable and marked `role="region"` with a label, so it is reachable and announced rather than being a mouse-only affordance.

**Content reflows at 320 px with no horizontal page scroll.** Wide content scrolls inside its own container; the page body never does.

**Zoom to 200%** loses no content or functionality. This is tested, because layouts using viewport units for text or fixed heights for content fail it silently.

## 27.10 Low-end device performance

Accessibility includes being usable on the hardware students actually own.

| Constraint | Response |
|---|---|
| Slow CPU | Minimal JS, no heavy client computation, no continuous animation |
| Limited memory | Small bundle, no large in-memory datasets, virtualised lists only where genuinely long |
| Slow network | < 200 KB initial, offline-capable core, no prefetch waste |
| Limited data plan | No autoplay, no large images, no third-party scripts, PDFs downloaded only on explicit action |
| Older browser | ES2020 target, graceful degradation; the calculators must work even if a modern API is missing |

**The most impactful accessibility decision in this project is that the core features work offline and client-side** (`07` §7.7). A student with an unreliable connection is not blocked from checking their attendance.

## 27.11 Forms

- Visible labels always; placeholder-as-label is prohibited (it disappears on input and fails contrast).
- Errors are announced, associated with the field, and describe how to fix rather than only what is wrong.
- The submit button is never silently disabled — the click is allowed and the missing requirement is explained.
- Correct input modes so mobile keyboards match the field (`inputmode="numeric"` for marks and counts).
- Autocomplete attributes where they apply (`email`).
- Errors never clear entered data.
- Required fields are marked in text, not by an asterisk alone.

## 27.12 Content accessibility

- Plain language; academic jargon defined at first use.
- Sentences short; instructions in numbered steps.
- Abbreviations expanded on first appearance (SGPA, CIE, SEE, DX).
- Link text is meaningful out of context — never "click here".
- Error messages state what happened, whether data was lost, and what to do next (`04` §4.6).
- Numbers always carry their unit and denominator ("42 / 100 in the SEE").

## 27.13 Testing

| Test | Method | Gate |
|---|---|---|
| Automated axe scan | Playwright + axe-core, every page, both themes | Zero violations |
| Contrast | Automated token-pair check | AA |
| Keyboard | Scripted traversal of every critical flow | 100% operable |
| Focus visibility | Visual regression | Always visible |
| Screen reader | **Manual**: NVDA, VoiceOver iOS, TalkBack | Before Alpha |
| Zoom 200% | Manual | No loss |
| 320 px reflow | Automated viewport test | No horizontal page scroll |
| Reduced motion | Automated | Animations suppressed |
| Greyscale | Manual review | All status distinguishable |

**Automated tools catch roughly 40% of real accessibility defects.** The manual screen-reader pass before Alpha is therefore a hard gate (`22` §14), not a recommendation. The defects it finds — a dialog that does not announce, a route change that leaves focus stranded, a table that reads as gibberish — are invisible to axe and immediately obvious to a user.

## 27.14 Known limitations, stated honestly

| Limitation | Status |
|---|---|
| No formal WCAG audit by a third party | Out of budget; self-assessed against AA |
| PDF documents are not remediated | Third-party files we do not control; the extracted **text** is accessible, and that is what the analysis features use |
| AAA contrast not targeted | AA is the commitment |
| No dedicated high-contrast theme | Dark and light both meet AA; revisit if requested |
| Sign language and audio alternatives | No audio or video content exists |

The PDF row matters: GradTools cannot make a scanned question paper accessible, but it can — and does — make the extracted question text accessible, which is the part its own features are built on.
