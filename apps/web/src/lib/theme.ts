/**
 * Appearance and accent, persisted on the device.
 *
 * Authority: docs/05 §5.10, §5.21 (M9.6) · docs/12 §12.17
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DEVICE STATE AND NOT ACCOUNT STATE
 * ---------------------------------------------------------------------------
 *
 * A theme answers "what does this screen, in this room, at this hour, do to my
 * eyes" — a property of the device, not of the student. Someone reading on a
 * phone at midnight and on a library desktop at noon wants different answers,
 * and syncing the preference would push each device's answer onto the other.
 *
 * So the preference is written to `localStorage` under a key that is NOT
 * account-scoped, deliberately unlike every repository key
 * (`gradtools:v1:u:<id>:...`). It survives sign-out, it never enters a sync
 * payload, and it is one of the few pieces of state a signed-in student and an
 * anonymous one share. docs/32 DEC-039 records the reasoning; if a later
 * decision reverses it, the account preference becomes a DEFAULT that this
 * value still overrides locally.
 *
 * NOTHING HERE MAY REACH A CALCULATION. Appearance is presentation. No academic
 * rule, no repository read and no API request may branch on it.
 */

export const APPEARANCES = ['light', 'dark', 'system'] as const;

/**
 * How much room the interface gives itself.
 *
 * The design offers the same pair. `compact` tightens the spacing scale by the
 * ratio its own density uses; it deliberately does not shrink controls — see
 * the compact-density block in styles/index.css.
 */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/**
 * How see-through the glass surfaces are (styles/index.css "Liquid glass").
 * Solid is not a level here: it is `reducedTransparency`, which also honours
 * the operating system's setting.
 */
export const GLASS_LEVELS = ['clear', 'regular', 'frosted'] as const;
export type Glass = (typeof GLASS_LEVELS)[number];
export type Appearance = (typeof APPEARANCES)[number];

/**
 * The curated palettes.
 *
 * A fixed list, not a colour picker (M9.6 §10). Every entry is contrast-checked
 * against both grounds by `theme.test.ts`; an arbitrary hex from a user could
 * not be, and would eventually produce an unreadable interface that looks like
 * our bug rather than their choice.
 *
 * The id is the stored value and never changes; the name a student sees lives
 * in `ACCENT_INFO`. Three groups (docs/51_THEMES.md has the sources):
 *
 *   current   the twelve accents since 3c15ff5 (2026-09-09).
 *   original  the five accents of the first theme system, 177a23e
 *             (2026-08-31), restored with their own hue stops. Only the
 *             accents are restored: that system's violet-black surfaces are
 *             not, so these are not reproductions of the August interface.
 *   new       Crimson tinted, the near-black red theme approved in the
 *             design exploration. The only palette that also sets surfaces.
 *
 * Production Crimson and Crimson tinted are different palettes on purpose.
 */
export const ACCENTS = [
  'mono',
  'violet',
  'matrix',
  'crimson',
  'turquoise',
  'ocean',
  'amber',
  'rose',
  'indigo',
  'emerald',
  'solar',
  'slate',
  'original-violet',
  'original-cyan',
  'original-amber',
  'original-rose',
  'original-green',
  'crimson-tinted',
] as const;
export type Accent = (typeof ACCENTS)[number];

export type AccentGroup = 'current' | 'original' | 'new';

export const ACCENT_GROUPS: readonly { readonly id: AccentGroup; readonly label: string }[] = [
  { id: 'current', label: 'Current palettes' },
  { id: 'original', label: 'Original August 2026 palettes' },
  { id: 'new', label: 'New palettes' },
];

/**
 * Display name, group and selector swatch for each palette. The swatch is the
 * palette's `--accent` in each appearance, the same value the stylesheet uses
 * (theme.test.ts holds the two to each other).
 */
export const ACCENT_INFO: Readonly<
  Record<Accent, { label: string; group: AccentGroup; light: string; dark: string }>
