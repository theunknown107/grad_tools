/**
 * The support hook (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * Owns the Support ID, the student's own reports, and submitting a new one —
 * including the offline path: a report created with no connection is queued in
 * the account's own storage scope (a minimal payload: category, short text,
 * safe context — never a token or academic data) and flushed when the browser
 * comes back online. Flushing is idempotent per entry and clears on success, so
 * a failed send is retried rather than lost or duplicated.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  SUPPORT_ROUTES,
  type SupportCategory,
  type SupportContext,
  type SupportReport,
} from '@gradtools/shared-types';
import { authorizedFetch } from '../../lib/api.js';
import { collectContext } from '../../lib/client-info.js';
import { readValue, writeValue } from '../../repositories/local/store.js';
import { useAuth } from '../auth/AuthContext.js';
import { scopeFor } from '../../domain/auth.js';

interface QueuedReport {
  readonly category: SupportCategory;
  readonly description?: string;
  readonly context?: SupportContext;
  readonly queuedAt: string;
}

export interface SubmitResult {
  readonly status: 'sent' | 'queued' | 'error';
  readonly report?: SupportReport;
}

export function useSupport() {
  const { adapter, state } = useAuth();
  const scope = scopeFor(state);
  const [supportId, setSupportId] = useState<string | null>(null);
  const [reports, setReports] = useState<SupportReport[] | null>(null);

  const refresh = useCallback(async () => {
    const res = await authorizedFetch(adapter, SUPPORT_ROUTES.reports);
    if (res === null || !res.ok) return;
    const body = (await res.json()) as { supportId: string; reports: SupportReport[] };
    setSupportId(body.supportId);
    setReports(body.reports);
  }, [adapter]);

  const sendOne = useCallback(
    async (payload: QueuedReport): Promise<SupportReport | null> => {
      const res = await authorizedFetch(adapter, SUPPORT_ROUTES.reports, {
        method: 'POST',
        body: JSON.stringify({
          category: payload.category,
          ...(payload.description !== undefined ? { description: payload.description } : {}),
          ...(payload.context !== undefined ? { context: payload.context } : {}),
        }),
      });
      if (res === null || !res.ok) return null;
      return (await res.json()) as SupportReport;
    },
    [adapter],
  );

  /** Sends anything queued for this account, clearing entries that go through. */
  const flush = useCallback(async () => {
    if (scope === null) return;
    const queued = (await readValue<QueuedReport[]>(scope, 'supportQueue')) ?? [];
    if (queued.length === 0) return;
    const remaining: QueuedReport[] = [];
    let sentAny = false;
    for (const entry of queued) {
      const sent = (await sendOne(entry)) !== null;
      if (sent) sentAny = true;
      else remaining.push(entry);
    }
    await writeValue(scope, 'supportQueue', remaining);
    if (sentAny) void refresh();
  }, [scope, sendOne, refresh]);

  useEffect(() => {
    void refresh();
    void flush();
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh, flush]);

  const submit = useCallback(
    async (category: SupportCategory, description?: string): Promise<SubmitResult> => {
      const context = await collectContext();
      const payload: QueuedReport = {
        category,
        ...(description !== undefined && description !== '' ? { description } : {}),
        context,
        queuedAt: new Date().toISOString(),
      };

      if (!navigator.onLine) {
        if (scope !== null) {
          const queue = (await readValue<QueuedReport[]>(scope, 'supportQueue')) ?? [];
          await writeValue(scope, 'supportQueue', [...queue, payload]);
        }
        return { status: 'queued' };
      }

      const report = await sendOne(payload);
      if (report === null) {
        // The send failed though we seemed online: queue it so it is not lost.
        if (scope !== null) {
          const queue = (await readValue<QueuedReport[]>(scope, 'supportQueue')) ?? [];
          await writeValue(scope, 'supportQueue', [...queue, payload]);
        }
        return { status: 'queued' };
      }
      setReports((current) => [report, ...(current ?? [])]);
      return { status: 'sent', report };
    },
    [scope, sendOne],
  );

  return { supportId, reports, submit, refresh };
}
