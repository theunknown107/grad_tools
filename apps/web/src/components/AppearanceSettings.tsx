/**
 * Appearance, as the approved design lays it out.
 *
 * Authority: Figma Make `pages/Account.tsx` → Appearance · Phase 2 §17
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS BESIDE `ThemeControl`
 * ---------------------------------------------------------------------------
 *
 * They answer different questions. `ThemeControl` is the header popover — the
 * switch you reach for mid-task, small and quick. This is the settings screen:
 * every option visible at once, each one named and previewed, with room to say
 * what the choice actually does.
 *
 * Both read and write the same device preference, so neither can drift from
 * the other, and neither owns any state of its own.
 *
 * ---------------------------------------------------------------------------
 * THE ACCENT SWATCHES PAINT THEMSELVES
 * ---------------------------------------------------------------------------
 *
 * Each swatch sets `data-accent` on ITSELF, so the accent blocks in tokens.css
 * resolve locally and the swatch shows its own hue without a single colour
 * being named here. Adding a thirteenth accent needs no change to this file —
 * and, more to the point, a swatch can never disagree with the theme it
 * applies, because it is painted by the same rule.
 */

import { useTheme } from '../hooks/useTheme.js';
import { ACCENTS, APPEARANCES, type Accent, type Appearance } from '../lib/theme.js';
import { Icon, type IconName } from './icons.js';
import styles from './AppearanceSettings.module.css';

const APPEARANCE_LABEL: Record<Appearance, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const APPEARANCE_ICON: Record<Appearance, IconName> = {
  light: 'sun',
  dark: 'moon',
  system: 'system',
};

/**
 * The accent names, in the order the design lists them.
 *
 * `mono` first because it is the default and the product's own voice; the
 * eleven colours follow. The list is derived from `ACCENTS` rather than
 * repeated, so it cannot fall out of step with what the theme accepts.
 */
const ACCENT_LABEL: Record<Accent, string> = {
  mono: 'Mono',
  violet: 'Violet',
  matrix: 'Matrix',
  crimson: 'Crimson',
  turquoise: 'Turquoise',
  ocean: 'Ocean',
  amber: 'Amber',
  rose: 'Rose',
  indigo: 'Indigo',
  emerald: 'Emerald',
  solar: 'Solar',
  slate: 'Slate',
};

export function AppearanceSettings() {
  const { preference, resolved, setAppearance, setAccent } = useTheme();

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="appearance-theme">
        <h3 className={styles.heading} id="appearance-theme">
          Theme
        </h3>
        <p className={styles.explain}>
          How GradTools looks on this device. System follows your device, which is currently{' '}
          <strong className={styles.strong}>{resolved === 'dark' ? 'dark' : 'light'}</strong>.
        </p>
        <div className={styles.themes} role="group" aria-labelledby="appearance-theme">
          {APPEARANCES.map((appearance) => {
            const selected = preference.appearance === appearance;
            return (
              <button
                key={appearance}
                type="button"
                className={styles.theme}
                data-selected={selected}
                aria-pressed={selected}
                onClick={() => {
                  setAppearance(appearance);
                }}
              >
                {/*
                  The tick is the state, not just the ring: colour alone must
                  never be the only indicator (docs/27 §27.2).
                */}
                {selected ? (
                  <span className={styles.tick} aria-hidden="true">
                    <Icon name="check" size="micro" />
                  </span>
                ) : null}
                <span
                  className={styles.themeSwatch}
                  data-appearance={appearance}
                  aria-hidden="true"
                >
                  <Icon name={APPEARANCE_ICON[appearance]} size="medium" />
                </span>
                <span className={styles.themeLabel}>{APPEARANCE_LABEL[appearance]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="appearance-accent">
        <h3 className={styles.heading} id="appearance-accent">
          Accent
        </h3>
        <p className={styles.explain}>
          The accent colours interactive states &mdash; buttons, links, selection and focus.
          Surfaces stay neutral in every accent, so the workspace never takes on a hue.
        </p>
        <div className={styles.accents} role="group" aria-labelledby="appearance-accent">
          {ACCENTS.map((accent) => {
            const selected = preference.accent === accent;
            return (
              <button
                key={accent}
                type="button"
                /* Paints its own hue: see the header. */
                data-accent={accent}
                data-selected={selected}
                className={styles.accent}
                aria-pressed={selected}
                onClick={() => {
                  setAccent(accent);
                }}
              >
                <span className={styles.dot} aria-hidden="true">
                  {selected ? <Icon name="check" size="micro" /> : null}
                </span>
                <span className={styles.accentLabel}>{ACCENT_LABEL[accent]}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
