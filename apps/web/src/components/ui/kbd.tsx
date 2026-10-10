import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export function Kbd({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-panel px-1.5 font-mono text-[11px] font-medium text-ink-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
