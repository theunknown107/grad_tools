/**
 * Background behaviour: nothing holds a connection or a timer open while the
 * student cannot see the app — a hidden tab, or the Android app paused by
 * Capacitor — and everything catches up when they come back (docs/48).
 *
 * SYNTHETIC CONTENT ONLY.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useSourceNotifications } from '../src/hooks/useSourceNotifications.js';
import { useNow } from '../src/hooks/useNow.js';
import { apiBaseUrl } from '../src/repositories/reference.js';
import { AuthContextValueProvider } from './helpers/auth-harness.js';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function Wrapper({ children }: { readonly children: ReactNode }) {
  return <AuthContextValueProvider signedIn>{children}</AuthContextValueProvider>;
}

/** Every stream request, with the signal that would close it. */
const streams: AbortSignal[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/stream')) {
        streams.push(init?.signal as AbortSignal);
        /* Stays open, as a real stream does. */
        return new Response(new ReadableStream<Uint8Array>(), { status: 200 });
      }
      return new Response(JSON.stringify({ notifications: [], unread: 0 }), { status: 200 });
    }),
  );
}

beforeEach(() => {
  visibility = 'visible';
  streams.length = 0;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  /* Leave no pause behind for the next test. */
  document.dispatchEvent(new Event('resume'));
});

describe('the notification stream', () => {
  it('closes when the tab is hidden and reopens once when it is visible again', async () => {
    serve();
    renderHook(() => useSourceNotifications(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(streams).toHaveLength(1);
    });

    act(() => {
      setVisibility('hidden');
    });
    expect(streams[0]?.aborted).toBe(true);

    act(() => {
      setVisibility('visible');
    });
    await waitFor(() => {
      expect(streams).toHaveLength(2);
    });
    expect(streams[1]?.aborted).toBe(false);
  });

  it('closes on the Android pause event and reopens on resume', async () => {
    serve();
    renderHook(() => useSourceNotifications(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(streams).toHaveLength(1);
    });

    act(() => {
      document.dispatchEvent(new Event('pause'));
    });
    expect(streams[0]?.aborted).toBe(true);
    /* No reconnect loop runs in the background. */
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streams).toHaveLength(1);

    act(() => {
      document.dispatchEvent(new Event('resume'));
    });
    await waitFor(() => {
      expect(streams).toHaveLength(2);
    });
  });
});

describe('the shared clock', () => {
  it('schedules no timer while hidden and re-reads the time on return', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 23, 59, 30));
    const { result } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      setVisibility('hidden');
    });
    expect(vi.getTimerCount()).toBe(0);

    /* The day turns over while nobody is looking. */
    vi.setSystemTime(new Date(2026, 8, 27, 7, 15, 0));
    act(() => {
      setVisibility('visible');
    });
    expect(result.current.today).toBe('2026-09-27');
    expect(result.current.time).toBe('07:15');
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('the API base URL', () => {
  it('uses the configured URL without a trailing slash', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/');
    expect(apiBaseUrl()).toBe('https://api.example.test');
  });

  it('never falls back to localhost in a production build', () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('DEV', false);
    expect(apiBaseUrl()).toBe('');
  });
});
