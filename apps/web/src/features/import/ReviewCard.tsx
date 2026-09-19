/**
 * Shared furniture for every import review: the file-summary card head, the
 * recorded state, and the save footer. Each review (result, timetable,
 * scheme, calendar, exams) composes these, so the five read as one flow.
 */

import { CheckCircle2, FileText, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { IconTile } from '../../components/ui/page.js';
import { cn } from '../../lib/cn.js';

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function ReviewCard({
  title,
  meta,
  badges,
  children,
  label,
}: {
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly badges?: ReactNode;
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile tone="danger" size="lg">
            <FileText />
          </IconTile>
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-medium text-ink">{title}</h3>
            <div className="text-[12px] text-ink-3">{meta}</div>
          </div>
        </div>
        {badges !== undefined && <div className="flex flex-wrap items-center gap-2">{badges}</div>}
      </Card>
      {children}
    </section>
  );
}

export function Recorded({
  title = 'Data confirmed and recorded.',
  children,
  figures,
  actions,
  label,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly figures?: readonly { readonly label: string; readonly value: ReactNode }[];
  readonly actions?: ReactNode;
  readonly label: string;
}) {
  return (
    <Card
      aria-label={label}
      className="flex animate-pop flex-col items-center px-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="mb-4 grid size-16 place-items-center rounded-full bg-success text-canvas"
      >
        <CheckCircle2 className="size-8" />
      </span>
      <h3 role="status" className="text-[20px] font-semibold text-ink">
        {title}
      </h3>
      <p className="mt-1.5 max-w-md text-[14px] text-ink-2">{children}</p>
      {figures !== undefined && figures.length > 0 && (
        <dl className="mt-4 flex items-center gap-4 rounded-xl border border-line bg-panel px-5 py-3">
          {figures.map((figure, index) => (
            <div
              key={figure.label}
              className={cn(
                'flex flex-col-reverse text-center',
                index > 0 && 'border-l border-line pl-4',
              )}
            >
              <dt className="text-[11px] text-ink-3">{figure.label}</dt>
              <dd className="tnum text-xl font-semibold text-ink">{figure.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions !== undefined && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </Card>
  );
}

export function SaveFooter({
  error,
  onConfirm,
  confirmLabel,
  disabled,
  saving,
  secondary,
  icon,
}: {
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly confirmLabel: string;
  readonly disabled: boolean;
  readonly saving: boolean;
  readonly secondary?: ReactNode;
  readonly icon?: ReactNode;
}) {
  return (
    <>
      {error !== null && (
        <Callout tone="danger" role="alert" title="Not recorded.">
          {error} Nothing you reviewed has been lost — press the button again to retry.
        </Callout>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
          <Lock className="size-3.5" aria-hidden="true" /> Nothing is saved until you confirm.
        </p>
        <div className="flex flex-wrap gap-2">
          {secondary}
          <Button
            variant="primary"
            icon={icon}
            loading={saving}
            disabled={disabled}
            onClick={onConfirm}
          >
            {saving ? 'Recording…' : confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}

/** The error text a failed save shows, from whatever the repository threw. */
export function saveFailure(cause: unknown, what: string): string {
  return cause instanceof Error && cause.message !== ''
    ? `${what} could not be recorded: ${cause.message}`
    : `${what} could not be recorded. Please try again.`;
}
