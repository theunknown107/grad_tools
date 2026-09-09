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
export type Appearance = (typeof APPEARANCES)[number];

/**
 * The curated accents.
 *
 * A fixed list, not a colour picker (M9.6 §10). Every entry is contrast-checked
 * against both grounds by `theme.test.ts`; an arbitrary hex from a user could
 * not be, and would eventually produce an unreadable interface that looks like
 * our bug rather than their choice.
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
] as const;
export type Accent = (typeof ACCENTS)[number];

/**
 * Accents that were renamed when the approved design replaced the palette.
 *
 * A stored value the list no longer contains fails `isAccent` and silently
 * resets the student to the default, so the two hues that were renamed rather
 * than removed are carried across to their successors. This is a migration,
 * not an alias: nothing reads these names after the preference is next
 * written, and no NEW code may use them.
 */
const RENAMED_ACCENTS: Readonly<Record<string, Accent>> = {
  cyan: 'turquoise',
  green: 'emerald',
};

export interface ThemePreference {
  readonly appearance: Appearance;
  readonly accent: Accent;
}

/**
 * What a student sees before they have chosen anything.
 *
 * LIGHT, not system (M10A.9 §26). GradTools is used in daylight, in lecture
 * halls and on library desks, and the light interface is the one the product is
 * designed around. "System" remains available and an explicit choice always
 * wins — this is only the answer for someone who has not given one.
 */
export const DEFAULT_THEME: ThemePreference = { appearance: 'light', accent: 'mono' };

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
 * is removed, which is what lets the `prefers-color-scheme` blocks in
 * tokens.css take over — the three-state contract docs/05 §5.10 describes.
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
}

/** Which appearance `system` currently resolves to. */
export function resolveAppearance(
  appearance: Appearance,
  prefersDark: boolean,
): Exclude<Appearance, 'system'> {
  if (appearance !== 'system') return appearance;
  return prefersDark ? 'dark' : 'light';
}
