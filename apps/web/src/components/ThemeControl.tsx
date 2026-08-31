/**
 * Appearance and accent, as a header control.
 *
 * Authority: docs/05 §5.21 (M9.6) · docs/27 §27.4
 * Reference: 21st.dev @lyanchouss/theme-switch — ADAPTED, not imported.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS TAKEN FROM THE REFERENCE, AND WHAT WAS NOT
 * ---------------------------------------------------------------------------
 *
 * Taken: the idea that a theme control is a small, tactile, visibly-stateful
 * object rather than a line in a settings page, and the sliding indicator that
 * makes the change feel like a physical switch.
 *
 * Not taken: `next-themes` (this is not a Next app, and lib/theme.ts is 30 lines
 * against a dependency), `lucide-react` (M9.5.2 removed the icon dependency on
 * purpose — see icons.tsx), and the two-state light/dark model.
 *
 * TWO STATES IS THE WRONG MODEL and it is the substantive change here. A
 * light/dark toggle has no way to say "follow my device", so a person whose
 * phone turns dark at sunset has to come back and do it by hand. The control is
 * therefore a three-way segment, and `system` is the default rather than an
 * afterthought at the end of the list.
 *
 * The accent row is not in the reference at all. It is five swatches, not a
 * colour picker, because an arbitrary hex cannot be contrast-checked (M9.6 §10).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import { ACCENTS, APPEARANCES, type Accent, type Appearance } from '../lib/theme.js';
import { useTheme } from '../hooks/useTheme.js';
import styles from './ThemeControl.module.css';

const APPEARANCE_META: Record<Appearance, { readonly label: string; readonly icon: IconName }> = {
  light: { label: 'Light', icon: 'sun' },
  dark: { label: 'Dark', icon: 'moon' },
  system: { label: 'System', icon: 'system' },
};

const ACCENT_LABEL: Record<Accent, string> = {
  violet: 'Violet',
  cyan: 'Cyan',
  amber: 'Amber',
  rose: 'Rose',
  green: 'Green',
};

/**
 * A popover that closes on Escape, on outside click, and returns focus.
 *
 * Written here rather than pulled from a library because it is the only
 * behaviour the header needs and it is short. If a third surface needs it, this
 * moves to `ui/` — two is not yet a pattern.
 */
function useDismissable(
  open: boolean,
  close: () => void,
  containerRef: React.RefObject<HTMLDivElement | null>,
  triggerRef: React.RefObject<HTMLButtonElement | null>,
): void {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      // Focus must come back to the trigger, or the tab order restarts at the
      // top of the document and the person loses their place (docs/27 §27.4).
      triggerRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target) === true) return;
      close();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close, containerRef, triggerRef]);
}

export function ThemeControl(): ReactNode {
  const { preference, resolved, setAppearance, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, containerRef, triggerRef);

  // Move focus into the panel when it opens, so a keyboard user is not left
  // pressing Tab through the rest of the header to reach what they just opened.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);

  const current = APPEARANCE_META[preference.appearance];

  return (
    <div className={styles.wrap} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        // The label states the CHOICE, not the resolved appearance: "System"
        // is what the person picked, and hiding that behind "Dark" would make
        // the control lie about its own state.
        aria-label={`Theme: ${current.label}. Change appearance and accent`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={current.icon} size="nav" />
      </button>

      {open ? (
        <div ref={panelRef} className={styles.panel} role="dialog" aria-label="Theme">
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Appearance</legend>
            <div className={styles.segment}>
              {APPEARANCES.map((appearance) => {
                const meta = APPEARANCE_META[appearance];
                const selected = preference.appearance === appearance;
                return (
                  <button
                    key={appearance}
                    type="button"
                    className={styles.segmentItem}
                    aria-pressed={selected}
                    onClick={() => setAppearance(appearance)}
                  >
                    <Icon name={meta.icon} size="small" />
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
            {preference.appearance === 'system' ? (
              <p className={styles.hint}>Following your device — currently {resolved}.</p>
            ) : null}
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Accent</legend>
            <div className={styles.accents}>
              {ACCENTS.map((accent) => {
                const selected = preference.accent === accent;
                return (
                  <button
                    key={accent}
                    type="button"
                    data-accent={accent}
                    className={styles.swatch}
                    aria-pressed={selected}
                    aria-label={ACCENT_LABEL[accent]}
                    title={ACCENT_LABEL[accent]}
                    onClick={() => setAccent(accent)}
                  >
                    {/* The tick is the state, not just the ring: colour alone
                        must never be the only indicator (docs/27 §27.2). */}
                    {selected ? <Icon name="check" size="micro" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
