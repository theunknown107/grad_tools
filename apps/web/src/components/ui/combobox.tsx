/**
 * A searchable picker for a list too long to scroll: type, and the matches
 * narrow as you go.
 *
 * Built from what the app already has — Radix Popover for anchoring (with the
 * same measured collision insets as every popup) and cmdk for the listbox,
 * keyboard movement and selection. cmdk's own fuzzy filter is OFF: the caller
 * ranks matches with a deterministic `search`, so the order is explainable and
 * the same query always gives the same first result.
 */

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import { forwardRef, useId, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { collisionInsets } from '../../lib/viewport.js';
import { controlClass } from './field.js';

/** Enough to scroll through; a longer list means "keep typing", and says so. */
const SHOWN = 50;

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  /** Secondary text under the label: a code, a region. */
  readonly detail?: string;
}

export interface ComboboxProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly ComboboxOption[];
  /** Matching options, best first. */
  readonly search: (options: readonly ComboboxOption[], query: string) => ComboboxOption[];
  readonly placeholder: string;
  readonly searchPlaceholder: string;
  /** What to call the things being searched, for the count and the empty state. */
  readonly noun: string;
  /** An action row after the results (for example "not listed — type it"). */
  readonly footer?: { readonly label: string; readonly onSelect: () => void };
  readonly id?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
}

export const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(function Combobox(
  { value, onValueChange, options, search, placeholder, searchPlaceholder, noun, footer, ...aria },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const chosen = options.find((option) => option.value === value);
  const matches = search(options, query);
  const shown = matches.slice(0, SHOWN);

  const choose = (next: string): void => {
    onValueChange(next);
    setOpen(false);
    setQuery('');
  };

  let status: ReactNode;
  if (query.trim() === '') status = `${String(options.length)} ${noun} — type to search`;
  else if (matches.length === 0) status = null;
  else if (matches.length > SHOWN) {
    status = `Showing ${String(SHOWN)} of ${String(matches.length)} — keep typing`;
  } else status = `${String(matches.length)} ${matches.length === 1 ? 'match' : 'matches'}`;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverPrimitive.Trigger
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={open}
        {...aria}
        className={cn(
          controlClass,
          'flex h-9.5 items-center justify-between gap-2 px-3 text-left',
          chosen === undefined && 'text-ink-3',
        )}
      >
        <span className="min-w-0 truncate">{chosen?.label ?? placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popup"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={collisionInsets()}
          className="z-[95] flex max-h-[min(var(--radix-popover-content-available-height),24rem)] w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-e3 outline-none data-[state=open]:animate-pop"
        >
          <Command shouldFilter={false} label={searchPlaceholder} className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
              />
            </div>
            {status !== null && (
              <p className="px-3 pt-2 text-[11px] text-ink-3" aria-live="polite">
                {status}
              </p>
            )}
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-1 scroll-quiet">
              {query.trim() !== '' && matches.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] text-ink-3" role="status">
                  No {noun} match “{query.trim()}”.
                </p>
              )}
              {shown.map((option, index) => (
                <Command.Item
                  key={option.value}
                  value={option.value}
                  /* Named by its label; the code and region describe it. */
                  aria-label={option.label}
                  aria-describedby={
                    option.detail === undefined ? undefined : `${listId}-${String(index)}`
                  }
                  onSelect={() => {
                    choose(option.value);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink data-[selected=true]:bg-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">{option.label}</span>
                    {option.detail !== undefined && (
                      <span
                        id={`${listId}-${String(index)}`}
                        className="block text-[11px] text-ink-3"
                      >
                        {option.detail}
                      </span>
                    )}
                  </span>
                  {option.value === value && (
                    <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden="true" />
                  )}
                </Command.Item>
              ))}
              {footer !== undefined && (
                <Command.Item
                  value="__footer__"
                  onSelect={() => {
                    setOpen(false);
                    setQuery('');
                    footer.onSelect();
                  }}
                  className="mt-1 flex cursor-pointer items-center rounded-lg border-t border-line px-2.5 py-2 text-[13px] text-ink-2 data-[selected=true]:bg-sunken"
                >
                  {footer.label}
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});
