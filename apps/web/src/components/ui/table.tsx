/**
 * Tables — shadcn's composition, the design's look: a panel-tinted header in
 * small uppercase, hairline rows, tabular numerals. Scrolls horizontally on
 * its own on a narrow screen, never the page.
 */

import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/cn.js';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    // Focusable so a keyboard user can scroll a table wider than the screen.
    <div
      tabIndex={0}
      role="region"
      aria-label="Table, scrolls sideways"
      className="relative w-full overflow-x-auto scroll-quiet focus-visible:outline-offset-[-2px]"
    >
      <table className={cn('w-full border-collapse text-left text-[13px]', className)} {...props} />
    </div>
  );
}

export function TableCaption({ className, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn('sr-only', className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-line bg-panel', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-line', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-panel/60', className)} {...props} />;
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink-3 uppercase first:pl-5 last:pr-5',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-4 py-3 align-middle text-ink first:pl-5 last:pr-5', className)}
      {...props}
    />
  );
}

export function TableRowHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="row"
      className={cn('px-4 py-3 text-left font-medium text-ink first:pl-5', className)}
      {...props}
    />
  );
}

export const numeric = 'tnum text-right';
