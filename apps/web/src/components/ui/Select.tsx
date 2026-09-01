/**
 * Select — a listbox with a glass options panel.
 *
 * Authority: docs/05 §5.22 (M9.6B) · docs/27 §27.3
 * Reference: 21st.dev @preetsuthar17/select — RECREATED. The reference's source
 * was not retrievable (see docs/05 §5.22); what was accessible was its preview,
 * its API shape and its dependency list.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT RADIX, WHICH IS WHAT THE REFERENCE USES
 * ---------------------------------------------------------------------------
 *
 * The reference is `@radix-ui/react-select` + `motion` + `lucide-react` +
 * `class-variance-authority` — four dependencies for one control. Radix earns
 * its weight when you need portalling, collision detection and typeahead
 * across a large app. Here the requirement is a semester picker and a handful
 * of filters, and the keyboard contract for a listbox is short enough to
 * implement correctly and read in one sitting.
 *
 * What IS taken from the reference: the visual model. A trigger that looks like
 * an input rather than a native select, an optional leading icon, a floating
 * panel with its own material, a check on the selected row, and a springy
 * entrance.
 *
 * ---------------------------------------------------------------------------
 * THE KEYBOARD CONTRACT (WAI-ARIA listbox)
 * ---------------------------------------------------------------------------
 *
 *   Enter / Space / Down   open, focus the selected option
 *   Up / Down              move the active option
 *   Home / End             first / last
 *   Enter                  commit the active option
 *   Escape                 close, keep the previous value, focus the trigger
 *   Tab                    close and move on
 *
 * `aria-activedescendant` is used rather than moving DOM focus, so the trigger
 * keeps focus while the highlighted row changes — the pattern a screen reader
 * expects from a collapsed listbox.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import { useDismissable } from '../../hooks/useDismissable.js';
import styles from './Select.module.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** Shown under the label. For a subject code's title, a scheme's year. */
  readonly hint?: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly icon?: IconName;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Visually hide the label but keep it for assistive technology. */
  readonly hideLabel?: boolean;
}

export function Select({
  label,
  value,
  options,
  onChange,
  icon,
  placeholder = 'Select…',
  disabled = false,
  hideLabel = false,
}: SelectProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback(() => setOpen(false), []);
  useDismissable({ open, onDismiss: close, surfaceRef: listRef, triggerRef, closeOnScroll: true });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // Opening starts from the current value, not from the top: a semester picker
  // that always opens on "Semester 1" makes the person re-find their place.
  const openList = useCallback(() => {
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (option === undefined || option.disabled === true) return;
      onChange(option.value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [options, onChange],
  );

  /** Skips disabled rows so arrow keys never park on something unusable. */
  const step = useCallback(
    (from: number, direction: 1 | -1) => {
      const count = options.length;
      for (let offset = 1; offset <= count; offset += 1) {
        const next = (from + direction * offset + count * count) % count;
        if (options[next]?.disabled !== true) return next;
      }
      return from;
    },
    [options],
  );

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((current) => step(current, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((current) => step(current, -1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(step(-1, 1));
        break;
      case 'End':
        event.preventDefault();
        setActive(step(options.length, -1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(active);
        break;
      case 'Tab':
        // Tab commits nothing and closes: the value only changes on Enter.
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className={styles.wrap}>
      <span className={hideLabel ? styles.labelHidden : styles.label} id={`${id}-label`}>
        {label}
      </span>

      <button
        ref={triggerRef}
        type="button"
        id={`${id}-trigger`}
        className={`${styles.trigger ?? ''} glassInput`}
        role="combobox"
        aria-controls={`${id}-list`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${id}-label ${id}-trigger`}
        aria-activedescendant={open ? `${id}-option-${String(active)}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {icon !== undefined ? (
          <Icon name={icon} size="nav" className={styles.leading ?? ''} />
        ) : null}
        <span className={selected === undefined ? styles.placeholder : styles.value}>
          {selected?.label ?? placeholder}
        </span>
        <Icon name="chevronRight" size="small" className={styles.chevron ?? ''} />
      </button>

      {open ? (
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className={`${styles.list ?? ''} glassPanel`}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${String(index)}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled === true}
              data-active={index === active}
              className={styles.option}
              // pointerdown, not click: the dismiss listener fires on
              // pointerdown, and click would arrive after the panel is gone.
              onPointerDown={(event) => {
                event.preventDefault();
                commit(index);
              }}
              onPointerEnter={() => setActive(index)}
            >
              <span className={styles.optionText}>
                <span className={styles.optionLabel}>{option.label}</span>
                {option.hint !== undefined ? (
                  <span className={styles.optionHint}>{option.hint}</span>
                ) : null}
              </span>
              {option.value === value ? <Icon name="check" size="small" /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
