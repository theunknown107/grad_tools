import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardRows } from '../../components/ui/card.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { Row, RowText } from '../../components/ui/page.js';
import {
  relateExamTimetable,
  type ParsedExamTimetable,
  type SavedExamTimetable,
  type StoredExamEvent,
} from '../../domain/exam-import.js';
import { newId, nowIso } from '../../lib/id.js';
import { Recorded, ReviewCard, SaveFooter, saveFailure, type SaveState } from './ReviewCard.js';

const VISIBLE_DATES = 8;

export function ExamReview({
  fileName,
  parsed,
  fingerprint,
  profileId,
  saved,
  onSave,
}: {
  readonly fileName: string;
  readonly parsed: ParsedExamTimetable;
  readonly fingerprint: string;
  readonly profileId: string;
  readonly saved: readonly SavedExamTimetable[];
  readonly onSave: (
    document: SavedExamTimetable,
    events: readonly StoredExamEvent[],
  ) => Promise<void>;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const relation = relateExamTimetable(
    {
      fingerprint,
      examCycle: parsed.context.examCycle,
      publicationState: parsed.context.publicationState,
    },
    saved,
  );
  const duplicate = relation.kind === 'duplicate';
  const stale = relation.kind === 'revision' && !relation.supersedes;
  const ready = !duplicate && parsed.events.length > 0;

  const confirm = async (): Promise<void> => {
    if (state === 'saving' || state === 'saved') return;
    setState('saving');
    setError(null);
    const documentId = newId();
    try {
      await onSave(
        {
          id: documentId,
          profileId,
          examCycle: parsed.context.examCycle,
          publicationState: parsed.context.publicationState,
          notification: parsed.context.notification,
          fingerprint,
          fileName,
          importedAt: nowIso(),
          eventCount: parsed.events.length,
        },
        parsed.events.map((event) => ({
          ...event,
          id: newId(),
          profileId,
          timetableId: documentId,
        })),
      );
      setState('saved');
      toast('Data confirmed and recorded.', {
        description: `${String(parsed.events.length)} exams are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      setState('failed');
      setError(saveFailure(cause, 'The exams'));
    }
  };

  if (state === 'saved') {
    return (
      <Recorded
        label="Exam timetable recorded"
        figures={[{ label: 'exams', value: parsed.events.length }]}
        actions={
          <Button asChild variant="primary">
            <Link to="/exams">View exam timetable</Link>
          </Button>
        }
      >
        {parsed.events.length} exams are saved on this device.
      </Recorded>
    );
  }

  const byDate = new Map<string, typeof parsed.events>();
  for (const event of parsed.events)
    byDate.set(event.examDate, [...(byDate.get(event.examDate) ?? []), event]);
  const dates = [...byDate.entries()];

  return (
    <ReviewCard
      label="Examination timetable review"
      title="Examination time table"
      meta={`Parsed as an exam timetable · ${String(parsed.events.length)} exams · ${fileName}`}
      badges={
        <>
          <Badge tone="warning" icon={<CalendarClock />}>
            Exams
          </Badge>
          {parsed.context.examCycle !== null && <Badge>{parsed.context.examCycle}</Badge>}
          {parsed.context.publicationState !== null && (
            <Badge tone={parsed.context.publicationState === 'draft' ? 'warning' : 'neutral'}>
              {parsed.context.publicationState}
            </Badge>
          )}
          {parsed.context.schemes.map((scheme) => (
            <Badge key={scheme}>{`${scheme} scheme`}</Badge>
          ))}
        </>
      }
    >
      {parsed.warnings.map((warning) => (
        <Callout key={warning} tone="warning">
          {warning}
        </Callout>
      ))}
      {duplicate && (
        <Callout>
          This is the same document you added on {relation.existing.importedAt.slice(0, 10)}.
          Nothing to record.
        </Callout>
      )}
      {stale && (
        <Callout tone="warning">
          You already hold a {relation.existing.publicationState ?? 'later'} time table for this
          cycle. This one can still be saved — it simply is not the newer publication.
        </Callout>
      )}
      {dates.length > 0 && (
        <Card className="overflow-hidden">
          <CardRows>
            {dates.slice(0, VISIBLE_DATES).map(([date, events]) => (
              <Row key={date}>
                <span className="w-24 shrink-0 font-mono text-[11px] text-ink-3">{date}</span>
                <RowText
                  title={events.map((event) => event.printed).join(' · ')}
                  meta={
                    events[0]?.session ??
                    (events[0]?.semester === null || events[0]?.semester === undefined
                      ? undefined
                      : `Semester ${String(events[0].semester)}`)
                  }
                />
                <Badge>
                  {events.length} {events.length === 1 ? 'paper' : 'papers'}
                </Badge>
              </Row>
            ))}
          </CardRows>
          {dates.length > VISIBLE_DATES && (
            <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
              and {dates.length - VISIBLE_DATES} more{' '}
              {dates.length - VISIBLE_DATES === 1 ? 'date' : 'dates'}
            </p>
          )}
        </Card>
      )}
      <SaveFooter
        error={error}
        saving={state === 'saving'}
        disabled={!ready}
        onConfirm={() => void confirm()}
        confirmLabel={`Confirm ${String(parsed.events.length)} ${parsed.events.length === 1 ? 'exam' : 'exams'}`}
      />
    </ReviewCard>
  );
}
