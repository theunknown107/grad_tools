/**
 * Help & Support (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * Shows the student's Support ID (with a copy button), lets them report a
 * problem in one short step (a category and optional description — no sensitive
 * data requested), and lists their past reports with status. Safe diagnostic
 * context is attached automatically, so the student never has to explain
 * technical details.
 */

import { Check, Copy, LifeBuoy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABEL,
  type SupportCategory,
} from '@gradtools/shared-types';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { Field, Select, Textarea } from '../../components/ui/field.js';
import { IconTile, SectionTitle } from '../../components/ui/page.js';
import { useSupport } from './useSupport.js';

const STATUS_TONE = {
  open: 'neutral',
  acknowledged: 'accent',
  investigating: 'warning',
  resolved: 'success',
} as const;

function CopyField({ label, value }: { readonly label: string; readonly value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Could not copy. Select the ID and copy it yourself.', { tone: 'warning' });
    }
  };
  return (
    <div>
      <div className="text-[11px] tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="rounded-md bg-sunken px-2 py-1 font-mono text-[13px] font-medium">
          {value}
        </code>
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? <Check /> : <Copy />}
          onClick={() => void copy()}
          aria-label={`Copy ${label}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/** The Account → Help & Support section. */
export function SupportPanel({ activeIncidentId }: { readonly activeIncidentId?: string | undefined }) {
  const { supportId, reports, submit } = useSupport();
  const [category, setCategory] = useState<SupportCategory | ''>('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ incidentId?: string | undefined; queued: boolean } | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (category === '') return;
    setBusy(true);
    setDone(null);
    try {
      const result = await submit(
        category,
        description.trim() === '' ? undefined : description.trim(),
      );
      if (result.status === 'error') {
        toast('Could not send your report. Try again.', { tone: 'warning' });
        return;
      }
      setDone({ incidentId: result.report?.incidentId, queued: result.status === 'queued' });
      setCategory('');
      setDescription('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <IconTile tone="accent" size="lg">
            <LifeBuoy />
          </IconTile>
          <div className="min-w-0 flex-1">
            <SectionTitle>Help &amp; Support</SectionTitle>
            <p className="mt-1 max-w-xl text-[13px] text-ink-2">
              Quote your Support ID when you report a problem — it helps us find what went wrong
              without seeing any of your academic data.
            </p>
            <div className="mt-4 flex flex-wrap gap-6">
              {supportId !== null && <CopyField label="Support ID" value={supportId} />}
              {activeIncidentId !== undefined && (
                <CopyField label="Incident ID" value={activeIncidentId} />
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <SectionTitle>Report a problem</SectionTitle>
        <form onSubmit={(event) => void onSubmit(event)} className="mt-4 flex flex-col gap-4">
          <Field label="What's it about?">
            <Select
              aria-label="Problem category"
              value={category}
              onValueChange={(value) => setCategory(value as SupportCategory)}
              placeholder="Choose a category"
              options={SUPPORT_CATEGORIES.map((key) => ({
                value: key,
                label: SUPPORT_CATEGORY_LABEL[key],
              }))}
            />
          </Field>
          <Field
            label="What happened?"
            hint="Optional. Please don't include passwords or personal data."
          >
            <Textarea
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A short description helps."
            />
          </Field>
          {done !== null && (
            <Callout role="status">
              {done.queued
                ? "You're offline. Your report will be sent when you're back online."
                : 'Thanks — your report was sent.'}
              {done.incidentId !== undefined && (
                <>
                  {' '}
                  Incident ID <strong className="font-mono">{done.incidentId}</strong>.
                </>
              )}
            </Callout>
          )}
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={category === ''}>
              Send report
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <SectionTitle>My reported problems</SectionTitle>
        {reports === null ? (
          <p className="mt-2 text-[13px] text-ink-3">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-2">You haven&rsquo;t reported anything yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {reports.map((report) => (
              <li
                key={report.incidentId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
              >
                <span className="font-mono text-[13px]">{report.incidentId}</span>
                <span className="text-[13px] text-ink-2">
                  {SUPPORT_CATEGORY_LABEL[report.category]}
                </span>
                <span className="text-[12px] text-ink-3">
                  {new Date(report.createdAt).toLocaleDateString()}
                </span>
                <Badge tone={STATUS_TONE[report.status]} className="ml-auto capitalize">
                  {report.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
