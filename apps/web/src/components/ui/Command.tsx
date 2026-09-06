/**
 * Command palette and Combobox.
 *
 * Authority: Phase 7B §2, §12 · docs/27 §27.3
 * Provenance: behaviourally faithful shadcn implementation adapted to the
 * GradTools styling architecture. shadcn's Command is `cmdk`, and so is this;
 * `Command` is `cmdk` in a Radix Dialog, and `Combobox` is `cmdk` in a Radix
 * Popover — the two compositions shadcn documents. The Tailwind classes are not
 * reproduced.
 *
 * ---------------------------------------------------------------------------
 * WHY cmdk RATHER THAN FILTERING A LIST BY HAND
 * ---------------------------------------------------------------------------
 *
 * Filtering a list on `includes()` is four lines, and GradTools had those four
 * lines. What it did not have, and what a person typing into a search box
 * expects:
 *
 *   - SCORED matching, so "bmats" ranks BMATS101 above a subject whose
 *     description merely contains the letters, and "dsa" still finds "Data
 *     Structures and Applications",
 *   - a stable selection across re-filters — the highlighted row must not jump
 *     to the top on every keystroke,
 *   - `aria-activedescendant` on the input while focus STAYS in the input,
 *     which is the combobox pattern and cannot be faked with roving tabindex,
 *   - groups that hide themselves when every item in them is filtered out,
 *     rather than leaving an empty heading behind.
 *
 * ---------------------------------------------------------------------------
 * COMMAND VS COMBOBOX
 * ---------------------------------------------------------------------------
 *
 * `Command` is a palette: it is opened by a shortcut, it is modal, and choosing
 * an item DOES something. It has no value.
 *
 * `Combobox` is a form control: it is anchored to a field, it is not modal, and
 * choosing an item SETS a value that stays visible afterwards. Picking a
 * subject from the reference catalogue is a combobox; jumping to a page is a
 * command.
 */

import { Fragment, useState, type ReactNode } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Icon, type IconName } from '../icons.js';
import { Popover, PopoverContent, PopoverTrigger } from './Popover.js';
import styles from './Command.module.css';

/* -------------------------------------------------------------------------- */
/* Shared list                                                                */
/* -------------------------------------------------------------------------- */

export interface CommandItem {
  readonly value: string;
  readonly label: string;
  /** Extra text the search should match but the row need not show. */
  readonly keywords?: readonly string[] | undefined;
  readonly hint?: string | undefined;
  readonly icon?: IconName | undefined;
  readonly group?: string | undefined;
}

/** Groups in first-seen order, so the caller's ordering is what is shown. */
function byGroup(items: readonly CommandItem[]): readonly (readonly [string, CommandItem[]])[] {
  const groups = new Map<string, CommandItem[]>();
  for (const item of items) {
    const key = item.group ?? '';
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }
  return [...groups.entries()];
}