> = {
  mono: { label: 'Mono', group: 'current', light: '#1b1a17', dark: '#f4f3f1' },
  violet: { label: 'Violet', group: 'current', light: '#5b4cc4', dark: '#8f80f0' },
  matrix: { label: 'Matrix', group: 'current', light: '#2a7147', dark: '#4bbd7f' },
  crimson: { label: 'Crimson', group: 'current', light: '#8b0015', dark: '#bd1a33' },
  turquoise: { label: 'Turquoise', group: 'current', light: '#0a7580', dark: '#35c2cf' },
  ocean: { label: 'Ocean', group: 'current', light: '#2b6cb0', dark: '#5ea1e6' },
  amber: { label: 'Amber', group: 'current', light: '#8f5d12', dark: '#e0a848' },
  rose: { label: 'Rose', group: 'current', light: '#be2f65', dark: '#f0709b' },
  indigo: { label: 'Indigo', group: 'current', light: '#4338ca', dark: '#818cf8' },
  emerald: { label: 'Emerald', group: 'current', light: '#047857', dark: '#34d399' },
  solar: { label: 'Solar', group: 'current', light: '#a14a08', dark: '#f0932e' },
  slate: { label: 'Slate', group: 'current', light: '#475569', dark: '#94a3b8' },
  'original-violet': { label: 'Violet', group: 'original', light: '#6d4de0', dark: '#a48bff' },
  'original-cyan': { label: 'Cyan', group: 'original', light: '#0e7490', dark: '#55d6e8' },
  'original-amber': { label: 'Amber', group: 'original', light: '#a3620a', dark: '#f0b445' },
  'original-rose': { label: 'Rose', group: 'original', light: '#be123c', dark: '#ff8fa3' },
  'original-green': { label: 'Green', group: 'original', light: '#15803d', dark: '#4fd9a0' },
  'crimson-tinted': { label: 'Crimson tinted', group: 'new', light: '#b0142f', dark: '#dc2a47' },
};

/** The name to announce: original palettes say so, since three share a name. */
export function accentName(accent: Accent): string {
  const info = ACCENT_INFO[accent];
  return info.group === 'original' ? `${info.label} (original)` : info.label;
}

/**
 * Accents that were renamed when the approved design replaced the palette.
 *
 * A stored value the list no longer contains fails `isAccent` and silently
 * resets the student to the default, so the two hues that were renamed rather
 * than removed are carried across to their successors. This is a migration,
 * not an alias: nothing reads these names after the preference is next
 * written, and no NEW code may use them.
 *
 * The original Cyan and Green are selectable again under the ids
 * `original-cyan` and `original-green`. A device that stored the bare old id
 * keeps the successor it has shown since September rather than changing colour
 * on update.
 */
const RENAMED_ACCENTS: Readonly<Record<string, Accent>> = {
  cyan: 'turquoise',
  green: 'emerald',
};

export interface ThemePreference {
  readonly appearance: Appearance;
  readonly accent: Accent;
  /**
   * An explicit request for less motion, from the design's Interface section.
   *
   * SEPARATE FROM the operating system's `prefers-reduced-motion`, which every
   * stylesheet already honours on its own. This is the person who has not set
   * it system-wide but wants this product still. It can only ever turn motion
   * DOWN: there is no value here that overrides the system asking for less.
   */
  readonly reducedMotion: boolean;
  /**
   * An explicit request for opaque surfaces instead of glass. Like
   * `reducedMotion`, an addition to the operating system's
   * `prefers-reduced-transparency`, never a replacement: it can only make the
   * material more opaque.
   */
  readonly reducedTransparency: boolean;
  readonly glass: Glass;
  readonly density: Density;
}

/**
 * What a student sees before they have chosen anything.
 *
 * LIGHT, not system (M10A.9 §26). GradTools is used in daylight, in lecture
 * halls and on library desks, and the light interface is the one the product is
 * designed around. "System" remains available and an explicit choice always
 * wins — this is only the answer for someone who has not given one.
 */
export const DEFAULT_THEME: ThemePreference = {
  appearance: 'light',
  accent: 'mono',
  /* Off by default: the system preference is already being honoured, and this
     is an addition to it rather than a replacement for it. */
  reducedMotion: false,
  reducedTransparency: false,
  glass: 'regular',
  /* The roomier of the two, which is what every screen was designed against. */
  density: 'comfortable',
};

