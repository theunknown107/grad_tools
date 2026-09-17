/**
 * Dropdown menu and popover — raised popups in the design's material.
 * Radix supplies roving focus, typeahead, Escape and focus return.
 */

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

const popupClass =
  'z-[95] min-w-44 overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-e3 outline-none data-[state=open]:animate-pop';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  children,
  align = 'end',
  className,
}: {
  readonly children: ReactNode;
  readonly align?: 'start' | 'center' | 'end';
  readonly className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="popup"
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(popupClass, className)}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  icon,
  destructive = false,
  disabled = false,
  label,
}: {
  readonly children: ReactNode;
  readonly onSelect: () => void;
  readonly icon?: ReactNode;
  /** An accessible name, when the visible text alone would be ambiguous. */
  readonly label?: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      onSelect={onSelect}
      disabled={disabled}
      {...(label === undefined ? {} : { 'aria-label': label })}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none',
        'data-[highlighted]:bg-sunken data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        destructive ? 'text-danger' : 'text-ink',
      )}
    >
      {icon}
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuLabel({ children }: { readonly children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="px-2.5 py-1.5 font-mono text-[10px] tracking-[0.16em] text-ink-3 uppercase">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="my-1 h-px bg-line" />;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  children,
  className,
  align = 'center',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly align?: 'start' | 'center' | 'end';
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popup"
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(popupClass, 'p-3', className)}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
