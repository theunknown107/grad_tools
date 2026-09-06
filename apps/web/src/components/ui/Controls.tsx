/**
 * The form controls: Checkbox, Radio Group, Switch, Slider, Toggle, Toggle
 * Group and Button Group.
 *
 * Authority: Phase 7B §2, §11, §12 · docs/27 §27.2, §27.6
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. Each control is the Radix primitive shadcn
 * ships — `react-checkbox`, `react-radio-group`, `react-switch`, `react-slider`,
 * `react-toggle`, `react-toggle-group` — with GradTools CSS Modules and tokens
 * in place of the Tailwind classes.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE NOT `<input type="checkbox">`
 * ---------------------------------------------------------------------------
 *
 * A native checkbox is genuinely the right answer when all you need is a box
 * that ticks, and GradTools uses native inputs where that is true. These exist
 * for the cases where it is not:
 *
 *   - a checkbox with an INDETERMINATE state that must be announced, not just
 *     drawn (the "select all" on a filtered notification list),
 *   - a radio group whose arrow keys must wrap, skip disabled options and move
 *     selection with focus — the WAI-ARIA radio pattern, which native radios
 *     only implement when they share a `name` AND a form,
 *   - a switch, which is `role="switch"` and is announced "on/off" rather than
 *     "checked", and which native HTML has no element for at all,
 *   - a slider that must be operable with Home/End/PageUp/PageDown and support
 *     a step the pointer snaps to.
 *
 * In every case the primitive renders a real button with the right role and
 * keeps a hidden native input in sync for form submission, so nothing is lost.
 *
 * ---------------------------------------------------------------------------
 * COLOUR IS NEVER THE STATE
 * ---------------------------------------------------------------------------
 *
 * docs/27 §27.2: every one of these carries a SHAPE as well as a fill — a tick,
 * a dash, a dot, a moved thumb. A person who cannot distinguish the accent from
 * the surface can still read all of them.
 */

import { useId, type ReactNode } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { Icon, type IconName } from '../icons.js';
import styles from './Controls.module.css';

/* -------------------------------------------------------------------------- */
/* Checkbox                                                                   */
/* -------------------------------------------------------------------------- */

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled = false,
}: {
  /** `'indeterminate'` for a "select all" that is partly selected. */
  readonly checked: boolean | 'indeterminate';
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly disabled?: boolean | undefined;
}): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={styles.checkRow}>
      <CheckboxPrimitive.Root
        id={id}
        className={styles.checkbox}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint === undefined ? undefined : hintId}
        onCheckedChange={(next) => {
          /*
           * Radix reports `'indeterminate'` back when that is the state it was
           * given. A caller asked "is it on now?", and the answer to that from
           * a partial state is yes — clicking a partly-filled "select all"
           * selects everything.
           */
          onCheckedChange(next === true || next === 'indeterminate');
        }}
      >
        <CheckboxPrimitive.Indicator className={styles.checkMark}>
          <Icon name={checked === 'indeterminate' ? 'minus' : 'check'} size="micro" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div className={styles.checkText}>
        <label className={styles.checkLabel} htmlFor={id}>
          {label}
        </label>
        {hint !== undefined && (
          <span className={styles.hint} id={hintId}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Radio group                                                                */
/* -------------------------------------------------------------------------- */

export interface RadioOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly disabled?: boolean | undefined;
}

/**
 * One choice from a short, mutually exclusive set.
 *
 * A `<fieldset>` with a `<legend>`, not a div with a heading: the legend is
 * what a screen reader repeats before each option, and without it the options
 * are announced as five unrelated radios.
 */
export function RadioGroup({
  legend,
  value,
  onValueChange,
  options,
  orientation = 'vertical',
}: {
  readonly legend: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly RadioOption[];
  readonly orientation?: 'vertical' | 'horizontal';
}): ReactNode {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{legend}</legend>
      <RadioGroupPrimitive.Root
        className={styles.radioGroup}
        value={value}
        onValueChange={onValueChange}
        orientation={orientation}
        data-orientation={orientation}
      >
        {options.map((option) => (
          <RadioOptionRow key={option.value} option={option} />
        ))}
      </RadioGroupPrimitive.Root>
    </fieldset>
  );
}

