/**
 * Page scaffolding — the design's `PageHeader`, `SectionTitle`, list `Row`,
 * `Avatar`, and the small shared bits every page composes.
 */

import { Slot } from '@radix-ui/react-slot';
import { ArrowLeft } from 'lucide-react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleId,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly titleId?: string;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow !== undefined && eyebrow !== null && eyebrow !== '' && (
          <div className="mb-2 font-mono text-[11px] tracking-[0.16em] text-ink-3 uppercase">
            {eyebrow}
          </div>
        )}
        <h1
          id={titleId}
          className="font-display text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink sm:text-[30px]"
        >
          {title}
        </h1>
        {description !== undefined && (
          <div className="mt-1.5 max-w-2xl text-sm text-ink-2">{description}</div>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function SectionTitle({
  children,
  action,
  id,
  className,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly id?: string;
  readonly className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 id={id} className="text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** A list row. `asChild` makes the whole row a link or button. */
export const Row = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { readonly asChild?: boolean; readonly interactive?: boolean }
>(function Row({ className, asChild = false, interactive = false, ...props }, ref) {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      ref={ref}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        (interactive || asChild) && 'cursor-pointer hover:bg-panel',
        className,
      )}
      {...props}
    />
  );
});

/** Title + mono meta line, the design's two-line row body. */
export function RowText({
  title,
  meta,
  className,
}: {
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <div className="truncate text-[13px] font-medium text-ink">{title}</div>
      {meta !== undefined && meta !== null && meta !== '' && (
        <div className="truncate font-mono text-[11px] text-ink-3">{meta}</div>
      )}
    </div>
  );
}

/** A status dot. Decorative unless given a label. */
export function Dot({
  tone,
  hollow = false,
  label,
  className,
}: {
  readonly tone: 'accent' | 'warning' | 'danger' | 'success' | 'neutral';
  readonly hollow?: boolean;
  readonly label?: string;
  readonly className?: string;
}) {
  const fill = {
    accent: 'bg-accent',
    warning: 'bg-warning',
    danger: 'bg-danger',
    success: 'bg-success',
    neutral: 'bg-ink-3',
  }[tone];
  return (
    <span
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={cn(
        'size-2 shrink-0 rounded-full',
        hollow ? 'border border-line-strong' : fill,
        className,
      )}
    />
  );
}

export function Avatar({
  initials,
  size = 32,
  className,
}: {
  readonly initials: string;
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-accent font-semibold tracking-tight text-on-accent',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}

/** Two initials from a display name, or a neutral mark when there is none. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'GT';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function BackLink({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden="true" /> {children}
    </Link>
  );
}

/** The icon tile used at the head of rows and cards. */
export function IconTile({
  children,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'solid';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center',
        {
          sm: 'size-8 rounded-lg [&_svg]:size-4',
          md: 'size-9 rounded-lg [&_svg]:size-4.5',
          lg: 'size-10 rounded-xl [&_svg]:size-5',
        }[size],
        {
          neutral: 'bg-sunken text-ink-2',
          accent: 'bg-accent-weak text-accent-ink',
          success: 'bg-success-weak text-success',
          warning: 'bg-warning-weak text-warning',
          danger: 'bg-danger-weak text-danger',
          solid: 'bg-accent text-on-accent',
        }[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
