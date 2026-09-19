import { CalendarRange } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardRows } from '../../components/ui/card.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { Field, Select } from '../../components/ui/field.js';
import { Row } from '../../components/ui/page.js';
import {
  relateCalendar,
  type CalendarCategory,
  type ParsedCalendar,
  type SavedCalendar,
} from '../../domain/calendar-import.js';
import { newId, nowIso } from '../../lib/id.js';
import { Recorded, ReviewCard, SaveFooter, saveFailure, type SaveState } from './ReviewCard.js';

const CATEGORY_LABEL: Record<CalendarCategory, string> = {
  SEMESTER_START: 'Semester begins',
  REGISTRATION: 'Registration',
  LAST_WORKING_DAY: 'Last working day',
  EXAM_PERIOD: 'Examinations',
  ACADEMIC_PERIOD: 'Teaching',
  HOLIDAY: 'Holiday',
  OTHER_ACADEMIC: 'Academic date',
};

export const SEMESTER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8].map((value) => ({
  value: String(value),
  label: `Semester ${String(value)}`,
}));

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function CalendarReview({
  fileName,
  parsed,
  fingerprint,
  sourceKind,
  saved,
  onSave,
}: {
  readonly fileName: string;
  readonly parsed: ParsedCalendar;
  readonly fingerprint: string;
  readonly sourceKind: 'text' | 'ocr';
  readonly saved: readonly SavedCalendar[];
  readonly onSave: (calendar: SavedCalendar) => void | Promise<void>;
}) {
  const [semester, setSemester] = useState(parsed.semester === null ? '' : String(parsed.semester));
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const chosen = semester === '' ? null : Number(semester);
  const relation = relateCalendar(
    { fingerprint, semester: chosen, academicYear: parsed.academicYear, events: parsed.events },
    saved,
  );
  const ready = relation.kind !== 'duplicate' && parsed.events.length > 0 && chosen !== null;

  const confirm = async (): Promise<void> => {
    if (state === 'saving' || state === 'saved') return;
    setState('saving');
    setError(null);
    try {
      await onSave({
        id: newId(),
        semester: chosen,
        academicYear: parsed.academicYear,
        events: parsed.events,
        fingerprint,
        importedAt: nowIso(),
        sourceKind,
      });
      setState('saved');
      toast('Data confirmed and recorded.', {
        description: `${String(parsed.events.length)} dates are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      setState('failed');
      setError(saveFailure(cause, 'Your calendar'));
    }
  };

  if (state === 'saved') {
    return (
      <Recorded
        label="Calendar recorded"
        figures={[{ label: 'dates', value: parsed.events.length }]}
      >
        {parsed.events.length} dates are saved on this device. Your dashboard already shows what is
        next.
      </Recorded>
    );
  }

  return (
    <ReviewCard
      label="Academic calendar review"
      title={
        parsed.academicYear === null
          ? 'Academic calendar'
          : `Academic calendar ${parsed.academicYear}`
      }
      meta={`Parsed as an academic calendar · ${String(parsed.events.length)} dates · ${fileName}`}
      badges={
        <Badge tone="schedule" icon={<CalendarRange />}>
          Calendar
        </Badge>
      }
    >
      {relation.kind === 'duplicate' && (
        <Callout>You have already imported this calendar. Nothing needs saving again.</Callout>
      )}
      {relation.kind === 'revision' && (
        <Callout tone="warning">
          You already have a calendar for this term. Saving this one keeps both — check which dates
          changed before you do.
          {relation.differences.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {relation.differences.map((difference) => (
                <li key={difference}>{difference}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {parsed.warnings.map((warning) => (
        <Callout key={warning} tone="warning">
          {warning}
        </Callout>
      ))}
      {parsed.semester === null && parsed.events.length > 0 && (
        <Card className="p-5">
          <Field
            label="Semester"
            hint="This calendar did not print one, so it cannot be guessed."
            className="max-w-xs"
          >
            <Select
              value={semester}
              onValueChange={setSemester}
              placeholder="Choose…"
              options={SEMESTER_OPTIONS}
            />
          </Field>
        </Card>
      )}
      <Card className="overflow-hidden">
        <CardRows
          tabIndex={0}
          role="region"
          aria-label="Dates read from the calendar"
          className="max-h-[420px] overflow-y-auto scroll-quiet focus-visible:outline-offset-[-2px]"
        >
          {parsed.events.map((event) => (
            <Row key={event.id} className="items-start">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{event.title}</span>
                <span className="mt-0.5 block text-[12px] text-ink-2">
                  {CATEGORY_LABEL[event.category]} ·{' '}
                  {event.endDate === null
                    ? formatDate(event.startDate)
                    : `${formatDate(event.startDate)} – ${formatDate(event.endDate)}`}
                </span>
                <span className="mt-1 block truncate font-mono text-[11px] text-ink-3">
                  Read from: {event.sourceLine}
                </span>
              </span>
            </Row>
          ))}
        </CardRows>
      </Card>
      <SaveFooter
        error={error}
        saving={state === 'saving'}
        disabled={!ready}
        onConfirm={() => void confirm()}
        confirmLabel="Confirm and save calendar"
      />
    </ReviewCard>
  );
}
