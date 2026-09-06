/**
 * Alert, Spinner and Scroll Area.
 *
 * Authority: Phase 7B §2, §12 · docs/27 §27.6, §27.9
 * Provenance: behaviourally faithful shadcn implementation adapted to the
 * GradTools styling architecture. Alert and Spinner have no Radix primitive —
 * they are markup and ARIA — and Scroll Area is
 * `@radix-ui/react-scroll-area`.
 */

import type { ReactNode } from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { Icon, type IconName } from '../icons.js';
import styles from './Feedback.module.css';

/* -------------------------------------------------------------------------- */
/* Alert                                                                      */
/* -------------------------------------------------------------------------- */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_ICON: Record<AlertTone, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/**
 * A message about the page, not about a field.
 *
 * `Notice` (ui/index.tsx) already existed and is this component's ancestor. The
 * two differences that earned a new one:
 *
 *   - a TITLE. "Semester 3 already has a result" followed by what to do about
 *     it reads as one message; the same text as an undifferentiated paragraph
 *     reads as a wall,
 *   - LIVENESS. An alert that appears in response to something the person just
 *     did must be announced. One that was on the page when it loaded must not
 *     be, or every visit begins with the app talking over itself.
 *
 * `live` is therefore explicit and defaults to off. `assertive` is reserved for
 * something that has already gone wrong; `polite` waits for a pause, which is
 * correct for everything else.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  live = false,
  action,
}: {
  readonly tone?: AlertTone;
  readonly title?: string | undefined;
  readonly children: ReactNode;
  /** True for a message that appeared in response to an action. */
  readonly live?: boolean | 'assertive';
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div
      className={styles.alert}
      data-tone={tone}
      /*
       * `role="alert"` is implicitly assertive and cannot be made polite, so a
       * polite live region is expressed as `role="status"` instead. Neither is
       * set at all when the message is not live.
       */
      role={live === 'assertive' ? 'alert' : live === true ? 'status' : undefined}
    >
      <Icon name={ALERT_ICON[tone]} size="nav" className={styles.alertIcon} />
      <div className={styles.alertBody}>
        {title !== undefined && <p className={styles.alertTitle}>{title}</p>}
        <div className={styles.alertText}>{children}</div>
      </div>
      {action !== undefined && <div className={styles.alertAction}>{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Spinner                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Work is happening and its duration is unknown.
 *
 * Used ONLY where a skeleton cannot be: OCR on a scanned page has no shape to
 * stand in for, because nothing is known about what it will produce. Where the
 * shape of the result IS known — a list, a table, a card — `Skeleton` is the
 * right component and this one is a downgrade.
 *
 * The label is not optional. A spinner with no accessible name announces
 * nothing at all, which is the same as showing nothing.
 */
export function Spinner({
  label,
  size = 'default',
}: {
  /** What is being waited for: "Reading the result card". */
  readonly label: string;
  readonly size?: 'small' | 'default';
}): ReactNode {
  return (
    <span className={styles.spinnerWrap} role="status" data-size={size}>
      <span className={styles.spinner} aria-hidden="true" />
      {/*
        The label is visually hidden rather than absent: it is the accessible
        name, and callers put their own visible text beside the spinner when
        they want one. Rendering both would say it twice.
      */}
      <span className={styles.spinnerLabel}>{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Scroll area                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A region that scrolls, with a scrollbar that is visible on every platform.
 *
 * macOS hides overlay scrollbars until something moves, so a scrolling panel on
 * a Mac looks like a truncated one. Radix renders its own bar, which is present
 * whenever there is overflow.
 *
 * `tabIndex={0}` on the viewport, because a region that scrolls must be
 * reachable by keyboard — without it everything past the fold is unreachable
 * for anyone not using a pointer, which axe reports as
 * `scrollable-region-focusable` and which is a genuine dead end.
 */
export function ScrollArea({
  children,
  label,
  maxHeight,
  orientation = 'vertical',
}: {
  readonly children: ReactNode;
  /** Names the region, since it becomes a keyboard stop. */
  readonly label: string;
  /** CSS length. Omit where the parent already constrains the height. */
  readonly maxHeight?: string | undefined;
  readonly orientation?: 'vertical' | 'horizontal';
}): ReactNode {
  return (
    <ScrollAreaPrimitive.Root className={styles.scrollRoot} type="auto">
      <ScrollAreaPrimitive.Viewport
        className={styles.scrollViewport}
        tabIndex={0}
        role="group"
        aria-label={label}
        style={maxHeight === undefined ? undefined : { maxBlockSize: maxHeight }}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar className={styles.scrollbar} orientation={orientation}>
        <ScrollAreaPrimitive.Thumb className={styles.scrollThumb} />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