function CommandRows({
  items,
  onSelect,
  selected,
}: {
  readonly items: readonly CommandItem[];
  readonly onSelect: (value: string) => void;
  readonly selected?: string | undefined;
}): ReactNode {
  return (
    <>
      {byGroup(items).map(([group, rows]) => {
        const body = rows.map((item) => (
          <CommandPrimitive.Item
            key={item.value}
            value={item.value}
            /*
             * `keywords` feeds cmdk's scorer without appearing in the row. A
             * subject is found by its code, its title, or both — and the row
             * still shows only what a person needs to read.
             */
            keywords={[item.label, ...(item.keywords ?? [])]}
            className={styles.item}
            onSelect={onSelect}
          >
            {item.icon !== undefined && <Icon name={item.icon} size="small" />}
            <span className={styles.itemLabel}>{item.label}</span>
            {item.hint !== undefined && <span className={styles.itemHint}>{item.hint}</span>}
            {/* The tick is the selected state, and it is a SHAPE — colour alone
                would leave the chosen row unmarked in monochrome. */}
            {selected === item.value && <Icon name="check" size="small" />}
          </CommandPrimitive.Item>
        ));

        /*
         * A FRAGMENT, NOT A DIV.
         *
         * cmdk walks the DOM under `Command.List` to find its items, and an
         * element between the list and an item hides that item from the walk —
         * the list then renders every row and filters none of them, which looks
         * exactly like a broken search box and not at all like a broken
         * wrapper.
         */
        if (group === '') return <Fragment key="__ungrouped">{body}</Fragment>;
        return (
          <CommandPrimitive.Group key={group} heading={group} className={styles.group}>
            {body}
          </CommandPrimitive.Group>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Command palette                                                            */
/* -------------------------------------------------------------------------- */

export function CommandPalette({
  open,
  onOpenChange,
  items,
  onSelect,
  placeholder = 'Search…',
  label,
  empty = 'Nothing matches that.',
  footer,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly items: readonly CommandItem[];
  readonly onSelect: (value: string) => void;
  readonly placeholder?: string;
  /** Names the dialog, which is otherwise an unnamed modal. */
  readonly label: string;
  readonly empty?: ReactNode;
  readonly footer?: ReactNode;
}): ReactNode {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={`${styles.overlay ?? ''} surfaceScrim`} />
        <DialogPrimitive.Content className={`${styles.palette ?? ''} surfacePanel`}>
          {/* The dialog needs a name and a description; neither is drawn, because
              the input's placeholder is what a sighted person reads. */}
          <DialogPrimitive.Title className={styles.srOnly}>{label}</DialogPrimitive.Title>
          <DialogPrimitive.Description hidden />

          <CommandPrimitive className={styles.command} label={label}>
            <div className={styles.inputRow}>
              <Icon name="search" size="nav" className={styles.inputIcon} />
              <CommandPrimitive.Input className={styles.input} placeholder={placeholder} />
            </div>
            <CommandPrimitive.List className={styles.list}>
              <CommandPrimitive.Empty className={styles.empty}>{empty}</CommandPrimitive.Empty>
              <CommandRows
                items={items}
                onSelect={(value) => {
                  onOpenChange(false);
                  onSelect(value);
                }}
              />
            </CommandPrimitive.List>
          </CommandPrimitive>

          {footer !== undefined && <div className={styles.footer}>{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Combobox                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A value chosen from a long list, by typing.
 *
 * The strongest fit in the component matrix: a scheme's subject catalogue is
 * hundreds of rows, which is far past what a `<select>` can carry and exactly
 * what this is for.
 *
 * The trigger reports the CHOSEN label, not the placeholder, once something is
 * chosen — a combobox whose button still says "Select a subject" after you
 * selected one is a control whose state cannot be read.
 */
export function Combobox({
  items,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  label,
  empty = 'No match.',
  id,
  describedBy,
  invalid,
  disabled = false,
}: {
  readonly items: readonly CommandItem[];
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  /** Names the control where no `Field` wraps it. */
  readonly label: string;
  readonly empty?: ReactNode;
  readonly id?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly invalid?: true | undefined;
  readonly disabled?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const chosen = items.find((item) => item.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        className={styles.trigger}
        disabled={disabled}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        data-placeholder={chosen === undefined ? true : undefined}
      >
        <span className={styles.triggerText}>{chosen?.label ?? placeholder}</span>
        <Icon name="chevronDown" size="nav" className={styles.triggerIcon} />
      </PopoverTrigger>

      <PopoverContent label={label} align="start" padded={false}>
        <CommandPrimitive className={styles.command} label={label}>
          <div className={styles.inputRow}>
            <Icon name="search" size="nav" className={styles.inputIcon} />
            <CommandPrimitive.Input className={styles.input} placeholder={searchPlaceholder} />
          </div>
          <CommandPrimitive.List className={styles.list}>
            <CommandPrimitive.Empty className={styles.empty}>{empty}</CommandPrimitive.Empty>
            <CommandRows
              items={items}
              selected={value ?? undefined}
              onSelect={(next) => {
                setOpen(false);
                onValueChange(next);
              }}
            />
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