function RadioOptionRow({ option }: { readonly option: RadioOption }): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={styles.checkRow}>
      <RadioGroupPrimitive.Item
        id={id}
        className={styles.radio}
        value={option.value}
        disabled={option.disabled === true}
        aria-describedby={option.hint === undefined ? undefined : hintId}
      >
        <RadioGroupPrimitive.Indicator className={styles.radioDot} />
      </RadioGroupPrimitive.Item>
      <div className={styles.checkText}>
        <label className={styles.checkLabel} htmlFor={id}>
          {option.label}
        </label>
        {option.hint !== undefined && (
          <span className={styles.hint} id={hintId}>
            {option.hint}
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Switch                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An immediate on/off preference.
 *
 * A switch takes effect NOW; a checkbox takes effect when the form is
 * submitted. Using one where the other belongs is how a person ends up
 * wondering whether their notification setting saved.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly disabled?: boolean | undefined;
}): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={styles.switchRow}>
      <div className={styles.checkText}>
        <label className={styles.checkLabel} htmlFor={id}>
          {label}
        </label>
        {hint !== undefined && (
          <span className={styles.hint} id={hintId}>
            {hint}
          </span>
        )}
      </div>
      <SwitchPrimitive.Root
        id={id}
        className={styles.switch}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint === undefined ? undefined : hintId}
        onCheckedChange={onCheckedChange}
      >
        <SwitchPrimitive.Thumb className={styles.switchThumb} />
      </SwitchPrimitive.Root>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Slider                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A value chosen along a range.
 *
 * Used where the RANGE ITSELF is the information — "how many classes could I
 * miss" has a hard ceiling the student needs to feel, and a number field hides
 * it. Where the ceiling does not matter, a number field is better, and this
 * component should not be reached for.
 *
 * The live value is rendered as text beside the track, always. A slider whose
 * only readout is its thumb position cannot be read by anyone who needs a
 * figure, and cannot be printed.
 */
export function Slider({
  label,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  format,
  disabled = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Turns the raw number into what the student reads: "3 classes", "8.2". */
  readonly format?: (value: number) => string;
  readonly disabled?: boolean | undefined;
}): ReactNode {
  const id = useId();
  const shown = format === undefined ? String(value) : format(value);

  return (
    <div className={styles.sliderField}>
      <div className={styles.sliderHead}>
        <label className={styles.checkLabel} htmlFor={id}>
          {label}
        </label>
        <span className={styles.sliderValue}>{shown}</span>
      </div>
      <SliderPrimitive.Root
        className={styles.slider}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => {
          const first = next[0];
          if (first !== undefined) onValueChange(first);
        }}
      >
        <SliderPrimitive.Track className={styles.sliderTrack}>
          <SliderPrimitive.Range className={styles.sliderRange} />
        </SliderPrimitive.Track>
        {/*
          `aria-label` on the THUMB, not the root. The thumb is what carries
          role="slider" and its value; a label on the root names a group that
          assistive technology never lands on.
        */}
        <SliderPrimitive.Thumb
          id={id}
          className={styles.sliderThumb}
          aria-label={label}
          aria-valuetext={shown}
        />
      </SliderPrimitive.Root>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toggle and toggle group                                                    */
/* -------------------------------------------------------------------------- */

/** A single control that is either pressed or not — "unread only". */
export function Toggle({
  pressed,
  onPressedChange,
  label,
  icon,
  disabled = false,
}: {
  readonly pressed: boolean;
  readonly onPressedChange: (pressed: boolean) => void;
  readonly label: string;
  readonly icon?: IconName | undefined;
  readonly disabled?: boolean | undefined;
}): ReactNode {
  return (
    <TogglePrimitive.Root
      className={styles.toggle}
      pressed={pressed}
      disabled={disabled}
      onPressedChange={onPressedChange}
    >
      {icon !== undefined && <Icon name={icon} size="small" />}
      <span>{label}</span>
    </TogglePrimitive.Root>
  );
}

export interface ToggleOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
}

/**
 * A segmented set where exactly one option is chosen — Today/Week,
 * Overview/Subjects.
 *
 * `type="single"` with a REQUIRED value, so the set can never end up with
 * nothing selected. A segmented control showing no selection is a control whose
 * state cannot be read.
 *
 * Not the same component as `IslandTabs`: tabs switch between panels of
 * content and carry `role="tab"`; this changes a parameter of the panel you are
 * already looking at, and carries `role="group"` with pressed buttons.
 */
export function ToggleGroup({
  label,
  value,
  onValueChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly ToggleOption[];
}): ReactNode {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      className={styles.toggleGroup}
      value={value}
      aria-label={label}
      onValueChange={(next) => {
        /*
         * Radix reports '' when the pressed item is pressed again. That is a
         * deselect, and this set does not have an unselected state, so it is
         * dropped rather than propagated.
         */
        if (next !== '') onValueChange(next);
      }}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          className={styles.toggleItem}
          value={option.value}
        >
          {option.icon !== undefined && <Icon name={option.icon} size="small" />}
          <span>{option.label}</span>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Button group                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Buttons that belong to one decision, joined into a single object.
 *
 * Attended / Missed is the case this exists for: two actions on one question,
 * where the gap between separate buttons implies they are unrelated.
 *
 * Purely presentational, and deliberately so. shadcn's Button Group is markup
 * and CSS with no primitive behind it, because there is no interaction to
 * model — the buttons inside keep their own semantics, their own focus and
 * their own tab stops. Giving the group roving focus would REMOVE tab stops a
 * keyboard user currently has.
 */
export function ButtonGroup({
  label,
  children,
}: {
  /** Names the decision the buttons answer, e.g. "Record this class". */
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={styles.buttonGroup} role="group" aria-label={label}>
      {children}
    </div>
  );
}
