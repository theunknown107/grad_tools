/**
 * A tooltip.
 *
 * Authority: docs/05 §5.25 (M9.6D) · docs/27 §27.3
 * Provenance: SHADCN STRUCTURE, CUSTOM BEHAVIOUR. The source of
 * `registry/bases/base/ui/tooltip.tsx` was retrieved via the shadcn skill and
 * its API is reproduced — `side`, `sideOffset`, `align`, a portal, a provider
 * carrying the open delay.
 *
 * ---------------------------------------------------------------------------
 * WHY @base-ui/react WAS NOT ADOPTED
 * ---------------------------------------------------------------------------
 *
 * shadcn's tooltip is a thin wrapper over `@base-ui/react/tooltip`, which
 * brings Provider/Root/Trigger/Portal/Positioner/Popup and, with it, a
 * dependency whose styling contract is Tailwind. GradTools has no Tailwind and
 * docs/05 §9 requires every imported component to be restyled to GradTools
 * tokens anyway, so the Tailwind half of that dependency is dead weight here.
 *
 * What Base UI would genuinely have bought is collision-aware positioning. This
 * implementation does the cheap version — measure the trigger, flip to the
 * other side if the preferred one would leave the viewport — which is enough
 * for the short labels GradTools shows. If tooltips ever carry rich content or
 * need to survive nested scroll containers, adopting Base UI is the right
 * answer and this file is the seam to replace.
 *
 * ---------------------------------------------------------------------------
 * A TOOLTIP IS NOT A PLACE FOR INFORMATION YOU NEED
 * ---------------------------------------------------------------------------
 *
 * It cannot be reached on a touchscreen, it disappears on scroll, and it is
 * invisible to anyone reading a printout. So nothing here may carry a value a
 * student needs — only an explanation of something already on screen. The
 * content is wired through `aria-describedby`, so it reaches a screen reader
 * whether or not it is ever displayed.
 */

import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  /** The short explanation. Plain text — never markup. */
  readonly content: string;
  readonly children: ReactElement<{
    'aria-describedby'?: string;
    ref?: React.Ref<HTMLElement>;
  }>;
  readonly side?: 'top' | 'bottom';
  readonly sideOffset?: number;
  /** Milliseconds before it opens on hover. Zero on focus, always. */
  readonly delay?: number;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  sideOffset = 6,
  delay = 350,
}: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; side: 'top' | 'bottom' } | null>(
    null,
  );
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = (immediate: boolean): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    // Keyboard focus opens with no delay: a delay on hover prevents tooltips
    // firing as the pointer crosses a toolbar, but someone who tabbed here
    // asked for it deliberately.
    timer.current = setTimeout(() => setOpen(true), immediate ? 0 : delay);
  };

  const hide = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;

    const measure = (): void => {
      const trigger = wrapRef.current?.firstElementChild ?? wrapRef.current;
      if (!(trigger instanceof HTMLElement)) return;
      const rect = trigger.getBoundingClientRect();
      // Flip when the preferred side would put the tooltip off-screen. 44px is
      // a generous guess at the tooltip's own height; being wrong flips it back
      // on the next open rather than clipping it.
      const wouldClipTop = rect.top - sideOffset - 44 < 0;
      const resolved = side === 'top' && wouldClipTop ? 'bottom' : side;
      setBox({
        left: rect.left + rect.width / 2,
        top: resolved === 'top' ? rect.top - sideOffset : rect.bottom + sideOffset,
        side: resolved,
      });
    };

    measure();
    // A tooltip anchored to an element that has scrolled away is worse than no
    // tooltip, so movement closes it rather than chasing it.
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', hide);
    };
  }, [open, side, sideOffset]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <span
        ref={wrapRef}
        className={styles.wrap}
        onPointerEnter={() => show(false)}
        onPointerLeave={hide}
        onFocusCapture={() => show(true)}
        onBlurCapture={hide}
      >
        {/*
          The trigger is cloned to carry `aria-describedby`. Without this the
          hidden description below would be unreachable, and the tooltip would
          be decoration that a screen reader never announces.
        */}
        {cloneElement(children, { 'aria-describedby': `${id}-text` })}
      </span>

      {/*
        Portalled to <body>, as shadcn does, so an ancestor's `overflow:
        hidden` or stacking context cannot clip it.
      */}
      {open && box !== null
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              data-side={box.side}
              className={`${styles.bubble ?? ''} surfacePanel`}
              style={{ top: box.top, left: box.left }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}

      {/*
        The description is always in the tree, whether or not the bubble is
        shown, so `aria-describedby` on the trigger always resolves.
      */}
      <span hidden id={`${id}-text`}>
        {content}
      </span>
    </>
  );
}
