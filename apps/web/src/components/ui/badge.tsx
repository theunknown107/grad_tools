import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-sunken text-ink-2',
        accent: 'border-transparent bg-accent-weak text-accent-ink',
        success: 'border-transparent bg-success-weak text-success',
        warning: 'border-transparent bg-warning-weak text-warning',
        danger: 'border-transparent bg-danger-weak text-danger',
        info: 'border-transparent bg-info-weak text-info',
        schedule: 'border-transparent bg-schedule-weak text-schedule',
        progress: 'border-transparent bg-progress-weak text-progress',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone;
  readonly icon?: ReactNode;
}

export function Badge({ tone, icon, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}
