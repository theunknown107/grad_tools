/**
 * The design's mobile bottom sheet, on vaul: a Radix Dialog underneath (focus
 * trap, Escape, scroll lock) plus what a phone expects of a sheet — the grab
 * handle actually drags, and a flick dismisses it.
 */

import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { cn } from '../../lib/cn.js';
import { useReturnFocus } from './return-focus.js';

export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Visually hidden; names the sheet for assistive technology. */
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const returnFocus = useReturnFocus();
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} autoFocus>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
        <Drawer.Content
          {...returnFocus}
          aria-describedby={undefined}
          className={cn(
            'fixed inset-x-0 bottom-0 z-[71] flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-line bg-panel outline-none',
            className,
          )}
        >
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <div
            aria-hidden="true"
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-line-strong"
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(2rem,env(safe-area-inset-bottom))] scroll-quiet">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
