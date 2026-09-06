/**
 * A drawer — a bottom sheet you can drag.
 *
 * Authority: Phase 7B §12 · docs/27 §27.4
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. shadcn's Drawer is `vaul`, and so is this
 * one; vaul is itself built on `@radix-ui/react-dialog`, so the focus trap,
 * scroll lock and Escape handling are the same primitive the rest of the
 * overlay family uses. The appearance is the GradTools module beside this file.
 *
 * ---------------------------------------------------------------------------
 * DRAWER OR SHEET?
 * ---------------------------------------------------------------------------
 *
 * They look similar and are not interchangeable.
 *
 * `Sheet` is the DETAIL surface: it is opened from a row, it is dismissed by a
 * button or the scrim, and its content is read. It is also the desktop
 * right-hand panel, which a drag gesture would be meaningless on.
 *
 * `Drawer` is the MOBILE TASK surface: it holds a short interaction the person
 * came to finish — mark attendance for one class, pick a date, confirm an
 * import — and it is dismissed the way a phone user expects, by dragging it
 * down. That gesture is the entire reason vaul exists, and it is the part that
 * cannot be hand-rolled convincingly: the drag has to follow the finger, resist
 * past the top, decide from velocity rather than distance whether a flick was a
 * dismissal, and hand scrolling back to the content when the content is what
 * was grabbed.
 *
 * On a pointer device the drawer still opens and still closes by scrim or
 * Escape; the drag simply has no audience there.
 */

import type { ReactNode } from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import styles from './Drawer.module.css';

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): ReactNode {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className={`${styles.overlay ?? ''} surfaceScrim`} />
        <DrawerPrimitive.Content className={`${styles.panel ?? ''} surfacePanel`}>
          {/*
            The handle is the affordance AND the drag target. vaul listens on
            the whole panel, but a visible grab bar is what tells a person the
            gesture exists — without it the drag is a hidden feature.
          */}
          <div className={styles.handle} aria-hidden="true" />

          <div className={styles.head}>
            <DrawerPrimitive.Title className={styles.title}>{title}</DrawerPrimitive.Title>
            {description === undefined ? (
              <DrawerPrimitive.Description hidden />
            ) : (
              <DrawerPrimitive.Description className={styles.description}>
                {description}
              </DrawerPrimitive.Description>
            )}
          </div>

          <div className={styles.body}>{children}</div>

          {footer !== undefined ? <div className={styles.foot}>{footer}</div> : null}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
