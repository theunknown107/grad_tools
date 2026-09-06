/**
 * A tooltip.
 *
 * Authority: docs/05 §5.25 (M9.6D) · docs/27 §27.3 · Phase 7B §2, §12
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. The behaviour is `@radix-ui/react-tooltip`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PORT ONTO RADIX SETTLED
 * ---------------------------------------------------------------------------
 *
 * The previous file said, in its own header, that what a real primitive would
 * buy is collision-aware positioning, and that the hand-rolled version did "the
 * cheap version — flip to the other side" and would need replacing if tooltips
 * ever had to survive nested scroll containers. The attendance page put one
 * inside a scrolling table, so that day arrived.
 *
 * Radix also brings the parts the cheap version had no answer for at all:
 *
 *   - a SHARED delay across the group, so moving along a column of rows shows
 *     the second tooltip instantly instead of waiting out the delay again,
 *   - `disableHoverableContent` semantics and pointer-leave grace,
 *   - dismissal on Escape, on scroll, and on pointer-down,
 *   - correct behaviour when the trigger unmounts while open.
 *
 * ---------------------------------------------------------------------------
 * A TOOLTIP IS NOT A PLACE FOR INFORMATION YOU NEED
 * ---------------------------------------------------------------------------
 *
 * It cannot be reached on a touchscreen, it disappears on scroll, and it is
 * invisible to anyone reading a printout. So nothing here may carry a value a
 * student needs — only an explanation of something already on screen.
 *
 * ---------------------------------------------------------------------------
 * ONE PLACE WHERE GRADTOOLS IS STRICTER THAN SHADCN, DELIBERATELY
 * ---------------------------------------------------------------------------
 *
 * Radix — and therefore shadcn — sets `aria-describedby` on the trigger ONLY
 * while the tooltip is open, because the content is unmounted when it is not.
 * That follows the APG letter and it loses something GradTools had: a figure
 * whose threshold explanation is announced without the person having to
 * discover that a tooltip exists and provoke it.
 *
 * So the description is ALSO rendered once, visually hidden, and referenced
 * permanently. It costs one span, it is the property `shadcn-primitives.test`
 * asserts, and porting to a primitive is not a reason to give up an
 * accessibility guarantee the product already made.
 */

import {
  cloneElement,
  createContext,
  useContext,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import styles from './Tooltip.module.css';

/**
 * Whether a `TooltipProvider` is already above us.
 *
 * Radix's own provider context is internal, and nesting a second provider
 * inside the first does not compose — the inner one WINS, so a tooltip that
 * always wraps itself would silently discard the application's grouping delay
 * while appearing to honour it. This marker is the only way to tell, from a
 * component, whether wrapping is necessary.
 */
const HasProvider = createContext(false);

export interface TooltipProps {
  /** The short explanation. Plain text — never markup. */
  readonly content: string;
  readonly children: ReactElement;
  readonly side?: 'top' | 'bottom';
  readonly sideOffset?: number;
  /** Milliseconds before it opens on hover. Zero on focus, always. */
  readonly delay?: number;
}

/**
 * Wraps the app once so every tooltip shares one delay timer.
 *
 * Without a provider each tooltip runs its own clock, and a column of eight
 * rows makes a person wait out the delay eight times. Mounted in `App`, not
 * per-call.
 */
export function TooltipProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300}>
      <HasProvider.Provider value={true}>{children}</HasProvider.Provider>
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = 'top',
  sideOffset = 8,
  delay,
}: TooltipProps): ReactNode {
  const describedBy = useId();
  const provided = useContext(HasProvider);

  /*
   * A PROVIDER ONLY IF THERE ISN'T ONE.
   *
   * shadcn exports `TooltipProvider` and leaves mounting it to the application,
   * so every `<Tooltip>` rendered outside one throws at runtime — including in
   * a page test that renders a single panel, which is a trap rather than a
   * contract. Wrapping unconditionally would fix that and quietly cost the
   * app-level grouping, because the inner provider wins.
   *
   * So: use the app's provider when there is one, and stand one up when there
   * is not.
   */
  const body = (
    /* `delayDuration` on the Root, not the Provider: it then applies whether or
       not this instance had to stand a provider up. */
    <TooltipPrimitive.Root {...(delay === undefined ? {} : { delayDuration: delay })}>
      {/*
        `asChild` so the trigger IS the caller's element rather than a wrapper
        around it. A wrapping <button> would nest interactive elements, and a
        wrapping <span> would break the table cell layout the attendance page
        depends on.
      */}
      <TooltipPrimitive.Trigger asChild>
        {cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': describedBy,
        })}
      </TooltipPrimitive.Trigger>
      <span id={describedBy} className={styles.description}>
        {content}
      </span>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={`${styles.bubble ?? ''} surfacePanel`}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8}
        >
          {content}
          <TooltipPrimitive.Arrow className={styles.arrow} width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );

  if (provided) return body;
  /* Standalone: nothing to group with, so no skip window. */
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={0}>
      {body}
    </TooltipPrimitive.Provider>
  );
}
