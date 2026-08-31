/**
 * The GradTools icon set.
 *
 * Authority: docs/05 §5.8, §5.20 (M9.5.2) · docs/27 §27.5
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DRAWN HERE RATHER THAN INSTALLED
 * ---------------------------------------------------------------------------
 *
 * The set was Lucide, re-exported from one module. Lucide is coherent and it
 * was the right call while the product had no visual language of its own. It
 * stopped being the right call in M9.4: Lucide draws at a 2px stroke on a 24px
 * grid, and at the 15-16px these icons are actually rendered that reads HEAVIER
 * than the type beside it. The references do the opposite — their icons are
 * thin and precise, and they sit under the typography rather than competing
 * with it (M9.5.2 §4).
 *
 * Stroke weight is not something a library exposes per-icon, so the choice was
 * to fight the library or to draw the forty shapes this product actually uses.
 * Drawing them also removed a dependency.
 *
 * ---------------------------------------------------------------------------
 * THE RULES EVERY ICON IN HERE FOLLOWS
 * ---------------------------------------------------------------------------
 *
 *   viewBox        0 0 24 24, always
 *   stroke         1.5, round caps, round joins, no fill
 *   colour         currentColor, so an icon takes the colour of its text
 *   construction   geometric — circles, rounded rects, straight runs
 *
 * A dot is the one exception: a 0.9r circle filled with currentColor, because a
 * stroked dot at 14px renders as a ring.
 *
 * ---------------------------------------------------------------------------
 * ACCESSIBILITY
 * ---------------------------------------------------------------------------
 *
 * Every icon is `aria-hidden` and `focusable="false"` — ALWAYS, with no way to
 * turn it off. An icon is decoration; the meaning belongs to the text beside it
 * or to the `aria-label` of the control containing it. That is enforced here
 * rather than trusted to 40 call sites (docs/27 §27.5).
 */

import styles from './icons.module.css';

/* -------------------------------------------------------------------------- */
/* Sizes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Five sizes, and no arbitrary numbers at call sites.
 *
 * The values live in tokens.css so a stylesheet and a component cannot drift
 * apart; this maps a name to the class that reads the token.
 */
export type IconSize = 'micro' | 'small' | 'nav' | 'medium' | 'large';

const SIZE_CLASS: Record<IconSize, string> = {
  micro: styles.micro ?? '',
  small: styles.small ?? '',
  nav: styles.nav ?? '',
  medium: styles.medium ?? '',
  large: styles.large ?? '',
};

/* -------------------------------------------------------------------------- */
/* The shapes                                                                 */
/* -------------------------------------------------------------------------- */

/* A filled dot, for the tittle of an `i` or the point of a `!`. */
const dot = (cx: number, cy: number) => (
  <circle cx={cx} cy={cy} r="0.95" fill="currentColor" stroke="none" />
);

