/**
 * A context/row-action menu.
 *
 * Authority: docs/05 §5.22 (M9.6B) · docs/27 §27.4
 * Reference: 21st.dev @chetanverma16/dropdown-menu — RECREATED. Accessible
 * evidence was the preview, the `{label, onClick, Icon}[]` option shape and the
 * dependency list (framer-motion + lucide-react); the source was not
 * retrievable.
 *
 * The reference's springy scale-and-rise entrance is reproduced in CSS. Its two
 * dependencies are not: a 96%-to-100% scale with a slight overshoot is one
 * keyframe, and it does not need an animation runtime.
 *
 * MENUS HIDE THINGS, so this is used only where an action is genuinely
 * secondary — edit and delete on a row that already shows its primary action.
 * A destructive item is marked `tone: 'danger'` and always sits last, after a
 * separator, because the muscle-memory click lands at the top.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import { useDismissable } from '../../hooks/useDismissable.js';
import styles from './DropdownMenu.module.css';

export interface MenuItem {
  readonly label: string;
  readonly icon?: IconName;
  readonly onSelect: () => void;
  readonly tone?: 'default' | 'danger';
  readonly disabled?: boolean;
}

export interface DropdownMenuProps {
  /** Names the menu for assistive technology, e.g. "Actions for BXXX401". */
  readonly label: string;
  readonly items: readonly MenuItem[];
  /** Right-aligned by default; a menu near the left edge should open leftward. */
  readonly align?: 'start' | 'end';
}

export function DropdownMenu({ label, items, align = 'end' }: DropdownMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);
  useDismissable({ open, onDismiss: close, surfaceRef: menuRef, triggerRef, closeOnScroll: true });

  const step = useCallback(
    (from: number, direction: 1 | -1) => {
      const count = items.length;
      for (let offset = 1; offset <= count; offset += 1) {
        const next = (from + direction * offset + count * count) % count;
        if (items[next]?.disabled !== true) return next;
      }
      return from;
    },
    [items],
  );

  const run = (item: MenuItem): void => {
    if (item.disabled === true) return;
    close();
    triggerRef.current?.focus();
    item.onSelect();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
        setActive(step(-1, 1));
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
        setActive((current) => step(current === -1 ? 0 : current, -1));
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[active];
        if (item !== undefined) run(item);
        break;
      }
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  };

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onKeyDown}
      >
        {/* Three dots, drawn inline: a 2px dot trio is not worth an icon slot. */}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="12" cy="5" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="19" r="1.6" fill="currentColor" />
        </svg>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          data-align={align}
          className={`${styles.menu ?? ''} glassPanel`}
          onKeyDown={onKeyDown}
        >
          {items.map((item, index) => {
            const danger = item.tone === 'danger';
            const separated = danger && items[index - 1]?.tone !== 'danger';
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled === true}
                data-active={index === active}
                data-danger={danger}
                data-separated={separated}
                className={styles.item}
                onPointerEnter={() => setActive(index)}
                onClick={() => run(item)}
              >
                {item.icon !== undefined ? <Icon name={item.icon} size="small" /> : null}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
