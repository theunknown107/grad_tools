/**
 * Report a problem BEFORE signing in (OBSERVABILITY-AND-SUPPORT-V1 §pre-login).
 *
 * For someone who cannot get past the sign-in screen. It posts to the public,
 * UNAUTHENTICATED support endpoint — no session, no bearer token — and shows the
 * Incident ID it gets back. There is NO Support ID (that belongs to a signed-in
 * account). Safe diagnostic context (platform, app version, route) is attached
 * automatically; no sensitive data is collected.
 *
 * Collapsed by default so the sign-in screen stays uncluttered and usable.
 */

import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABEL,
  SUPPORT_ROUTES,
  type AnonymousSupportReport,
  type SupportCategory,
} from '@gradtools/shared-types';
import { Button } from '../../components/ui/button.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { Field, Select, Textarea } from '../../components/ui/field.js';
import { collectContext, clientHeaders } from '../../lib/client-info.js';
import { apiBaseUrl } from '../../repositories/reference.js';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; incidentId: string }
  | { kind: 'error'; message: string };

export function PreLoginReport() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportCategory | ''>('');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (category === '') return;
    setState({ kind: 'sending' });
    try {
      const context = await collectContext();
      const trimmed = description.trim();
      const response = await fetch(`${apiBaseUrl()}${SUPPORT_ROUTES.anonymousReport}`, {
        method: 'POST',
        // Correlation headers only (platform, app version). NO Authorization.
        headers: { ...clientHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          ...(trimmed === '' ? {} : { description: trimmed }),
          context,
        }),
      });
      if (response.status === 429) {
        setState({
          kind: 'error',
          message: 'Too many reports just now. Wait a minute and try again.',
        });
        return;
      }
      if (!response.ok) {
        setState({
          kind: 'error',
          message: 'Could not send your report. Check your connection and try again.',
        });
        return;
      }
      const body = (await response.json()) as AnonymousSupportReport;
      setState({ kind: 'sent', incidentId: body.incidentId });
      setCategory('');
      setDescription('');
    } catch {
      setState({
        kind: 'error',
        message: "You appear to be offline. We couldn't send your report.",
      });
    }
  };

  const copyIncident = async (incidentId: string) => {
    try {
      await navigator.clipboard.writeText(incidentId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Could not copy. Select the ID and copy it yourself.', { tone: 'warning' });
    }
  };

  if (!open) {
    return (
      <p className="mt-5 text-[12px] text-ink-3">
        Can&rsquo;t sign in?{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-accent-ink underline-offset-4 hover:underline"
        >
          Report a problem
        </button>
        .
      </p>
    );
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">Report a problem</h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="mt-1 text-[12px] text-ink-3">
        You don&rsquo;t need an account. Please don&rsquo;t include passwords or personal details.
      </p>

      {state.kind === 'sent' ? (
        <Callout role="status" className="mt-4">
          Thanks — your report was sent. Quote this Incident ID if you follow up:
          <span className="mt-2 flex items-center gap-2">
            <code className="rounded-md bg-sunken px-2 py-1 font-mono text-[13px] font-medium">
              {state.incidentId}
            </code>
            <Button
              size="sm"
              variant="ghost"
              icon={copied ? <Check /> : <Copy />}
              onClick={() => void copyIncident(state.incidentId)}
              aria-label="Copy Incident ID"
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </span>
        </Callout>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-4">
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
          <Field label="What happened?" hint="Optional.">
            <Textarea
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A short description helps."
            />
          </Field>
          {state.kind === 'error' && (
            <Callout tone="warning" role="alert">
              {state.message}
            </Callout>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={state.kind === 'sending'}
            disabled={category === ''}
            className="w-full"
          >
            Send report
          </Button>
        </form>
      )}
    </div>
  );
}
