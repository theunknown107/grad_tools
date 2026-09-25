/**
 * One VTU result session: how to get the result from VTU's own page, and how
 * to bring the saved copy back into GradTools.
 *
 * GradTools never fetches results.vtu.ac.in, never frames it and never shows a
 * CAPTCHA field (docs/14). The official link is a plain new-tab anchor with no
 * USN in it; the student enters the USN and CAPTCHA on VTU's page themselves.
 */

import type { VtuResultCard, VtuResultSession } from '@gradtools/vtu-catalogue';
import { Copy, ExternalLink, FileUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Dialog, DialogBody, DialogContent } from '../../components/ui/dialog.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { Field, Select } from '../../components/ui/field.js';

const SEMESTER_OPTIONS = [
  { value: 'none', label: 'Not sure / choose on import' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `Semester ${String(n)}` })),
];

/**
 * Student-facing wording for a session whose link label disagrees with its URL
 * (`anomaly: 'label-url-mismatch'`). Only SplJcbcs25 carries it today, printed
 * as Non-CBCS with a CBCS-looking address, so the wording names that case.
 */
export const MISMATCH_CAUTION =
  "The source lists this link as Non-CBCS, but its address suggests CBCS. Check the scheme shown on VTU's page before importing.";
export const MISMATCH_SHORT = 'Check: listed as Non-CBCS, address suggests CBCS';

export function importHref(sessionId: string, semester: number | null): string {
  const params = new URLSearchParams({ session: sessionId });
  if (semester !== null) params.set('semester', String(semester));
  return `/import?${params.toString()}`;
}

export function SessionDetail({
  selection,
  usn,
  onOpenChange,
  onOpened,
}: {
  readonly selection: { readonly card: VtuResultCard; readonly session: VtuResultSession } | null;
  readonly usn: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpened: (sessionId: string) => void;
}) {
  const [semester, setSemester] = useState('none');
  if (selection === null) return null;
  const { card, session } = selection;
  const variant = session.variant ?? session.label;

  const copyUsn = async (): Promise<void> => {
    if (usn === null) return;
    try {
      await navigator.clipboard.writeText(usn);
      toast('USN copied', { tone: 'success' });
    } catch {
      toast('Could not copy. Select the USN and copy it yourself.', { tone: 'warning' });
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`${card.title} — ${session.resultType} (${variant})`}
        description="Source: Official VTU Result Portal"
      >
        <DialogBody className="flex flex-col gap-5">
          {session.anomaly !== null && <Callout tone="warning">{MISMATCH_CAUTION}</Callout>}
          <div className="flex flex-wrap items-center gap-1.5">
            {card.yearLabel !== null && <Badge>{card.yearLabel}</Badge>}
            <Badge tone="accent">{session.resultType}</Badge>
            <Badge>{variant}</Badge>
            {session.programme !== null && <Badge tone="info">{session.programme}</Badge>}
            {session.anomaly !== null && <Badge tone="warning">Check</Badge>}
          </div>

          <div className="rounded-xl bg-sunken p-4">
            <div className="text-[12px] font-medium text-ink-3">Student USN</div>
            {usn === null ? (
              <p className="mt-1 text-[13px] text-ink-2">
                <Link
                  to="/account?section=academic"
                  className="font-medium text-accent-ink underline-offset-4 hover:underline"
                >
                  Add your USN in your profile
                </Link>{' '}
                to have it here. You can still continue.
              </p>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="font-mono text-[15px] font-semibold tracking-wide text-ink">
                  {usn}
                </span>
                <Button size="sm" icon={<Copy />} onClick={() => void copyUsn()}>
                  Copy
                </Button>
              </div>
            )}
          </div>

          <ol className="flex flex-col gap-4 text-[13px] text-ink-2">
            <Step n={1} title="Open the official result page">
              <Button asChild variant="primary" size="sm" icon={<ExternalLink />}>
                <a
                  href={session.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpened(session.id)}
                >
                  Open official result page
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
            </Step>
            <Step n={2} title="Enter your USN and the CAPTCHA on VTU's page" />
            <Step n={3} title="Save the result: Print → Save as PDF (or Save page as HTML)" />
            <Step n={4} title="Import saved result">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Semester" optional className="sm:w-56">
                  <Select value={semester} onValueChange={setSemester} options={SEMESTER_OPTIONS} />
                </Field>
                <Button asChild icon={<FileUp />}>
                  <Link to={importHref(session.id, semester === 'none' ? null : Number(semester))}>
                    Import saved result
                  </Link>
                </Button>
              </div>
            </Step>
          </ol>

          <p className="text-[12px] leading-relaxed text-ink-3">
            GradTools does not enter the CAPTCHA or fetch the result for you. You get it from
            VTU&apos;s own page and import the copy you saved.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  n,
  title,
  children,
}: {
  readonly n: number;
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-weak text-[12px] font-semibold text-accent-ink"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <span className="font-medium text-ink">
          <span className="sr-only">Step {n}: </span>
          {title}
        </span>
        {children}
      </div>
    </li>
  );
}
