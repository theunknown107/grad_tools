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

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A derived figure, as a metric strip reads it.
 *
 * ONE PLACE DECIDES WHAT AN ABSENT FIGURE LOOKS LIKE. Screens used to write
 * `value === null ? '—' : format(value)` inline, and an em dash cannot
 * distinguish "you have not entered this" from "one of your courses needs
 * review" — the two absences a student would act on differently (Phase 7C §1).
 *
 * So an unresolved metric reads "Unavailable" and carries its own reason into
 * the note beneath, and a PARTIAL one shows the figure it does have with the
 * caveat attached rather than hiding it (§4).
 */
export function metricDisplay(
  metric: {
    readonly value: number | null;
    readonly status: string;
    readonly reason: string | null;
  },
  format: (value: number) => string = String,
): { readonly value: string; readonly note: string | undefined } {
  if (metric.value === null) {
    return { value: 'Unavailable', note: metric.reason ?? undefined };
  }
  return {
    value: format(metric.value),
    note: metric.status === 'resolved' ? undefined : (metric.reason ?? undefined),
  };
}

/**
 * A derived figure as one entry in a metric strip.
 *
 * The same shape three screens were each about to build inline. A strip entry
 * omits `note` rather than passing undefined, because the component checks for
 * the key's presence — hence the spread rather than a plain field.
 */
export function metricStripEntry(
  label: string,
  metric: {
    readonly value: number | null;
    readonly status: string;
    readonly reason: string | null;
  },
  format: (value: number) => string = String,
): { label: string; value: string; note?: string } {
  const display = metricDisplay(metric, format);
  return {
    label,
    value: display.value,
    ...(display.note === undefined ? {} : { note: display.note }),
  };
}
