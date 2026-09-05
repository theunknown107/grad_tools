/**
 * A sheet — a panel that slides in from an edge.
 *
 * Authority: docs/05 §5.26 (M9.6E) · docs/27 §27.4
 * Provenance: SHADCN STRUCTURE, CUSTOM BEHAVIOUR. Source of
 * `registry/bases/base/ui/sheet.tsx` retrieved via the shadcn skill.
 *
 * Taken from the source: the composition (overlay + portalled popup), the
 * `side` prop, and the entrance/exit model — shadcn animates a 2.5rem
 * translate against opacity via `data-starting-style` / `data-ending-style`,
 * and that offset and pairing are reproduced here.
 *
 * Not taken: `@base-ui/react/dialog` and the Tailwind class strings. docs/05
 * §5.25 records the reasoning — GradTools has no Tailwind, and every imported
 * component has to be restyled to GradTools tokens regardless.
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
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDismissable, useFocusTrap } from '../../hooks/useDismissable.js';
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
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useDismissable({ open, onDismiss: onClose, surfaceRef: panelRef });
  useFocusTrap(open, panelRef);

  /*
   * Two frames of lifecycle, because a CSS transition needs a FROM state that
   * was actually painted. Mounting straight into the final position gives no
   * transition at all; `mounted` flips on the next frame so the panel has a
   * closed state to move away from.
   */
  useEffect(() => {
    if (!open) {
      setMounted(false);
      return;
    }
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Focus lands inside, and returns to whatever opened the sheet on close.
  useEffect(() => {
    if (!open) {
      restoreTo.current?.focus();
      return;
    }
    panelRef.current?.querySelector<HTMLElement>('button, [href], input')?.focus();
  }, [open]);

  /*
   * The page behind must not scroll while a sheet is open: on a phone the
   * list scrolls under the sheet and the person loses the row they opened.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.root} data-side={side} data-open={mounted}>
      <div className={`${styles.overlay ?? ''} surfaceScrim`} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${styles.panel ?? ''} surfacePanel`}
      >
        <div className={styles.head}>
          <div className={styles.heading}>
            <h2 className={styles.title}>{title}</h2>
            {description !== undefined ? <p className={styles.description}>{description}</p> : null}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <Icon name="plus" size="nav" />
          </button>
        </div>

        <div className={styles.body}>{children}</div>

        {footer !== undefined ? <div className={styles.foot}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