const SHAPES = {
  /* --- Destinations ------------------------------------------------------ */

  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.6" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
      <rect x="3.5" y="14" width="7" height="6.5" rx="1.6" />
    </>
  ),

  announcements: (
    <>
      <path d="M4 10.2v3.6A1.2 1.2 0 0 0 5.2 15H7l7 4V5l-7 4H5.2A1.2 1.2 0 0 0 4 10.2Z" />
      <path d="M17.6 9.2a4 4 0 0 1 0 5.6" />
    </>
  ),

  notifications: (
    <>
      <path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
      <path d="M10.3 19a2 2 0 0 0 3.4 0" />
    </>
  ),

  degree: (
    <>
      <path d="M2.8 8.6 12 4.3l9.2 4.3L12 12.9 2.8 8.6Z" />
      <path d="M6.6 10.7V15c0 1.5 2.4 2.7 5.4 2.7s5.4-1.2 5.4-2.7v-4.3" />
      <path d="M20.6 9.3v4.4" />
    </>
  ),

  results: (
    <>
      <path d="M13.8 3.5H7.4A1.9 1.9 0 0 0 5.5 5.4v13.2a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9V8.2l-4.7-4.7Z" />
      <path d="M13.6 3.6v4.7h4.8" />
      <path d="M9 13h6M9 16.4h4" />
    </>
  ),

  /*
   * A bare sigma, not a sigma inside a box.
   *
   * The first draft framed it in a rounded rect like the other destination
   * glyphs. At the 16px these actually render, the container left the sigma
   * 3.6px wide and it mushed into a blob — visual QA caught it in the second
   * navigation tier. A glyph inside a container needs a container-sized icon;
   * at navigation size the glyph has to BE the icon.
   */
  gpa: <path d="M17 5.6H7.2l6.4 6.4-6.4 6.4H17" />,

  attendance: (
    <>
      <path d="M9.2 4.6H7.4A1.9 1.9 0 0 0 5.5 6.5v12.1a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9V6.5a1.9 1.9 0 0 0-1.9-1.9h-1.8" />
      <rect x="9.2" y="2.8" width="5.6" height="3.6" rx="1.3" />
      <path d="M9.4 13.6l1.8 1.8 3.5-3.7" />
    </>
  ),

  timetable: (
    <>
      <rect x="3.5" y="5.2" width="17" height="15.3" rx="2.8" />
      <path d="M3.5 10.1h17" />
      <path d="M8 3.5v3.4M16 3.5v3.4" />
    </>
  ),

  papers: (
    <>
      <rect x="4" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="9.6" y="4.5" width="4" height="15" rx="1.2" />
      <path d="M16.4 5.6l3.4 13.4" />
    </>
  ),

  account: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),

  profile: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.8" />
      <circle cx="8.8" cy="10.8" r="2.2" />
      <path d="M5.7 16.1a3.5 3.5 0 0 1 6.2 0" />
      <path d="M14.6 10.2h4.2M14.6 13.8h4.2" />
    </>
  ),

  /*
   * --- Actions ------------------------------------------------------------
   *
   * ONLY WHAT IS RENDERED. An earlier draft of this file carried the full
   * action vocabulary — edit, copy, download, sort, filter, close, more, and a
   * dozen others — on the theory that a design system should be complete. It
   * cost 1.77 kB (0.53 kB gzipped), which is affordable, and it was still the
   * wrong call: a name registry cannot tree-shake, so every one of those shapes
   * shipped to every student to be rendered by nothing.
   *
   * An icon nobody renders is not part of a system; it is a file of intentions.
   * Adding one back when a screen needs it is five lines and it arrives with
   * the call site that justifies it.
   */

  plus: <path d="M12 5.2v13.6M5.2 12h13.6" />,

  trash: (
    <>
      <path d="M4.6 6.6h14.8" />
      <path d="M9.6 6.6V5.2a1.6 1.6 0 0 1 1.6-1.6h1.6a1.6 1.6 0 0 1 1.6 1.6v1.4" />
      <path d="M6.6 6.6l.85 12a1.6 1.6 0 0 0 1.6 1.5h5.9a1.6 1.6 0 0 0 1.6-1.5l.85-12" />
      <path d="M10.4 10.2v6.4M13.6 10.2v6.4" />
    </>
  ),

  search: (
    <>
      <circle cx="10.6" cy="10.6" r="6.1" />
      <path d="M15 15l4.6 4.6" />
    </>
  ),

  external: (
    <>
      <path d="M14.2 4.6h5.2v5.2" />
      <path d="M19.4 4.6 11 13" />
      <path d="M17.8 13.8v4.6a1.9 1.9 0 0 1-1.9 1.9H5.9A1.9 1.9 0 0 1 4 18.4V8.4a1.9 1.9 0 0 1 1.9-1.9h4.6" />
    </>
  ),

  refresh: (
    <>
      <path d="M19.4 12a7.4 7.4 0 1 1-2.3-5.4" />
      <path d="M19.4 4.6v4.6h-4.6" />
    </>
  ),

  signOut: (
    <>
      <path d="M13.6 5.4H7.4A1.9 1.9 0 0 0 5.5 7.3v9.4a1.9 1.9 0 0 0 1.9 1.9h6.2" />
      <path d="M16.2 8.4 19.8 12l-3.6 3.6" />
      <path d="M19.8 12h-9.4" />
    </>
  ),

  arrowLeft: (
    <>
      <path d="M19 12H5.2" />
      <path d="M11 6.2 5.2 12 11 17.8" />
    </>
  ),

  chevronRight: <path d="M9.4 5.8 15.6 12l-6.2 6.2" />,

  /* --- Status ------------------------------------------------------------- */

  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11.2v5.4" />
      {dot(12, 8)}
    </>
  ),

  warning: (
    <>
      <path d="M10.7 4.4 3.3 17.2a1.5 1.5 0 0 0 1.3 2.3h14.8a1.5 1.5 0 0 0 1.3-2.3L13.3 4.4a1.5 1.5 0 0 0-2.6 0Z" />
      <path d="M12 9.6v4" />
      {dot(12, 16.5)}
    </>
  ),

  danger: (
    <>
      <path d="M8.7 3.6h6.6l4.1 4.1v6.6l-4.1 4.1H8.7l-4.1-4.1V7.7l4.1-4.1Z" />
      <path d="M12 8.1v4.4" />
      {dot(12, 15.6)}
    </>
  ),

  success: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.3 12.3l2.6 2.6 4.8-5.2" />
    </>
  ),

  lock: (
    <>
      <rect x="4.6" y="10.2" width="14.8" height="9.8" rx="2.6" />
      <path d="M8 10.2V7.6a4 4 0 0 1 8 0v2.6" />
    </>
  ),

  shield: (
    <>
      <path d="M12 3.4 5.2 6.1v5.3c0 4.1 2.8 7.5 6.8 9.2 4-1.7 6.8-5.1 6.8-9.2V6.1L12 3.4Z" />
      <path d="M9.2 12.2l2.1 2.1 3.8-4.1" />
    </>
  ),

  ban: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M6.1 6.1l11.8 11.8" />
    </>
  ),

  /* An empty container, for a list with nothing in it yet. */
  empty: (
    <>
      <path d="M3.6 13.4h4.1l1.3 2.4h6l1.3-2.4h4.1" />
      <path d="M5 5.7 3.6 13.4v3.6a2 2 0 0 0 2 2h12.8a2 2 0 0 0 2-2v-3.6L19 5.7a2 2 0 0 0-2-1.6H7a2 2 0 0 0-2 1.6Z" />
    </>
  ),

  /*
   * M9.6 — appearance and accent.
   *
   * The sun's rays are eight separate 2px runs rather than a dashed stroke:
   * dasharray scales with the icon and goes ragged at 12px, which is exactly
   * the size the theme control uses.
   */
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2.1M12 19.3v2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M2.6 12h2.1M19.3 12h2.1M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5" />
    </>
  ),
  /* One path, not a circle minus a circle: a mask would need a fill rule the
     rest of the set does not use, and a crescent is a legible shape on its own. */
  moon: <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z" />,
  /* `system` is a display, because "follow the device" is what it means. */
  system: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 19.5h6M12 16.5v3" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-1 .8-1.7 1.7-1.7h2a4.4 4.4 0 0 0 4.4-4.4c0-4.2-4-7.5-8.8-7.5Z" />
      <circle cx="7.6" cy="11.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="7.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="m4.8 12.4 4.6 4.6 9.8-9.8" />,
} as const;

export type IconName = keyof typeof SHAPES;

/* -------------------------------------------------------------------------- */
/* The component                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One icon.
 *
 * `<Icon name="attendance" size="nav" />` — and nothing else. There is no
 * `stroke`, no `color` and no numeric `size` prop, because every one of those
 * is a way for one icon to stop matching the other thirty-nine.
 */
export function Icon({
  name,
  size = 'nav',
  className,
}: {
  readonly name: IconName;
  readonly size?: IconSize;
  /** For a rare positional adjustment. Never for colour, size or stroke. */
  readonly className?: string | undefined;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${styles.icon ?? ''} ${SIZE_CLASS[size]} ${className ?? ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      /* Decoration, always. The meaning is in the text or the control's label. */
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
