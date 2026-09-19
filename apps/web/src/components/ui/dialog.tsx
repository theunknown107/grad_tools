/**
 * Dialogs — the design's `Overlay` + `DialogHeader`, on Radix.
 *
 * Radix supplies what the Make prototype hand-rolled only partly: a real focus
 * trap, focus return to the trigger, Escape, scroll lock and `aria-modal`.
 * The look — dim scrim, raised panel, hairline header with a close button,
 * the pop-in — is the design's.
 */

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from './button.js';
import { useReturnFocus } from './return-focus.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const overlayClass = 'fixed inset-0 z-[60] bg-black/40 data-[state=open]:animate-fade';

export function DialogContent({
  title,
  description,
  children,
  className,
  size = 'md',
  hideClose = false,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl';
  readonly hideClose?: boolean;
}) {
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  const returnFocus = useReturnFocus();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="overlay" className={overlayClass} />
      <div className="pointer-events-none fixed inset-0 z-[61] grid place-items-center p-4">
        <DialogPrimitive.Content
          data-slot="popup"
          {...returnFocus}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          className={cn(
            'pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-e3 outline-none data-[state=open]:animate-pop',
            width,
            className,
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
                {title}
              </DialogPrimitive.Title>
              {description !== undefined && (
                <DialogPrimitive.Description className="mt-0.5 text-[13px] text-ink-2">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            {!hideClose && (
              <DialogPrimitive.Close
                aria-label="Close"
                className="-mt-0.5 -mr-1 grid size-9 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                <X className="size-4.5" />
              </DialogPrimitive.Close>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">{children}</div>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

export function DialogFooter({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-2 px-5 pb-5', className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ Confirmation */

/**
 * A destructive or irreversible confirmation. Focus starts on Cancel, so an
 * accidental Enter never erases anything.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  busy = false,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly destructive?: boolean;
  readonly busy?: boolean;
}) {
  const returnFocus = useReturnFocus();
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay data-slot="overlay" className={overlayClass} />
        <div className="pointer-events-none fixed inset-0 z-[61] grid place-items-center p-4">
          <AlertDialogPrimitive.Content
            data-slot="popup"
            {...returnFocus}
            className="pointer-events-auto w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-e3 outline-none data-[state=open]:animate-pop"
          >
            <AlertDialogPrimitive.Title className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
              {title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              {description}
            </AlertDialogPrimitive.Description>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <AlertDialogPrimitive.Cancel asChild>
                <Button variant="secondary">Cancel</Button>
              </AlertDialogPrimitive.Cancel>
              <Button
                variant={destructive ? 'destructive' : 'primary'}
                loading={busy}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </AlertDialogPrimitive.Content>
        </div>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
