/**
 * The student's initials, in a filled accent disc.
 *
 * Authority: Figma Make `lib/ui.tsx` — Avatar
 *
 * ---------------------------------------------------------------------------
 * ONE AVATAR, TWO PLACES
 * ---------------------------------------------------------------------------
 *
 * The design uses this in the sidebar footer at 32px and in the top bar at
 * 34px, and those are the only two sizes that exist. It lives here rather than
 * in either of them so the two cannot drift into being different components
 * that happen to look alike.
 *
 * ---------------------------------------------------------------------------
 * NO INVENTED INITIALS
 * ---------------------------------------------------------------------------
 *
 * The design's prototype reads `student.initials` from a fixture. There is no
 * such field in production: a profile may have no display name at all, and a
 * student who has not told us their name must not be shown someone else's
 * letters or a cheerful "GT". So an absent name falls back to the mortarboard —
 * the same glyph as the brand mark — which says "your account" without
 * claiming to know who that is.
 */

import { Icon } from '../icons.js';
import styles from './Avatar.module.css';

/**
 * First letters of the first and last word, at most two.
 *
 * Deliberately naive, and that is the right amount of cleverness: a person's
 * name is theirs to write, and a parser that tries to be smart about particles,
 * initials and honorifics gets somebody's name wrong in a way they can see
 * every time they open the app.
 */
export function initialsOf(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  const letters = `${first}${last}`.toUpperCase();
  return letters === '' ? null : letters;
}

export function Avatar({
  name,
  size = 32,
}: {
  readonly name?: string | null;
  /** 32 in the sidebar footer, 34 in the top bar. Nothing else uses it. */
  readonly size?: number;
}) {
  const initials = initialsOf(name);

  return (
    <span
      className={styles.avatar}
      /*
       * The two sizes differ by 2px and the type scales with them, so this is
       * a genuine per-instance measurement rather than a token. `0.4` is the
       * design's own ratio.
       */
      style={{ inlineSize: size, blockSize: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {initials ?? <Icon name="degree" size="nav" />}
    </span>
  );
}
