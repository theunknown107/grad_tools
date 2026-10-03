/**
 * Tooltip — the design's dark ink bubble, on Radix so it opens on hover AND
 * keyboard focus, closes on Escape, and is announced as a description.
 */

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  readonly content: ReactNode;
  /** Must be a single focusable element (or it will be made one via `Unavailable`). */
  readonly children: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly className?: string;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-[95] max-w-[260px] animate-fade rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium leading-snug text-inverse shadow-e2',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
