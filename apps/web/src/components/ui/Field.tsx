/**
 * Field and Input Group.
 *
 * Authority: Phase 7B §2 · docs/27 §27.11
 * Provenance: behaviourally faithful shadcn implementation adapted to the
 * GradTools styling architecture. shadcn's Field and Input Group have NO Radix
 * primitive behind them — they are composition, markup and ARIA wiring — so
 * what is reproduced here is that wiring, exactly, rather than a dependency.
 *
 * ---------------------------------------------------------------------------
 * WHAT A FIELD IS FOR
 * ---------------------------------------------------------------------------
 *
 * `TextField` and `SelectField` in ui/index.tsx each do their own label, hint,
 * error and `aria-describedby` bookkeeping. That was fine while every field in
 * the product was one of those two. It stops being fine the moment a field
 * holds a Combobox, a Slider, a Radio Group or a Date Picker — none of which is
 * an `<input>`, and each of which would otherwise re-implement the same four
 * lines and get one of them subtly wrong.
 *
 * So `Field` owns the parts that are easy to get wrong and hands the control
 * what it needs:
 *
 *   - a `<label>` bound by `htmlFor`, or `aria-labelledby` where the control is
 *     not a labelable element,
 *   - `aria-describedby` composed from the hint AND the error, in that order,
 *     because a screen reader reads them in DOM order and the error must not
 *     replace the instruction that would have prevented it,
 *   - `aria-invalid` only when there IS an error,
 *   - `role="alert"` on the error so it is announced when it appears.
 *
 * Placeholder-as-label stays prohibited: it disappears on input and fails
 * contrast (docs/27 §27.11).
 */

import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import styles from './Field.module.css';

export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
}

export function Field({
  label,
  hint,
  error,
  children,
  /**
   * `group` for a control that is not a labelable element — a radio set, a
   * segmented control, a combobox built from a button and a listbox. The label
   * then names a group rather than pointing at an input that does not exist.
   */
  as = 'field',
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  /** Receives the id and ARIA attributes the control must carry. */
  readonly children: (control: FieldControlProps) => ReactNode;
  readonly as?: 'field' | 'group';
}): ReactNode {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  /*
   * Hint FIRST, then error. Both are referenced at once when both exist —
   * replacing the hint with the error is how a person loses the very sentence
   * that told them what the field wanted.
   */
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined;

  const control: FieldControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error === undefined ? undefined : true,
  };

  return (
    <div className={styles.field} data-invalid={error === undefined ? undefined : true}>
      {as === 'group' ? (
        <span className={styles.label} id={labelId}>
          {label}
        </span>
      ) : (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}

      {as === 'group' ? (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          {children(control)}
        </div>
      ) : (
        children(control)
      )}

      {hint !== undefined && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Input group                                                                */
/* -------------------------------------------------------------------------- */

/**
 * An input with something fixed attached to it — a unit, a prefix, a shortcut.
 *
 * The attached part is INSIDE the field's border, so the whole thing reads as
 * one control. That is the point: "50" beside a separate grey box saying "/100"
 * is two objects; "50 /100" in one bordered field is a mark out of a hundred.
 *
 * The addon is `aria-hidden` when it is a unit, because the field's own label
 * should already say what the unit is — "Internal marks (out of 50)" — and a
 * screen reader announcing "slash one hundred" after every keystroke is noise.
 * When the addon is a CONTROL rather than a label, pass it as `action` instead
 * and it stays in the accessibility tree.
 */
export function InputGroup({
  children,
  prefix,
  suffix,
  action,
  icon,
}: {
  /** The `<input>` itself, already carrying the Field's ARIA props. */
  readonly children: ReactNode;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  /** An interactive trailing element — a clear button, a picker trigger. */
  readonly action?: ReactNode;
  readonly icon?: IconName | undefined;
}): ReactNode {
  return (
    <div className={styles.group}>
      {icon !== undefined && <Icon name={icon} size="nav" className={styles.groupIcon} />}
      {prefix !== undefined && (
        <span className={styles.addon} aria-hidden="true">
          {prefix}
        </span>
      )}
      {children}
      {suffix !== undefined && (
        <span className={styles.addon} aria-hidden="true">
          {suffix}
        </span>
      )}
      {action !== undefined && <span className={styles.groupAction}>{action}</span>}
    </div>
  );
}
