import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts on hover — for a card that is itself a link or button. */
  readonly interactive?: boolean;
  /** Render the card's styling onto its only child (a `<Link>` or `<button>`). */
  readonly asChild?: boolean;
}

export const cardInteractive =
  'cursor-pointer text-left transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-e2 active:translate-y-0';

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, interactive = false, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      ref={ref}
      className={cn(
        'rounded-xl border border-line bg-raised',
        interactive && cardInteractive,
        className,
      )}
      {...props}
    />
  );
});

/**
 * The design's list-card header: icon, title, and an optional trailing action
 * or count, over a hairline.
 */
export function CardHeader({
  icon,
  title,
  action,
  className,
  titleId,
}: {
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly titleId?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        <h3 id={titleId} className="truncate text-sm font-semibold text-ink">
          {title}
        </h3>
      </div>
      {action}
    </div>
  );
}

/** Hairline-divided rows inside a card. */
export function CardRows({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('divide-y divide-line', className)} {...props} />;
}

/** A small text action in a card header ("Full week", "All"). */
export const headerActionClass =
  'rounded-md text-[12px] font-medium text-accent-ink underline-offset-4 hover:underline';
