/**
 * The doorbell, in the browser.
 *
 * Authority: Phase 7B.5 §17, §20, §22, §24, §25, §26, §65–§68, §74, §75
 *
 * SEPARATE FROM `source-notifications.test.tsx` because it asserts a different
 * thing: that file covers the inbox — what a student sees when they open the
 * app — and this one covers what happens while they are already looking at it.
 *
 * SYNTHETIC CONTENT ONLY.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useSourceNotifications } from '../src/hooks/useSourceNotifications.js';
import { AuthContextValueProvider } from './helpers/auth-harness.js';

function wrapper(signedIn: boolean) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <AuthContextValueProvider signedIn={signedIn}>{children}</AuthContextValueProvider>;
  };
}

const WAITING = {
  id: '33333333-3333-4333-8333-333333333333',
  family: 'examination',
  category: 'exam_timetable',
  importance: 'high' as const,
  title: 'Something that arrived while the tab was closed',
  sourceUrl: 'https://vtu.ac.in/en/examination/synthetic/',
  publishedAt: null,
  reason: 'Applies to your programme.',
  state: 'unread' as const,
  createdAt: '2026-09-09T10:00:00.000Z',
};

/** One SSE frame, exactly as the route writes it. */
function frame(id: string): string {
  const data = JSON.stringify({
    type: 'notification.created',
    notificationId: id,
    category: 'exam_timetable',
    importance: 'high',
    title: 'Revised Time Table for the V Semester Examination',
    sourceUrl: 'https://vtu.ac.in/en/examination/synthetic/',
    reason: 'Applies to your scheme · programme · semester.',
  });
  return ['event: notification.created', `data: ${data}`, '', ''].join('\n');
}

/**
 * A stream that stays open, as a real one does.
 *
 * Closing it would make the hook reconnect, which is correct behaviour and
 * would make these tests measure the backoff instead of the delivery.
 */
function openStream(frames: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of frames) controller.enqueue(encoder.encode(chunk));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function serve(frames: readonly string[], inbox: unknown[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/stream')) return openStream(frames);
      return new Response(JSON.stringify({ notifications: inbox, unread: inbox.length }), {
        status: 200,
      });
    }),
  );
}

function fetchCalls(): unknown[][] {
  return (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('a notification arriving while the page is open', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /* §24, §65, §75. It appears without a refresh, and the count follows. */
  it('appears without a refresh', async () => {
    serve([frame('11111111-1111-4111-8111-111111111111')]);
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.unread).toBe(1);
    expect(result.current.items[0]?.state).toBe('unread');
    expect(result.current.items[0]?.title).toContain('Revised Time Table');
  });

  /*
   * §68, §166. A duplicate delivery must not become a duplicate row. The id is
   * the database's, so the same notification twice is recognisably the same.
   */
  it('ignores the same event delivered twice', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    serve([frame(id), frame(id)]);
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    /* Long enough for the second frame to be wrong, if it were going to be. */
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.unread).toBe(1);
  });

  /*
   * §22, §26, §74. The stream replays nothing, so whatever was missed comes
   * from the authoritative list — read when the stream comes up, not from the
   * socket.
   */
  it('reads the authoritative list when the stream opens', async () => {
    serve([], [WAITING]);
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0]?.id).toBe(WAITING.id);

    const listReads = fetchCalls().filter((call) => !String(call[0]).endsWith('/stream'));
    /* Once on mount, and again when the stream came up. */
    expect(listReads.length).toBeGreaterThanOrEqual(2);
  });

  /*
   * §17, §20, §71. THE REASON THIS IS NOT `EventSource`. A token in the query
   * string lands in access logs, proxy logs and browser history; a header does
   * not. There must also be no user id in the URL for anyone to change.
   */
  it('authenticates with a header and puts no identity in the URL', async () => {
    serve([]);
    renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });

    await waitFor(() => {
      expect(fetchCalls().some((call) => String(call[0]).endsWith('/stream'))).toBe(true);
    });

    const call = fetchCalls().find((entry) => String(entry[0]).endsWith('/stream'));
    expect(String(call?.[0])).not.toMatch(/[?&]/);
    const headers = (call?.[1] as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.Authorization).toBe('Bearer synthetic-token');
  });

  /*
   * §25, §67, §108. The doorbell is broken and the notifications are not. The
   * student is shown their inbox and no error, because nothing of theirs failed.
   */
  it('shows the inbox anyway when the stream cannot be opened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/stream')) return new Response('no', { status: 503 });
        return new Response(JSON.stringify({ notifications: [WAITING], unread: 1 }), {
          status: 200,
        });
      }),
    );
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('opens no stream at all without an account', async () => {
    serve([]);
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(false) });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  /* §28, §151. Unmounting must abort the request, not leave it reading. */
  it('closes the stream when the page goes away', async () => {
    serve([]);
    const { unmount } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });

    await waitFor(() => {
      expect(fetchCalls().some((call) => String(call[0]).endsWith('/stream'))).toBe(true);
    });
    const call = fetchCalls().find((entry) => String(entry[0]).endsWith('/stream'));
    const signal = (call?.[1] as { signal?: AbortSignal } | undefined)?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
