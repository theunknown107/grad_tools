/**
 * Presentation formatting only.
 *
 * NOTHING HERE CALCULATES AN ACADEMIC VALUE. Every number formatted by these
 * helpers was produced by @gradtools/academic-rules (M3 continuation §15-§16).
 */

/** Fixed decimal places, so 8.2 renders as "8.20" beside other GPAs. */
export function formatGpa(value: number): string {
  return value.toFixed(2);
}

/**
 * Percentages render with one decimal place: the regulation's own worked
 * example is "82.0 %" (22OB 6.7), and trailing ".0" signals precision rather
 * than a rounded-off integer.
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}

/** "09:30" -> "9:30 am". Times are stored 24-hour and displayed locally. */
export function formatTime(value: string): string {
  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  const minute = rawMinute ?? '00';
  if (!Number.isFinite(hour)) return value;
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display)}:${minute} ${suffix}`;
}

/**
 * The calendar day a moment falls on WHERE THE STUDENT IS, as 'YYYY-MM-DD'.
 *
 * `toISOString().slice(0, 10)` is the obvious version and is wrong east of
 * Greenwich for part of every day: at 00:30 in Belagavi it returns yesterday,
 * so a holiday check reads the wrong date and today's classes would be marked
 * against yesterday's key. The device's own year, month and day are what a
 * student means by "today" (M10A.11 §13, §19).
 */
export function localDay(when: Date = new Date()): string {
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${String(when.getFullYear())}-${month}-${day}`;
}

/** "2026-07-15" -> "15 Jul 2026". Returns the input where it is not a date. */
export function formatDay(value: string): string {
  const when = new Date(`${value}T00:00:00`);
  if (Number.isNaN(when.getTime())) return value;
  return when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
