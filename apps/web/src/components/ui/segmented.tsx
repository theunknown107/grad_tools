/**
 * Segmented control — the design's sunken track with a raised selected pill.
 *
 * Radix ToggleGroup underneath, so arrow keys move between options and the
 * selection is announced. Always single-select and never empty: clicking the
 * selected option again keeps it selected rather than clearing the view.
 */

import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  className,
}: {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly size?: 'sm' | 'md';
  /** Accessible name for the group. */
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(next) => {
        if (next !== '') onChange(next as T);
      }}
      className={cn(
        'relative inline-flex max-w-full items-center gap-1 rounded-xl border border-line bg-sunken',
        size === 'sm' ? 'p-0.5' : 'p-1',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          {...(option.disabled === true ? { disabled: true } : {})}
          className={cn(
            'relative inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg text-center leading-tight font-medium text-ink-2 transition-[color,background,box-shadow] duration-150',
            'hover:text-ink disabled:pointer-events-none disabled:opacity-50',
            'data-[state=on]:bg-raised data-[state=on]:text-ink data-[state=on]:shadow-e1',
            '[&_svg]:size-3.5',
            size === 'sm' ? 'min-h-7 px-2.5 py-1 text-[12px]' : 'min-h-8 px-3.5 py-1 text-[13px]',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/**
 * The design's pill filter row (announcement categories, day chips): outlined
 * chips, the selected one filled with the accent's weak tint.
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  shape = 'pill',
}: {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly className?: string;
  readonly shape?: 'pill' | 'tile';
}) {
  return (
    <div className={cn('relative -mx-1 overflow-x-auto scroll-quiet', className)}>
      <ToggleGroup.Root
        type="single"
        value={value}
        aria-label={label}
        onValueChange={(next) => {
          if (next !== '') onChange(next as T);
        }}
        className="flex gap-1.5 px-1 py-0.5"
      >
        {options.map((option) => (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              'shrink-0 whitespace-nowrap border font-medium text-ink-2 transition-colors',
              'border-line hover:bg-sunken',
              'data-[state=on]:border-accent data-[state=on]:bg-accent-weak data-[state=on]:text-accent-ink',
              shape === 'pill'
                ? 'rounded-full px-3 py-1.5 text-[12px]'
                : 'rounded-lg px-3 py-2 text-[13px]',
            )}
          >
            {option.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}
