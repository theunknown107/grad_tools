/**
 * Calendar and Date Picker.
 *
 * Authority: Phase 7B §2, §12 · docs/27 §27.3
 * Provenance: behaviourally faithful shadcn implementation adapted to the
 * GradTools styling architecture. shadcn's Calendar is `react-day-picker`, and
 * so is this one; its Date Picker is that calendar inside a Popover, and so is
 * this one. Every Tailwind class in shadcn's `classNames` map is replaced by
 * the GradTools module beside this file — the MAP is what is reproduced, not
 * the strings in it.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `<input type="date">`
 * ---------------------------------------------------------------------------
 *
 * GradTools uses the native date input already — `TimetablePage` has three —
 * and that stays. It is smaller, it is localised for free, and on a phone it
 * opens the platform picker, which is better than anything shipped here.
 *
 * What it cannot do is the reason this exists: show the SEMESTER on the
 * calendar. An academic calendar has holidays, exam windows and an effective-
 * from date, and the question a student asks a date field is "which of these
 * days is a working day" — which the native control has no way to express.
 * `modifiers` is that feature, and it is the only reason to take the
 * dependency.
 *
 * A date field with nothing to mark should still be `<input type="date">`.
 */

import { useState, type ReactNode } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';
import { Icon } from '../icons.js';
import { Popover, PopoverContent, PopoverTrigger } from './Popover.js';
import styles from './Calendar.module.css';

/**
 * Days worth marking on an academic calendar.
 *
 * Named for what they MEAN, not for how they look, so the page cannot invent a
 * colour — the same rule the tone system enforces for cards.
 */
export interface CalendarMarks {
  readonly holiday?: readonly Date[] | undefined;
  readonly exam?: readonly Date[] | undefined;
  /** Days outside the semester: before it starts, after it ends. */
  readonly outsideTerm?: Matcher | undefined;
}

const CLASS_NAMES = {
  root: styles.root ?? '',
  months: styles.months ?? '',
  month: styles.month ?? '',
  month_caption: styles.caption ?? '',
  caption_label: styles.captionLabel ?? '',
  nav: styles.nav ?? '',
  button_previous: styles.navButton ?? '',
  button_next: styles.navButton ?? '',
  chevron: styles.chevron ?? '',
  month_grid: styles.grid ?? '',
  weekdays: styles.weekdays ?? '',
  weekday: styles.weekday ?? '',
  week: styles.week ?? '',
  day: styles.day ?? '',
  day_button: styles.dayButton ?? '',
  today: styles.today ?? '',
  selected: styles.selected ?? '',
  outside: styles.outside ?? '',
  disabled: styles.disabled ?? '',
  hidden: styles.hidden ?? '',
};

export function Calendar({
  selected,
  onSelect,
  marks,
  disabled,
  label,
  month,
  onMonthChange,
}: {
  readonly selected?: Date | undefined;
  readonly onSelect: (date: Date | undefined) => void;
  readonly marks?: CalendarMarks | undefined;
  readonly disabled?: Matcher | undefined;
  /** Names the grid. A calendar with no name is a table of numbers. */
  readonly label: string;
  readonly month?: Date | undefined;
  readonly onMonthChange?: ((month: Date) => void) | undefined;
}): ReactNode {
  return (
    <DayPicker
      mode="single"
      classNames={CLASS_NAMES}
      aria-label={label}
      showOutsideDays
      /*
       * MONDAY FIRST. VTU's week runs Monday to Saturday — `WEEKDAYS` in the
       * timetable domain says so — and a calendar that starts on Sunday puts
       * the working week across a column break.
       */
      weekStartsOn={1}
      {...(selected === undefined ? {} : { selected })}
      onSelect={onSelect}
      {...(disabled === undefined ? {} : { disabled })}
      {...(month === undefined ? {} : { month })}
      {...(onMonthChange === undefined ? {} : { onMonthChange })}
      modifiers={{
        ...(marks?.holiday === undefined ? {} : { holiday: [...marks.holiday] }),
        ...(marks?.exam === undefined ? {} : { exam: [...marks.exam] }),
        ...(marks?.outsideTerm === undefined ? {} : { outsideTerm: marks.outsideTerm }),
      }}
      modifiersClassNames={{
        holiday: styles.holiday ?? '',
        exam: styles.exam ?? '',
        outsideTerm: styles.outsideTerm ?? '',
      }}
      components={{
        /* The library's own chevron, replaced by the GradTools glyph so the
           calendar does not introduce a second icon style. */
        Chevron: ({ orientation }) => (
          <Icon
            name={orientation === 'left' ? 'arrowLeft' : 'chevronRight'}
            size="nav"
            className={styles.chevron}
          />
        ),
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Date picker                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A date field that opens a calendar.
 *
 * The chosen date is rendered as TEXT on the trigger, in the same
 * `YYYY-MM-DD` form the rest of the product stores and displays, so what the
 * student reads and what is saved cannot drift.
 */
export function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'Pick a date',
  marks,
  disabled,
  id,
  describedBy,
  invalid,
}: {
  /** ISO `YYYY-MM-DD`, or null. The form the domain already uses. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly marks?: CalendarMarks | undefined;
  readonly disabled?: Matcher | undefined;
  readonly id?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly invalid?: true | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const selected = value === null ? undefined : parseIsoDay(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        className={styles.trigger}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        data-placeholder={value === null ? true : undefined}
      >
        <Icon name="timetable" size="nav" className={styles.triggerIcon} />
        <span className={styles.triggerText}>{value ?? placeholder}</span>
      </PopoverTrigger>
      <PopoverContent label={label} align="start" padded={false}>
        <Calendar
          label={label}
          {...(selected === undefined ? {} : { selected })}
          {...(marks === undefined ? {} : { marks })}
          {...(disabled === undefined ? {} : { disabled })}
          onSelect={(date) => {
            setOpen(false);
            onChange(date === undefined ? null : toIsoDay(date));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Local-day conversion                                                       */
/* -------------------------------------------------------------------------- */

/*
 * `new Date('2026-09-06')` parses as UTC MIDNIGHT and then renders in local
 * time, so anywhere west of Greenwich it is the 5th. Every calendar bug of this
 * shape comes from that one line. These two functions keep the date in LOCAL
 * time on both sides of the boundary, and neither ever touches a timezone.
 */

function parseIsoDay(iso: string): Date | undefined {
  const parts = iso.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  return new Date(year, month - 1, day);
}

function toIsoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}
