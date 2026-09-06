/**
 * Dialog and Alert Dialog.
 *
 * Authority: Phase 7B §2, §12 · docs/27 §27.4
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. The behaviour is `@radix-ui/react-dialog` and
 * `@radix-ui/react-alert-dialog` — the same primitives shadcn ships. The
 * appearance is GradTools CSS Modules and tokens; shadcn's Tailwind classes are
 * NOT reproduced, and this is not "the shadcn source".
 *
 * ---------------------------------------------------------------------------
 * WHY THE PRIMITIVE AND NOT A HAND-ROLLED MODAL
 * ---------------------------------------------------------------------------
 *
 * GradTools already had a hand-rolled focus trap. It worked for the cases it
 * was tested against and did not work for the ones it was not: a trap that
 * queries `button, [href], input` misses `select`, `textarea`, `[tabindex]`,
 * and anything focusable inside a nested portal — and it has no answer at all
 * for focus that leaves via the browser chrome and comes back.
 *
 * Radix answers all of those, plus scroll-lock with scrollbar-width
 * compensation, `aria-hidden` on the rest of the tree, pointer-events guarding
 * during the close animation, and Escape ordering across stacked layers. None
 * of that is visible in a screenshot, which is exactly why it does not get
 * written by hand correctly.
 *
 * ---------------------------------------------------------------------------
 * DIALOG VS ALERT DIALOG
 * ---------------------------------------------------------------------------
 *
 * They are not the same component with a different colour. An alert dialog
 * interrupts to ask a question whose wrong answer is destructive, so it:
 *
 *   - cannot be dismissed by clicking the scrim or pressing Escape,
 *   - has no close affordance in its corner,
 *   - focuses the CANCEL action, not the destructive one,
 *   - is `role="alertdialog"` and REQUIRES a description.
 *
 * Deleting a semester result is an alert dialog. Editing one is a dialog.
 */

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertPrimitive from '@radix-ui/react-alert-dialog';
import { Icon } from '../icons.js';
import styles from './Dialog.module.css';

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * The whole dialog: portal, scrim, panel, heading and close button.
 *
 * Composed rather than exposed part-by-part because every dialog in this
 * product has the same anatomy, and the parts that are easy to get wrong — the
 * `Title` that gives the dialog its accessible name, the `Description` wired to
 * `aria-describedby` — are the ones a caller would forget.
 */
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> & {
    readonly title: string;
    readonly description?: string | undefined;
    /** Actions along the foot. Primary action last, as the platform orders it. */
    readonly footer?: ReactNode;
    /** Wide enough for a table. Default is a column of fields. */
    readonly size?: 'default' | 'wide' | undefined;
  }
>(function DialogContent({ title, description, footer, size = 'default', children, ...rest }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={`${styles.overlay ?? ''} surfaceScrim`} />
      <DialogPrimitive.Content
        ref={ref}
        className={`${styles.panel ?? ''} surfacePanel`}
        data-size={size}
        {...rest}
      >
        <div className={styles.head}>
          <div className={styles.heading}>
            <DialogPrimitive.Title className={styles.title}>{title}</DialogPrimitive.Title>
            {description === undefined ? (
              /*
               * Radix warns when a dialog has no description. An empty
               * `<Description>` would silence the warning while leaving the
               * dialog just as undescribed, so the element is hidden rather
               * than faked — which is what Radix documents for the case.
               */
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

        {footer !== undefined && <div className={styles.foot}>{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

/* -------------------------------------------------------------------------- */
/* Alert dialog                                                               */
/* -------------------------------------------------------------------------- */

export const AlertDialog = AlertPrimitive.Root;
export const AlertDialogTrigger = AlertPrimitive.Trigger;

/**
 * "Are you sure?" — for the answers that cannot be taken back.
 *
 * `description` is REQUIRED, not optional. A destructive confirmation whose
 * only text is "Are you sure?" tells a person nothing about what they are
 * about to lose, and the one place that sentence has to do work is the one
 * place it is usually skipped.
 */
export function AlertDialogContent({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  destructive = true,
}: {
  readonly title: string;
  /** What will happen, in the concrete. "Semester 3 and its 8 subjects." */
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  readonly onConfirm: () => void;
  readonly destructive?: boolean | undefined;
}) {
  return (
    <AlertPrimitive.Portal>
      <AlertPrimitive.Overlay className={`${styles.overlay ?? ''} surfaceScrim`} />
      <AlertPrimitive.Content className={`${styles.panel ?? ''} surfacePanel`} data-size="alert">
        <div className={styles.alertBody}>
          <AlertPrimitive.Title className={styles.title}>{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description className={styles.description}>
            {description}
          </AlertPrimitive.Description>
        </div>
        <div className={styles.foot}>
          {/*
            CANCEL FIRST, AND CANCEL IS WHAT RADIX FOCUSES. `AlertDialog.Cancel`
            receives initial focus by design, so Enter on a dialog nobody read
            does the safe thing. Reordering these two, or autofocusing the
            action, quietly reverses that.
          */}
          <AlertPrimitive.Cancel className={`${styles.action ?? ''} ${styles.cancel ?? ''}`}>
            {cancelLabel}
          </AlertPrimitive.Cancel>
          <AlertPrimitive.Action
            className={`${styles.action ?? ''} ${
              destructive ? (styles.destructive ?? '') : (styles.confirm ?? '')
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertPrimitive.Action>
        </div>
      </AlertPrimitive.Content>
    </AlertPrimitive.Portal>
  );
}
