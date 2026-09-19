/**
 * "How was this calculated?" — every figure the rules engine returns carries
 * its formula, inputs, steps and the regulation clause it follows. This is
 * where a student can see them.
 */

import type { Explanation } from '@gradtools/academic-rules';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn.js';

function stepValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function ExplanationDisclosure({
  explanation,
  className,
}: {
  readonly explanation: Explanation;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={cn('rounded-xl border border-line bg-panel', className)}
    >
      <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-[13px] font-medium text-ink-2 transition-colors hover:text-ink">
        How was this calculated?
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 text-ink-3 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="data-[state=open]:animate-fade">
        <div className="border-t border-line px-4 py-3">
          <div className="rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] text-accent-ink">
            {explanation.formula}
          </div>
          {explanation.steps.length > 0 && (
            <ul className="mt-3 divide-y divide-line text-[12px]">
              {explanation.steps.map((step, index) => (
                <li
                  key={`${step.label}-${String(index)}`}
                  className="flex items-center justify-between gap-4 py-1.5"
                >
                  <span className="text-ink-2">{step.label}</span>
                  <span className="tnum font-medium text-ink">{stepValue(step.value)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Rule set <code className="font-mono text-ink-2">{explanation.ruleSetId}</code> v
            {explanation.ruleSetVersion} · clause{' '}
            <strong className="font-semibold text-ink-2">{explanation.clause}</strong>
            <br />
            <a
              href={explanation.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-medium text-accent-ink underline-offset-4 hover:underline"
            >
              View the source regulation <ExternalLink className="size-3" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
