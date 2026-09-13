/**
 * A sheet — a panel that slides in from an edge.
 *
 * Authority: docs/05 §5.26 (M9.6E) · docs/27 §27.4 · Phase 7B §2, §12
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. shadcn's Sheet is its Dialog with a `side`
 * prop, and so is this one: the behaviour is `@radix-ui/react-dialog`, the
 * appearance is the GradTools module beside this file. The Tailwind classes are
 * not reproduced.
 *
 * ---------------------------------------------------------------------------
 * WHY A SHEET AND NOT A DIALOG
 * ---------------------------------------------------------------------------
 *
 * On a phone, a nine-column mark table cannot be shown at 390px and must not
 * be scrolled sideways (M9.6E §10, §31). The row stays a summary and the
 * detail arrives in a sheet from the bottom — the pattern a phone user already
 * knows from their operating system, and one that keeps the list underneath
 * visible as context.
 *
 * On a desktop the same component enters from the right, where it does not
 * cover the table it was opened from.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PORT ONTO RADIX CHANGED
 * ---------------------------------------------------------------------------
 *
 * The API is unchanged; the machinery underneath is gone. Deleted with it:
 *
 *   - a hand-written focus trap that queried `button, [href], input` and so
 *     could not see a `<select>`, a `<textarea>` or a `[tabindex]` — and the
 *     sheet's whole purpose is to hold the detail form,
 *   - a two-frame `requestAnimationFrame` dance to get a transition to play,
 *     replaced by Radix's `data-state` and its presence handling, which also
 *     animates the EXIT the old version could not,
 *   - manual `body.style.overflow` locking, which forgot the scrollbar-width
 *     compensation and so shifted the page under the sheet on desktop.
 */

import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Icon } from '../icons.js';
import styles from './Sheet.module.css';

export interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** A line under the title. Context, never the content itself. */
  readonly description?: string;
  readonly side?: 'right' | 'bottom';
  readonly children: ReactNode;
  /** Actions pinned to the foot, above the safe area. */
  readonly footer?: ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  side = 'right',
  children,
  footer,
}: SheetProps): ReactNode {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={`${styles.overlay ?? ''} surfaceScrim`} />
        <DialogPrimitive.Content className={`${styles.panel ?? ''} surfacePanel`} data-side={side}>
          <div className={styles.head}>
            <div className={styles.heading}>
              <DialogPrimitive.Title className={styles.title}>{title}</DialogPrimitive.Title>
              {description === undefined ? (
                <DialogPrimitive.Description hidden />
              ) : (
                <DialogPrimitive.Description className={styles.description}>
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className={styles.close} aria-label="Close">
              <Icon name="close" size="nav" />
            </DialogPrimitive.Close>
          </div>

          <div className={styles.body}>{children}</div>

          {footer !== undefined ? <div className={styles.foot}>{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
