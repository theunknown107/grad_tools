/**
 * Form controls — label, input, textarea, select, switch, checkbox.
 *
 * Heights, radii and focus treatment are the design's `Input`/`Select`/`Switch`.
 * The select is Radix, not a native `<select>`: the design's dropdown surface
 * is a raised popup, and a native list cannot be styled to match it.
 */

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, ChevronDown } from 'lucide-react';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn.js';

/*
 * An invalid control is marked with a RING, not a border colour: the unlayered
 * `border-color` rule in index.css neutralises every coloured border utility on
 * purpose, so `border-danger` rendered as the plain hairline and an unfocused
 * invalid field looked valid.
 */
export const controlClass = cn(
  'w-full rounded-lg border border-line bg-panel text-sm text-ink transition-[border-color,box-shadow]',
  'placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger aria-[invalid=true]:focus:ring-2 aria-[invalid=true]:focus:ring-danger/25',
);

export const Label = forwardRef<
  HTMLLabelElement,
  LabelPrimitive.LabelProps & { readonly className?: string }
>(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('text-[13px] font-medium text-ink-2', className)}
      {...props}
    />
  );
});

/**
 * A labelled control. Wires `id`, `aria-describedby` and `aria-invalid` onto
 * its single child, so every field is announced with its hint or error.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional = false,
}: {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | null | undefined;
  readonly children: ReactElement<Record<string, unknown>>;
  readonly className?: string;
  readonly optional?: boolean;
}) {
  const generated = useId();
  const childId = isValidElement(children)
    ? (children.props['id'] as string | undefined)
    : undefined;
  const id = childId ?? generated;
  const describedBy = `${id}-note`;
  const hasNote = (error !== undefined && error !== null && error !== '') || hint !== undefined;
  const control = cloneElement(children, {
    id,
    ...(hasNote ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true } : {}),
  });
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-ink-3">(optional)</span>}
      </Label>
      {control}
      {error ? (
        <span id={describedBy} role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      ) : hint !== undefined ? (
        <span id={describedBy} className="text-[12px] text-ink-3">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type ?? 'text'}
        className={cn(
          controlClass,
          'h-9.5 px-3',
          'file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-2 file:py-1 file:text-[12px] file:font-medium file:text-ink',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(controlClass, 'min-h-24 px-3 py-2 leading-relaxed', className)}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ Select */

export interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

/**
 * A single-value select. Radix Select cannot hold an empty-string value, so
 * "nothing chosen" is `value === ''` here and shows the placeholder.
 */
export const Select = forwardRef<
  HTMLButtonElement,
  {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly options: readonly SelectOption[];
    readonly placeholder?: string;
    readonly disabled?: boolean;
    readonly className?: string;
    readonly id?: string;
    readonly name?: string;
    readonly 'aria-label'?: string;
    readonly 'aria-describedby'?: string;
    readonly 'aria-invalid'?: boolean;
    readonly size?: 'sm' | 'md';
  }
>(function Select(
  {
    value,
    onValueChange,
    options,
    placeholder = 'Select…',
    disabled,
    className,
    size = 'md',
    name,
    ...aria
  },
  ref,
) {
  return (
    <SelectPrimitive.Root
      {...(value === '' ? {} : { value })}
      onValueChange={onValueChange}
      {...(disabled === true ? { disabled: true } : {})}
      {...(name === undefined ? {} : { name })}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        {...aria}
        className={cn(
          controlClass,
          'flex items-center justify-between gap-2 px-3 text-left data-[placeholder]:text-ink-3',
          size === 'sm' ? 'h-8 text-[13px]' : 'h-9.5',
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-ink-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          data-slot="popup"
          className="z-[95] max-h-(--radix-select-content-available-height) min-w-[var(--radix-select-trigger-width)] animate-pop overflow-hidden rounded-xl border border-line bg-raised shadow-e3"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                {...(option.disabled === true ? { disabled: true } : {})}
                className={cn(
                  'relative flex cursor-pointer select-none items-center rounded-lg py-2 pr-8 pl-2.5 text-[13px] text-ink outline-none',
                  'data-[highlighted]:bg-sunken data-[state=checked]:font-medium',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5">
                  <Check className="size-3.5 text-accent-ink" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});

/* ------------------------------------------------------------------ Switch */

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  /** Accessible name when no visible label is associated. */
  readonly label?: string;
  readonly disabled?: boolean;
  readonly id?: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      {...(label === undefined ? {} : { 'aria-label': label })}
      {...(disabled === true ? { disabled: true } : {})}
      {...(id === undefined ? {} : { id })}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200',
        'bg-line-strong data-[state=checked]:bg-accent disabled:opacity-50',
      )}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-raised shadow-e1 transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

/** A labelled row with a switch — the design's settings toggle row. */
export function SwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {title}
        </label>
        {description !== undefined && <div className="text-[12px] text-ink-3">{description}</div>}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        {...(disabled === undefined ? {} : { disabled })}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Checkbox */

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
}: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label?: string;
  readonly id?: string;
  readonly disabled?: boolean;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(state) => onCheckedChange(state === true)}
      {...(label === undefined ? {} : { 'aria-label': label })}
      {...(id === undefined ? {} : { id })}
      {...(disabled === true ? { disabled: true } : {})}
      className={cn(
        'grid size-4.5 shrink-0 place-items-center rounded-[5px] border border-line-strong bg-panel transition-colors',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-on-accent',
        'disabled:opacity-50',
      )}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Adapts an `<input>` change handler to a plain value callback. */
export function valueOf(handler: (value: string) => void) {
  return (event: { readonly target: { readonly value: string } }): void =>
    handler(event.target.value);
}
