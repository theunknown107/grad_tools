/**
 * The design's five-step import stepper. Announced as an ordered list with the
 * current step marked, so progress is not colour-only.
 */

import { Check } from 'lucide-react';
import { cn } from '../../lib/cn.js';

export const IMPORT_STEPS = ['Select', 'Validate', 'Parse', 'Review', 'Confirm'] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

export function ImportStepper({
  at,
  done = false,
}: {
  readonly at: ImportStep;
  readonly done?: boolean;
}) {
  const current = IMPORT_STEPS.indexOf(at) + (done ? 1 : 0);
  return (
    <ol
      aria-label="Import progress"
      tabIndex={0}
      className="relative flex max-w-full min-w-0 items-center gap-2 overflow-x-auto pb-1 scroll-quiet focus-visible:outline-offset-[-2px]"
    >
      {IMPORT_STEPS.map((step, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className="flex shrink-0 items-center gap-2"
          >
            <span
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                complete && 'bg-success-weak text-success',
                active && 'bg-accent-weak text-accent-ink',
                !complete && !active && 'border-line text-ink-3',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'tnum grid size-4 place-items-center rounded-full text-[10px]',
                  complete && 'bg-success text-canvas',
                  active && 'bg-accent text-on-accent',
                  !complete && !active && 'bg-sunken text-ink-3',
                )}
              >
                {complete ? <Check className="size-2.5" strokeWidth={3} /> : index + 1}
              </span>
              {step}
              <span className="sr-only">{complete ? ' (done)' : active ? ' (current)' : ''}</span>
            </span>
            {index < IMPORT_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={cn('h-px w-4', complete ? 'bg-success/40' : 'bg-line')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
