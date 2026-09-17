/** "18m ago", "2h ago", "3d ago" — the design's compact relative time. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (iso === null || iso === undefined) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${String(days)}d ago`;
  if (days < 60) return `${String(Math.round(days / 7))}w ago`;
  return new Date(then).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
