/**
 * The metric tile — a monochrome instrument.
 *
 * Identity comes from material and type, never colour: the design removed the
 * per-tone tint. A figure that is not known says so in words, with its reason
 * underneath — never a bare dash.
 */

import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export type MetricState = 'resolved' | 'partial' | 'unavailable';

export interface MetricProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string | undefined;
  readonly sub?: ReactNode;
  readonly size?: 'compact' | 'md' | 'large';
  readonly onClick?: () => void;
  readonly className?: string;
  /** `unavailable` renders `value` (a word, e.g. "Not recorded") in muted ink. */
  readonly state?: MetricState;
  /**
   * Marks a figure whose MEANING is a warning — attendance below the line, an
   * outstanding backlog — with a small status dot. The figure itself stays
   * monochrome: the design keeps the metric row neutral in every theme.
   */
  readonly emphasis?: 'warning' | 'danger' | undefined;
  /** No tile chrome of its own: the figure is a cell of a `MetricStrip`. */
  readonly plain?: boolean;
}

const valueSize = { large: 'text-[40px]', md: 'text-[30px]', compact: 'text-[24px]' } as const;
const pad = { large: 'p-5', md: 'p-4', compact: 'p-3.5' } as const;

export function Metric({
  label,
  value,
  unit,
  sub,
  size = 'md',
  onClick,
  className,
  state = 'resolved',
  emphasis,
  plain = false,
}: MetricProps) {
  const interactive = onClick !== undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };
  return (
    <div
      className={cn(
        plain ? 'min-w-0 bg-raised' : 'gt-metric min-w-0 rounded-xl',
        pad[size],
        className,
      )}
      data-interactive={interactive ? 'true' : undefined}
      data-state={state}
      {...(interactive
        ? { role: 'button', tabIndex: 0, onClick, onKeyDown }
        : { role: 'group', 'aria-label': label })}
    >
      <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-ink-2">
        {label}
        {emphasis !== undefined && (
          <span
            role="img"
            aria-label={emphasis === 'danger' ? 'Critical' : 'Needs attention'}
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              emphasis === 'danger' ? 'bg-danger' : 'bg-warning',
            )}
          />
        )}
      </div>
      {state === 'unavailable' ? (
        <div className="mt-1.5 text-[15px] font-medium text-ink-3">{value}</div>
      ) : (
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-1">
          <span
            className={cn(
              'tnum leading-none font-semibold tracking-[-0.02em] text-ink',
              valueSize[size],
            )}
          >
            {value}
          </span>
          {unit !== undefined && <span className="text-sm font-medium text-ink-3">{unit}</span>}
        </div>
      )}
      {sub !== undefined && sub !== null && sub !== '' && (
        <div className="mt-1.5 text-[12px] leading-snug text-ink-3">{sub}</div>
      )}
    </div>
  );
}

/** Two across on a phone, four on a wide screen. */
export function MetricGrid({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>;
}

/**
 * Six figures as ONE ruled instrument, not six tiles: give each `Metric` the
 * `plain` prop. The rules between cells are the container's own colour showing
 * through a 1px gap, so they are pure paint, never an element a screen reader
 * could meet. Six cells fill 2, 3 and 6 columns exactly, so no row is ragged.
 */
export function MetricStrip({
  children,
  className,
  ...rest
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}) {
  return (
    <div
      {...rest}
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3 xl:grid-cols-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The small bordered stat used inside hero cards and dialogs. */
export function MiniStat({
  label,
  value,
  className,
  valueClassName,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly className?: string;
  readonly valueClassName?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('rounded-lg border border-line bg-panel p-3', className)}
    >
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={cn('tnum mt-0.5 text-xl font-semibold text-ink', valueClassName)}>
        {value}
      </div>
    </div>
  );
}
