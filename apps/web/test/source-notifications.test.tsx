/**
 * The panel that shows what a background run left for a signed-in student.
 *
 * Authority: Phase 7B.3.1 §24, §26, §27, §50, §51, §118
 *
 * WHAT THIS CAN AND CANNOT PROVE. The rows themselves are created server-side
 * and their isolation is a database guarantee, proven in
 * `services/api/test/monitor-fanout.test.ts` and `monitor-inbox.test.ts`
 * against real PostgreSQL. This asserts the browser half: that a student who IS
 * signed in sees them, that one who is NOT sees nothing at all, and that what
 * is rendered is the source's own link and the reason they were told.
 *
 * SYNTHETIC CONTENT ONLY.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSourceNotifications } from '../src/hooks/useSourceNotifications.js';
import { AuthContextValueProvider } from './helpers/auth-harness.js';

const NOTICE = {
  id: '11111111-1111-4111-8111-111111111111',
  family: 'examination',
  category: 'exam_timetable',
  importance: 'high' as const,
  title: 'Revised Time Table for the V Semester Examination',
  sourceUrl: 'https://vtu.ac.in/en/examination/synthetic/',
  publishedAt: '2026-09-09',
  reason: 'Applies to your scheme · programme · semester.',
  state: 'unread' as const,
  createdAt: '2026-09-09T10:00:00.000Z',
};

function wrapper(signedIn: boolean) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <AuthContextValueProvider signedIn={signedIn}>{children}</AuthContextValueProvider>;
  };
}

describe('notices waiting from VTU', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH' || init?.method === 'POST') {
          return new Response(JSON.stringify({ marked: 1 }), { status: 200 });
        }
        if (String(url).includes('/me/notifications')) {
          return new Response(JSON.stringify({ notifications: [NOTICE], unread: 1 }), {
            status: 200,
          });
        }
        return new Response('{}', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /*
   * §24, the behaviour the whole phase exists for: the run happened while
   * nobody was here, and the notice is simply present when they arrive.
   */
  it('shows a signed-in student what was waiting', async () => {
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.unread).toBe(1);
    expect(result.current.items[0]?.title).toContain('Revised Time Table');
  });

  /*
   * A student without an account is not missing a broken feature — they are
   * using the product as designed. No request is made at all.
   */
  it('asks for nothing when there is no account', async () => {
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(false) });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.unavailable).toBe(true);
    expect(result.current.items).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  /* §25, §82. Read state belongs to the server for these rows. */
  it('marks one read, and the count follows', async () => {
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });

    await act(async () => {
      await result.current.markRead(NOTICE.id);
    });
    expect(result.current.items[0]?.state).toBe('read');
    expect(result.current.unread).toBe(0);
  });

  /* §83. */
  it('marks everything read at once', async () => {
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });

    await act(async () => {
      await result.current.markAllRead();
    });
    expect(result.current.unread).toBe(0);
  });

  /*
   * §63. A panel that cannot be reached must not claim there is nothing
   * waiting — those are different statements and only one of them is true.
   */
  it('says it could not reach them rather than showing an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.items).toHaveLength(0);
  });

  /* §26, §52. The official document, and no copy of it. */
  it('carries the source’s own URL', async () => {
    const { result } = renderHook(() => useSourceNotifications(), { wrapper: wrapper(true) });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0]?.sourceUrl).toBe('https://vtu.ac.in/en/examination/synthetic/');
  });
});

/* -------------------------------------------------------------------------- */
/* The rendered panel                                                         */
/* -------------------------------------------------------------------------- */

describe('the panel itself', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ notifications: [NOTICE], unread: 1 }), { status: 200 }),
      ),
    );
  });

  /*
   * EXPLICIT CLEANUP. This project does not enable Testing Library's automatic
   * unmount, so a second `render` in the same file leaves the first one in the
   * document — and a query for "the Mark read button" then finds the previous
   * test's. It cost a debugging session; the render was correct all along.
   */
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the title, the reason and a link to the official source', async () => {
    const { FromVtuPanelForTest } = await import('./helpers/from-vtu-harness.js');
    render(<FromVtuPanelForTest signedIn />);

    expect(await screen.findByText(/Revised Time Table/)).toBeTruthy();
    expect(screen.getByText(/Applies to your scheme/)).toBeTruthy();

    const link = screen.getByRole('link', { name: /official source/i });
    expect(link.getAttribute('href')).toBe(NOTICE.sourceUrl);
    /* The destination is not ours, so the tab it opens must not reach back. */
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders nothing whatsoever when signed out', async () => {
    const { FromVtuPanelForTest } = await import('./helpers/from-vtu-harness.js');
    const { container } = render(<FromVtuPanelForTest signedIn={false} />);
    await waitFor(() => {
      expect(container.innerHTML).toBe('');
    });
  });

  it('lets the student mark it read', async () => {
    const { FromVtuPanelForTest } = await import('./helpers/from-vtu-harness.js');
    render(<FromVtuPanelForTest signedIn />);

    const button = await screen.findByRole('button', { name: /^mark read$/i });
    await userEvent.click(button);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^mark read$/i })).toBeNull();
    });
  });
});
