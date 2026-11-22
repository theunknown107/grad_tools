/**
 * ✓ attended · ✕ missed · ○ cancelled.
 *
 * One grouped control, built from the design system's `Segmented` (a Radix
 * ToggleGroup, so it is a radiogroup with arrow-key movement and an announced
 * selection). Three rules it must keep:
 *
 * - ICON AND TEXT, never colour alone. The three states are distinguishable
 *   without seeing a difference between green and amber.
 * - Pressing the selected state again does NOT clear it. A mis-tap that erases
 *   a record is worse than one that records the wrong thing, so clearing is its
 *   own action: the toast's Undo, or "Clear this mark" in the row menu.
 * - "Cancelled" is a statement about the SCHEDULE. It is offered here because
 *   this is where a student is when they learn of it, but it writes a different
 *   fact (domain/types, TWO AXES).
 */

import { Ban, Check, X } from 'lucide-react';
import { Segmented } from '../../components/ui/segmented.js';
import type { MarkState } from '../../hooks/useMarkClass.js';

const OPTIONS = [
  { value: 'attended' as const, label: 'Attended', Icon: Check },
  { value: 'missed' as const, label: 'Missed', Icon: X },
  { value: 'cancelled' as const, label: 'Cancelled', Icon: Ban },
];

export function AttendanceControl({
  value,
  onChange,
  name,
  compact = false,
}: {
  readonly value: MarkState;
  readonly onChange: (next: MarkState) => void;
  /** What this control is about, for its accessible name. */
  readonly name: string;
  /** Icons only, with the label kept for screen readers. */
  readonly compact?: boolean;
}) {
  return (
    <Segmented<Exclude<MarkState, 'unmarked'>>
      size="sm"
      label={`Attendance for ${name}`}
      /*
       * `Segmented` never reports an empty value, so re-pressing the selected
       * option keeps it — which is exactly the behaviour wanted here.
       */
      value={value === 'unmarked' ? ('' as Exclude<MarkState, 'unmarked'>) : value}
      onChange={onChange}
      options={OPTIONS.map((option) => ({
        value: option.value,
        label: (
          <>
            <option.Icon aria-hidden="true" />
            <span className={compact ? 'sr-only' : undefined}>{option.label}</span>
          </>
        ),
      }))}
    />
  );
}
