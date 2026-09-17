import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardRows } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Select } from '../../components/ui/field.js';
import { Row } from '../../components/ui/page.js';
import { toast } from '../../components/ui/feedback.js';
import type { asStudentProfileId } from '../../domain/identity.js';
import {
  needsBatch,
  relateTimetable,
  slotsForBatch,
  timetableEntry,
  type ParsedTimetable,
  type SavedTimetable,
} from '../../domain/timetable-import.js';
import { WEEKDAYS, type TimetableSlot } from '../../domain/types.js';
import { newId, nowIso } from '../../lib/id.js';
import { Recorded, ReviewCard, SaveFooter, saveFailure, type SaveState } from './ReviewCard.js';

export function TimetableReview({
  fileName,
  parsed,
  fingerprint,
  profileId,
  saved,
  onSave,
}: {
  readonly fileName: string;
  readonly parsed: ParsedTimetable;
  readonly fingerprint: string;
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly saved: readonly SavedTimetable[];
  readonly onSave: (
    slots: readonly TimetableSlot[],
    record: SavedTimetable,
  ) => void | Promise<void>;
}) {
  const [batch, setBatch] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const relation = relateTimetable(
    {
      fingerprint,
      className: parsed.context.className,
      effectiveFrom: parsed.context.effectiveFrom,
    },
    saved,
  );
  const chosen = batch === '' ? null : batch;
  const slots = slotsForBatch(parsed, chosen, profileId, newId) as TimetableSlot[];
  const batchNeeded = needsBatch(parsed) && chosen === null;
  const duplicate = relation.kind === 'duplicate';
  const stale = relation.kind === 'revision' && !relation.supersedes;
  const ready = !duplicate && !batchNeeded && slots.length > 0;

  const confirm = async (): Promise<void> => {
    if (state === 'saving' || state === 'saved') return;
    setState('saving');
    setError(null);
    try {
      await onSave(slots, {
        id: newId(),
        className: parsed.context.className,
        semester: parsed.context.semester,
        academicYear: parsed.context.academicYear,
        revision: parsed.context.revision,
        effectiveFrom: parsed.context.effectiveFrom,
        batch: chosen,
        fingerprint,
        importedAt: nowIso(),
        slotCount: slots.length,
      });
      setState('saved');
      toast('Data confirmed and recorded.', {
        description: `${String(slots.length)} classes are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      setState('failed');
      setError(saveFailure(cause, 'Your timetable'));
    }
  };

  if (state === 'saved') {
    return (
      <Recorded
        label="Timetable recorded"
        figures={[{ label: 'classes', value: slots.length }]}
        actions={
          <Button asChild variant="primary">
            <Link to="/timetable">View timetable</Link>
          </Button>
        }
      >
        {slots.length} classes are saved on this device. Your week and today&apos;s classes are
        already up to date.
      </Recorded>
    );
  }

  const byDay = WEEKDAYS.map((day) => ({
    day,
    slots: slots
      .filter((slot) => slot.day === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  })).filter((group) => group.slots.length > 0);

  return (
    <ReviewCard
      label="Class timetable review"
      title={`${parsed.context.className ?? 'Class timetable'}${parsed.context.revision === null ? '' : ` · ${parsed.context.revision}`}`}
      meta={
        <>
          Parsed as a class timetable · {slots.length} classes · {fileName}
          {parsed.context.effectiveFrom === null
            ? ''
            : ` · in effect from ${parsed.context.effectiveFrom}`}
        </>
      }
      badges={
        <Badge tone="schedule" icon={<CalendarDays />}>
          Timetable
        </Badge>
      }
    >
      {duplicate && (
        <Callout>You have already imported this timetable. Nothing needs saving again.</Callout>
      )}
      {relation.kind === 'revision' && !stale && (
        <Callout tone="warning">
          This replaces the timetable you are using
          {relation.existing.revision === null ? '' : ` (${relation.existing.revision})`}. Saving it
          changes your week from {parsed.context.effectiveFrom ?? 'the date it takes effect'}.
        </Callout>
      )}
      {stale && (
        <Callout tone="warning">
          This timetable takes effect before the one you are already using, so it looks like an
          older revision. Saving it would put back classes that have since changed.
        </Callout>
      )}
      {!parsed.coverage.looksComplete && parsed.coverage.cellsFound > 0 && (
        <Callout tone="warning" title="Partial timetable.">
          {parsed.coverage.cellsResolved} of {parsed.coverage.cellsFound} classes could be
          identified, across {parsed.coverage.slotsFound} of its time columns. Save what was read
          and add the rest by hand, or enter the whole timetable manually.
        </Callout>
      )}
      {parsed.warnings.map((warning) => (
        <Callout key={warning} tone="warning">
          {warning}
        </Callout>
      ))}
      {parsed.conflicts.length > 0 && (
        <Callout tone="warning" title="More than one class is printed at the same time:">
          <ul className="mt-1 list-disc pl-5">
            {parsed.conflicts.map((conflict) => (
              <li key={`${conflict.day}-${conflict.start}-${conflict.batch ?? ''}`}>
                {conflict.day} {conflict.start} — {conflict.initials.join(' and ')}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {needsBatch(parsed) && (
        <Card className="p-5">
          <Field
            label="Your batch"
            hint="Some classes on this timetable are split between batches, so only you can say which of them are yours."
            className="max-w-xs"
          >
            <Select
              value={batch}
              onValueChange={setBatch}
              placeholder="Choose…"
              options={parsed.batches.map((value) => ({ value, label: value }))}
            />
          </Field>
        </Card>
      )}
      {byDay.length > 0 && (
        <Card className="overflow-hidden">
          <CardRows>
            {byDay.map((group) => (
              <Row key={group.day} className="items-start">
                <span className="w-10 shrink-0 text-[13px] font-semibold text-ink">
                  {group.day}
                </span>
                <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-2">
                  {group.slots.map((slot) => (
                    <span key={slot.id} className="mr-3 inline-block">
                      <span className="font-mono text-ink-3">{slot.startTime}</span>{' '}
                      {timetableEntry(slot, null).shortName}
                    </span>
                  ))}
                </span>
              </Row>
            ))}
          </CardRows>
        </Card>
      )}
      <SaveFooter
        error={error}
        saving={state === 'saving'}
        disabled={!ready}
        onConfirm={() => void confirm()}
        confirmLabel={
          relation.kind === 'revision' ? 'Replace my timetable' : 'Confirm and save timetable'
        }
      />
    </ReviewCard>
  );
}
