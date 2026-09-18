/**
 * The current minute, and the date it falls in.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCREEN MAY NOT CAPTURE "TODAY" AT RENDER
 * ---------------------------------------------------------------------------
 *
 * `TimetablePage` read `localDay()` once, when it rendered. A student who left
 * the app open across midnight — which is exactly when a timetable app is open,
 * because the day's classes are the reason to look at it — went on seeing
 * yesterday, and a mark they made after midnight was WRITTEN AGAINST
 * YESTERDAY'S DATE. The bug is silent: the tick that was ticked is not the
 * class that was ticked.
 *
 * So the date comes from the clock rather than from the render, and the clock
 * is shared. The tick is aligned to the minute boundary (not `setInterval`,
 * which drifts), and re-read whenever the tab comes back — a laptop that was
 * asleep for six hours fires no timers while it sleeps.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/** 'YYYY-MM-DD' in the device's own timezone, which is the student's day. */
export function localDay(at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 'HH:MM', 24-hour, to compare against a timetable's own times. */
export function localTime(at: Date = new Date()): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export interface Now {
  readonly at: Date;
  /** 'YYYY-MM-DD' — derived from the clock, never captured at mount. */
  readonly today: string;
  /** 'HH:MM' — what a class list compares itself against. */
  readonly time: string;
}

/**
 * One clock for the whole app.
 *
 * Every consumer shares the same tick and the same `Date`, so two panels on one
 * screen cannot disagree about the time by half a minute, and ten mounted
 * components schedule one timer rather than ten.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function read(): Now {
  const at = new Date();
  return { at, today: localDay(at), time: localTime(at) };
}

/*
 * Read LAZILY, on first use, rather than when this module is imported.
 *
 * An import happens before anything has had a chance to control the clock, so a
 * snapshot taken here would be the wrong day under a test that fakes the date —
 * and, more importantly, would be taken before the app is on screen at all.
 */
let snapshot: Now | null = null;

function current(): Now {
  snapshot ??= read();
  return snapshot;
}

function publish(): void {
  const next = read();
  /* A new object only when the minute actually moved, so renders stay rare. */
  if (snapshot !== null && next.today === snapshot.today && next.time === snapshot.time) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  const at = new Date();
  /* Aligned to the next minute boundary: an interval drifts, and a clock that
     drifts shows 09:59 for two minutes and then 10:01. */
  const delay = 60_000 - (at.getSeconds() * 1000 + at.getMilliseconds());
  timer = setTimeout(() => {
    publish();
    schedule();
  }, delay);
}

function start(): void {
  if (timer === null) schedule();
}

function stop(): void {
  if (listeners.size > 0 || timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function onVisible(): void {
  /*
   * Timers do not fire in a sleeping tab, so the clock is stale the moment it
   * wakes — and "stale" here can mean a different day.
   */
  if (document.visibilityState === 'visible') {
    publish();
    schedule();
  }
}

export function useNow(): Now {
  const subscribe = useCallback((onChange: () => void) => {
    /* The first mount re-reads: the clock may have moved on since the last one. */
    if (listeners.size === 0) snapshot = read();
    listeners.add(onChange);
    start();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      listeners.delete(onChange);
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, []);

  return useSyncExternalStore(subscribe, current, current);
}

/** Where one class stands against the clock. Drives Today's three groups. */
export type ClassTiming = 'past' | 'now' | 'upcoming';

export function timingOf(
  slot: { readonly startTime: string; readonly endTime: string },
  time: string,
): ClassTiming {
  if (time >= slot.endTime) return 'past';
  return time >= slot.startTime ? 'now' : 'upcoming';
}

/** The same date formatted the way the design's headers print it. */
export function useTodayLabel(): { readonly date: string; readonly clock: string } {
  const now = useNow();
  return useMemo(
    () => ({
      date: now.at.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
      clock: now.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }),
    [now],
  );
}

/**
 * A ref that always holds the current value, for callbacks that must not close
 * over a stale one.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
