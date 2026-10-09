/**
 * The support UI and offline queue (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * Proves: a report sends with safe context and a bearer token; an offline
 * report is queued (minimal payload, no token, no academic data) and flushed on
 * reconnect, clearing on success; a failed send is retried not duplicated; the
 * reporting path never loops. The adapter is the fake from the auth harness; no
 * real network.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { SupportPanel } from '../src/features/support/SupportPanel.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import type { Identity } from '../src/domain/auth.js';
import { readValue } from '../src/repositories/local/store.js';

const IDENTITY: Identity = { userId: 'user-support-a', email: null, provider: 'email' };
const SUPPORT_ID = 'GT-ABCD1234';

function adapterFor(signedIn: boolean): AuthAdapter {
  return {
    current: async () => (signedIn ? IDENTITY : null),
    accessToken: async () => (signedIn ? 'synthetic-token' : null),
    signInWithPassword: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null, needsConfirmation: false }),
    signInWithProvider: async () => ({ error: null }),
    sendRecovery: async () => ({ error: null }),
    updatePassword: async () => ({ error: null }),
    completeDeepLink: async () => ({ error: null }),
    signOut: async () => undefined,
    onChange: () => () => undefined,
    onPasswordRecovery: () => () => undefined,
  };
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider adapter={adapterFor(true)}>
            <SupportPanel />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

let online = true;
beforeEach(() => {
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  indexedDB = new IDBFactory();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A fetch stub: GET /support-reports → list; POST → created; configurable POST failure. */
function stubFetch(options: { failPost?: boolean } = {}) {
  const posted: unknown[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const headers = new Headers(init?.headers);
    // Every call must carry the bearer token and the correlation headers.
    expect(headers.get('Authorization')).toBe('Bearer synthetic-token');
    expect(headers.get('X-GradTools-Platform')).toBe('web');
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posted.push(body);
      if (options.failPost) return new Response('nope', { status: 503 });
      return new Response(
        JSON.stringify({
          incidentId: 'GT-ERR-AAA111',
          supportId: SUPPORT_ID,
          category: body.category,
          status: 'open',
          createdAt: new Date().toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (href.includes('/support-reports')) {
      return new Response(JSON.stringify({ supportId: SUPPORT_ID, reports: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { posted, fetchMock };
}

async function fileReport(category = 'Sync') {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Problem category' }));
  await userEvent.click(await screen.findByRole('option', { name: category }));
  await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
}

describe('reporting a problem', () => {
  it('shows the Support ID and sends a report with safe context only', async () => {
    const { posted } = stubFetch();
    renderPanel();
    expect(await screen.findByText(SUPPORT_ID)).toBeTruthy();

    await fileReport('Sync');
    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0] as { category: string; context: Record<string, unknown> };
    expect(body.category).toBe('sync');
    expect(body.context.platform).toBe('web');
    // No sensitive keys ever appear in the payload.
    const blob = JSON.stringify(body);
    for (const forbidden of ['token', 'usn', 'marks', 'password', 'cookie', 'email']) {
      expect(blob).not.toContain(forbidden);
    }
    expect(await screen.findByText(/your report was sent/i)).toBeTruthy();
  });

  it('queues a report while offline and flushes it when back online', async () => {
    const { posted } = stubFetch();
    online = false;
    renderPanel();
    await screen.findByRole('button', { name: 'Send report' });

    await fileReport('Import');
    expect(await screen.findByText(/you're offline/i)).toBeTruthy();
    // Nothing was POSTed, but the minimal payload is on the queue.
    expect(posted).toHaveLength(0);
    await waitFor(async () => {
      const queued = await readValue<unknown[]>('user-support-a', 'supportQueue');
      expect(queued).toHaveLength(1);
    });

    // Reconnect: the queued report is sent once and the queue clears.
    online = true;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(posted).toHaveLength(1));
    await waitFor(async () => {
      const queued = (await readValue<unknown[]>('user-support-a', 'supportQueue')) ?? [];
      expect(queued).toHaveLength(0);
    });
  });

  it('keeps a report that fails to send, for a later retry, without duplicating it', async () => {
    const { posted } = stubFetch({ failPost: true });
    renderPanel();
    await screen.findByRole('button', { name: 'Send report' });

    await fileReport('Sync');
    await waitFor(() => expect(posted).toHaveLength(1)); // one attempt
    expect(await screen.findByText(/you're offline|will be sent/i)).toBeTruthy();
    const queued = (await readValue<unknown[]>('user-support-a', 'supportQueue')) ?? [];
    expect(queued).toHaveLength(1); // retained, exactly once — no report→fail→report loop
  });
});
