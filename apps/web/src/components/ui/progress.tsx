import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../../lib/cn.js';
import type { Tone } from './badge.js';

const bar: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  schedule: 'bg-schedule',
  progress: 'bg-progress',
};

export function Progress({
  value,
  tone = 'accent',
  className,
  label,
}: {
  /** 0–100. Clamped. */
  readonly value: number;
  readonly tone?: Tone;
  readonly className?: string;
  /** Accessible name. */
  readonly label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <ProgressPrimitive.Root
      value={clamped}
      {...(label === undefined ? { 'aria-hidden': true } : { 'aria-label': label })}
      className={cn('relative h-2 overflow-hidden rounded-full bg-sunken', className)}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', bar[tone])}
        style={{ width: `${String(clamped)}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
