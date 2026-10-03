/**
 * What was recorded, by date and by subject.
 *
 * This is the question the old model could not answer at all: two counters
 * cannot say whether you were in Programming on the 16th. Everything here is
 * read from the ledger, so a class still appears after its slot has been
 * edited, deleted or re-imported — the row carries its own date, time and
 * subject precisely so that history does not depend on the timetable still
 * agreeing with it.
 */

import { History } from 'lucide-react';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { EmptyState } from '../../components/ui/feedback.js';
import { Row } from '../../components/ui/page.js';
import { statusOf } from '../../domain/attendance.js';
import type { ClassOccurrence, DayOverride, LedgerEntry } from '../../domain/types.js';

const TONE: Record<string, Tone> = {
  attended: 'success',
  missed: 'danger',
  cancelled: 'neutral',
};

/** How many days of history one screen shows before it asks to be paged. */
const DAYS = 14;

export function HistoryView({
  entries,
  overrides,
  titleFor,
}: {
  readonly entries: readonly LedgerEntry[];
  readonly overrides: readonly DayOverride[];
  readonly titleFor: (code: string) => string | null;
}) {
  const occurrences = entries.filter(
    (entry): entry is ClassOccurrence => entry.kind === 'occurrence',
  );

  if (occurrences.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState
          compact
          icon={<History />}
          title="Nothing recorded yet"
          description="Classes you mark on Today are listed here, by date, for as long as you keep them."
        />
      </Card>
    );
  }

  const dates = [...new Set(occurrences.map((entry) => entry.date))]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, DAYS);

  return (
    <div className="flex flex-col gap-4">
      {dates.map((date) => {
        const onDate = occurrences
          .filter((entry) => entry.date === date)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <Card key={date} className="overflow-hidden">
            <CardHeader
              title={new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            />
            <CardRows>
              {onDate.map((entry) => {
                const status = statusOf(overrides, entry.date, entry.classId);
                const counted = status === 'scheduled';
                return (
                  <Row key={entry.id} className="items-center gap-3">
                    <time
                      dateTime={`${entry.date}T${entry.startTime}`}
                      className="w-[5.5rem] shrink-0 font-mono text-[12px] text-ink-3 tabular-nums"
                    >
                      {entry.startTime}–{entry.endTime}
                    </time>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {titleFor(entry.subjectCode) ?? entry.subjectTitle ?? entry.subjectCode}
                    </span>
                    <Badge tone={counted ? (TONE[entry.outcome] ?? 'neutral') : 'neutral'}>
                      {entry.outcome === 'attended' ? 'Attended' : 'Missed'}
                    </Badge>
                    {!counted && (
                      <span className="text-[11px] text-ink-3">
                        {status === 'replaced'
                          ? 'Replaced · not counted'
                          : 'Cancelled · not counted'}
                      </span>
                    )}
                  </Row>
                );
              })}
            </CardRows>
          </Card>
        );
      })}
    </div>
  );
}
