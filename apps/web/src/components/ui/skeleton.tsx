import { cn } from '../../lib/cn.js';

export function Skeleton({ className }: { readonly className?: string }) {
  return <div aria-hidden="true" className={cn('gt-skeleton rounded-md', className)} />;
}

/**
 * A page-shaped loading state — title, metric row, list card — so the layout
 * does not jump when data arrives. Announced once, politely.
 */
export function PageSkeleton({ label = 'Loading' }: { readonly label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{label}…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[92px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

/** Rows of a list while it loads. */
export function RowsSkeleton({
  rows = 4,
  label = 'Loading',
}: {
  readonly rows?: number;
  readonly label?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-line">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}
