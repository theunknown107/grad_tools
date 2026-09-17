/**
 * Buttons — the Figma button system.
 *
 * Variants and sizes are the design's `Button` and `IconButton`, class for
 * class. `asChild` renders the styling onto a router `<Link>`, so navigation
 * stays a real link while looking like the design's button.
 */

import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Spinner } from './spinner.js';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap',
    'transition-[background,filter,box-shadow,transform,color,border-color] duration-150',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55',
    'aria-disabled:pointer-events-none aria-disabled:opacity-55',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent shadow-e1 hover:brightness-110 active:brightness-95',
        secondary: 'border border-line bg-raised text-ink hover:bg-sunken active:bg-sunken/80',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-panel',
        ghost: 'bg-transparent text-ink-2 hover:bg-sunken hover:text-ink',
        destructive: 'bg-danger text-canvas hover:brightness-110 active:brightness-95',
        glass: 'gt-glass text-ink',
        'glass-primary': 'gt-glass-primary font-semibold',
        link: 'text-accent-ink underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-8 gap-1.5 rounded-lg px-3 text-[13px] [&_svg:not([class*=size-])]:size-3.5',
        md: 'h-9.5 gap-2 rounded-lg px-3.5 text-sm [&_svg:not([class*=size-])]:size-4',
        lg: 'h-11 gap-2 rounded-xl px-5 text-[15px] [&_svg:not([class*=size-])]:size-4',
        text: 'h-auto gap-1 rounded-md px-0 text-[12px] [&_svg:not([class*=size-])]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
  readonly loading?: boolean;
  /** Leading icon. Replaced by a spinner while `loading`. */
  readonly icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    asChild = false,
    loading = false,
    icon,
    children,
    disabled,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button', disabled: disabled === true || loading })}
      {...(loading ? { 'aria-busy': true } : {})}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      <Slottable>{children}</Slottable>
    </Comp>
  );
});

export const iconButtonVariants = cva(
  [
    'inline-grid shrink-0 place-items-center rounded-lg text-ink-2 transition-[background,color,transform] duration-150',
    'hover:bg-sunken hover:text-ink active:scale-[0.96] disabled:pointer-events-none disabled:opacity-55',
    '[&_svg]:pointer-events-none',
  ],
  {
    variants: {
      size: {
        sm: 'size-8 [&_svg:not([class*=size-])]:size-4',
        md: 'size-9 [&_svg:not([class*=size-])]:size-4.5',
        lg: 'size-11 [&_svg:not([class*=size-])]:size-5',
      },
      active: {
        true: 'bg-accent-weak text-accent-ink hover:bg-accent-weak hover:text-accent-ink',
        false: '',
      },
    },
    defaultVariants: { size: 'md', active: false },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  /** The accessible name. An icon-only control always has one. */
  readonly label: string;
  readonly asChild?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, size, active, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ size, active }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
});
