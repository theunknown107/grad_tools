/**
 * A context/row-action menu.
 *
 * Authority: docs/05 §5.22 (M9.6B) · docs/27 §27.4 · Phase 7B §2, §12
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. The behaviour is
 * `@radix-ui/react-dropdown-menu`. The springy scale-and-rise entrance from the
 * 21st.dev reference is kept, expressed in CSS keyed on Radix's `data-state`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PORT ONTO RADIX BOUGHT
 * ---------------------------------------------------------------------------
 *
 * The previous implementation was a hand-written state machine over `active`
 * index plus a `step()` wrap-around. It handled ArrowUp/ArrowDown/Enter/Space
 * and Tab. It did not handle — and each of these is in the WAI-ARIA menu
 * pattern that Radix implements:
 *
 *   - TYPEAHEAD. Pressing "d" should jump to "Delete this semester". On a menu
 *     of two that is a nicety; on the subject and filter menus this component
 *     is now used for, it is the difference between a menu and a list.
 *   - Home / End.
 *   - Collision-aware placement, so a menu on the last row of a long table
 *     opens upward instead of off the bottom of the viewport.
 *   - Focus returned to the trigger on Escape as well as on select.
 *   - Pointer-vs-keyboard `data-highlighted` distinction, so moving the mouse
 *     does not fight the arrow keys.
 *
 * MENUS HIDE THINGS, so this is used only where an action is genuinely
 * secondary — edit and delete on a row that already shows its primary action.
 * A destructive item is marked `tone: 'danger'` and always sits last, after a
 * separator, because the muscle-memory click lands at the top.
 */

import type { ReactNode } from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Icon, type IconName } from '../icons.js';
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
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger className={styles.trigger} aria-label={label}>
        {/* Three dots, drawn inline: a 2px dot trio is not worth an icon slot. */}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="12" cy="5" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="19" r="1.6" fill="currentColor" />
        </svg>
      </MenuPrimitive.Trigger>

      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          className={`${styles.menu ?? ''} surfacePanel`}
          align={align}
          sideOffset={6}
          /*
           * The menu is the last row's only action on a long results page, so
           * it must be allowed to flip above the trigger rather than open off
           * the bottom of the viewport. `collisionPadding` keeps it clear of
           * the sticky header at the top of the flip.
           */
          collisionPadding={8}
        >
          {items.map((item, index) => {
            const danger = item.tone === 'danger';
            const separated = danger && items[index - 1]?.tone !== 'danger';
            return (
              <MenuPrimitive.Item
                key={item.label}
                className={styles.item}
                disabled={item.disabled === true}
                data-danger={danger}
                data-separated={separated}
                /*
                 * `textValue` is what Radix's typeahead matches against. Without
                 * it the primitive falls back to the node's text content, which
                 * here begins with an SVG and so matches nothing.
                 */
                textValue={item.label}
                onSelect={item.onSelect}
              >
                {item.icon !== undefined ? <Icon name={item.icon} size="small" /> : null}
                <span>{item.label}</span>
              </MenuPrimitive.Item>
            );
          })}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