/** Device-scoped on purpose — see the header. */
export const THEME_STORAGE_KEY = 'gradtools:v1:theme';

const isAppearance = (v: unknown): v is Appearance =>
  typeof v === 'string' && (APPEARANCES as readonly string[]).includes(v);
const isAccent = (v: unknown): v is Accent =>
  typeof v === 'string' && (ACCENTS as readonly string[]).includes(v);

/**
 * Reads the stored preference, falling back field by field.
 *
 * A corrupt or partly-written value yields the default for the field that is
 * wrong and keeps the field that is right, because losing someone's accent
 * because their appearance failed to parse is a worse outcome than either.
 * Storage access itself can throw — Safari private mode, disabled site data —
 * so the whole read is guarded.
 */
export function readStoredTheme(storage: Pick<Storage, 'getItem'>): ThemePreference {
  let raw: string | null = null;
  try {
    raw = storage.getItem(THEME_STORAGE_KEY);
  } catch {
    return DEFAULT_THEME;
  }
  if (raw === null) return DEFAULT_THEME;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_THEME;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_THEME;

  const record = parsed as Record<string, unknown>;
  return {
    appearance: isAppearance(record['appearance'])
      ? record['appearance']
      : DEFAULT_THEME.appearance,
    accent: accentFrom(record['accent']),
    reducedMotion: record['reducedMotion'] === true,
    reducedTransparency: record['reducedTransparency'] === true,
    glass: (GLASS_LEVELS as readonly unknown[]).includes(record['glass'])
      ? (record['glass'] as Glass)
      : DEFAULT_THEME.glass,
    density: record['density'] === 'compact' ? 'compact' : DEFAULT_THEME.density,
  };
}

/** A stored accent, its renamed successor, or the default. */
function accentFrom(stored: unknown): Accent {
  if (isAccent(stored)) return stored;
  if (typeof stored === 'string' && stored in RENAMED_ACCENTS) {
    return RENAMED_ACCENTS[stored] as Accent;
  }
  return DEFAULT_THEME.accent;
}

/** Writes the preference. A failure to persist must never break the UI. */
export function writeStoredTheme(
  storage: Pick<Storage, 'setItem'>,
  preference: ThemePreference,
): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* Storage unavailable: the theme still applies for this session. */
  }
}

/**
 * Applies the preference to the document element.
 *
 * `data-theme` is set only for an EXPLICIT choice. Under `system` the attribute
 * is removed; the `.dark` class then follows the device's colour scheme (the
 * pre-paint script and `ThemeProvider` both resolve it) — the three-state
 * contract docs/05 §5.10 describes.
 *
 * `color-scheme` is set alongside it so the browser's own surfaces — form
 * controls, scrollbars, the canvas behind the page — follow the choice. Without
 * it an explicitly dark page keeps light scrollbars.
 */
export function applyTheme(root: HTMLElement, preference: ThemePreference): void {
  if (preference.appearance === 'system') {
    root.removeAttribute('data-theme');
    root.style.colorScheme = 'light dark';
  } else {
    root.setAttribute('data-theme', preference.appearance);
    root.style.colorScheme = preference.appearance;
  }
  root.setAttribute('data-accent', preference.accent);
  /*
   * An ATTRIBUTE, not a class, and absent rather than false when off — so the
   * stylesheet's one reduced-motion block can be written as a plain selector
   * and never has to fight a `[data-motion='full']`.
   */
  if (preference.reducedMotion) root.setAttribute('data-motion', 'reduced');
  else root.removeAttribute('data-motion');
  if (preference.reducedTransparency) root.setAttribute('data-transparency', 'reduced');
  else root.removeAttribute('data-transparency');
  root.setAttribute('data-glass', preference.glass);
  /* Absent rather than 'comfortable', for the same reason as the line above:
     the stylesheet's compact block is then a plain selector. */
  if (preference.density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
}

/** Which appearance `system` currently resolves to. */
export function resolveAppearance(
  appearance: Appearance,
  prefersDark: boolean,
): Exclude<Appearance, 'system'> {
  if (appearance !== 'system') return appearance;
  return prefersDark ? 'dark' : 'light';
}
