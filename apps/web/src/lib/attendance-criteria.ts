/**
 * The attendance percentage a course must reach, as the student's college
 * enforces it. Default 75% per course.
 *
 * VTU's regulation (22OB, 25OB 10.0) asks 85% per course and lets up to 10
 * points be condoned, so 75% is the line below which a course is barred (DX).
 * Many colleges simply enforce 75%; some keep 85%. The regulation figures stay
 * in @gradtools/academic-rules untouched; this only chooses which line the
 * attendance screens judge against. Kept on this device, like the theme.
 */

import { vtu2022RuleSet, type RuleSet } from '@gradtools/academic-rules';
import { useSyncExternalStore } from 'react';

const KEY = 'gradtools:v1:attendance-criteria';
export const DEFAULT_ATTENDANCE_CRITERIA = 75;
export const ATTENDANCE_CRITERIA_OPTIONS = [60, 65, 70, 75, 80, 85, 90] as const;

const listeners = new Set<() => void>();

export function attendanceCriteria(): number {
  try {
    const stored = Number(window.localStorage.getItem(KEY));
    return (ATTENDANCE_CRITERIA_OPTIONS as readonly number[]).includes(stored)
      ? stored
      : DEFAULT_ATTENDANCE_CRITERIA;
  } catch {
    return DEFAULT_ATTENDANCE_CRITERIA;
  }
}

export function setAttendanceCriteria(percent: number): void {
  try {
    window.localStorage.setItem(KEY, String(percent));
  } catch {
    /* Storage unavailable: the default stays in force. */
  }
  for (const listener of listeners) listener();
}

/** Re-renders the caller when the criteria change. */
export function useAttendanceCriteria(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attendanceCriteria,
    () => DEFAULT_ATTENDANCE_CRITERIA,
  );
}

/**
 * The VTU rules with the requirement set to the college's criteria. The DX
 * floor stays the regulation's, but never above the requirement.
 */
export function attendanceRules(percent = attendanceCriteria()): RuleSet {
  return {
    ...vtu2022RuleSet,
    attendanceRequiredPct: percent,
    attendanceDxFloorPct: Math.min(vtu2022RuleSet.attendanceDxFloorPct, percent),
  };
}
