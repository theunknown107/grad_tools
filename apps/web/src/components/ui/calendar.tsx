/**
 * Calendar — react-day-picker, wearing the design system.
 *
 * ---------------------------------------------------------------------------
 * CLASS-MAPPED, NOT STYLE-SHEETED
 * ---------------------------------------------------------------------------
 *
 * The library ships a `style.css` that paints its own colours, rounding and
 * spacing. Importing it would put a second design system in the page: it knows
 * nothing about the accent, the density attribute or dark mode, so every token
 * would have to be fought back with overrides. Every element is therefore given
 * a class of ours instead, which is what the library's `classNames` map is for.
 *
 * Keyboard behaviour, the grid semantics and the month navigation are the
 * library's own — that is the reason to use it rather than write a grid.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { cn } from '../../lib/cn.js';

export type CalendarProps = DayPickerProps & { readonly className?: string };

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('w-fit select-none', className)}
      classNames={{
        root: 'text-ink',
        months: 'relative flex flex-col gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-8 items-center justify-center px-9',
        caption_label: 'text-[13px] font-semibold text-ink',
        nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
        button_previous:
          'inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        button_next:
          'inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        chevron: 'size-4',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'w-9 text-[11px] font-medium tracking-[0.04em] text-ink-3 uppercase [&:not(:first-child)]:ml-0.5',
        weeks: 'flex flex-col gap-0.5',
        week: 'flex gap-0.5',
        day: 'relative size-9 p-0 text-center',
        day_button:
          'inline-flex size-9 items-center justify-center rounded-lg text-[13px] text-ink tabular-nums transition-colors hover:bg-sunken focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        today: 'font-semibold text-accent-ink',
        outside: 'text-ink-3 opacity-60',
        disabled: 'pointer-events-none opacity-40',
        hidden: 'invisible',
        selected:
          '[&_button]:bg-accent [&_button]:text-on-accent [&_button]:hover:bg-accent [&_button]:hover:brightness-110',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft {...rest} className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight {...rest} className="size-4" aria-hidden="true" />
          ),
      }}
      {...props}
    />
  );
}
