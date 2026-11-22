import { CalendarDays, Clock, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Select } from '../../components/ui/field.js';
import { SectionTitle } from '../../components/ui/page.js';
import { toast } from '../../components/ui/feedback.js';
import { slotKind } from '../../domain/day-schedule.js';
import type { asStudentProfileId } from '../../domain/identity.js';
import {
  applyTimetableCorrections,
  needsBatch,
  relateTimetable,
  slotsForBatch,
  timetableEntry,
  type GridClass,
  type ParsedTimetable,
  type SavedTimetable,
  type SubjectResolution,
} from '../../domain/timetable-import.js';
import { WEEKDAYS, type SlotKind, type TimetableSlot } from '../../domain/types.js';
import { cn } from '../../lib/cn.js';
import { successHaptic, tapHaptic } from '../../lib/haptics.js';
import { newId, nowIso } from '../../lib/id.js';
import { Recorded, ReviewCard, SaveFooter, saveFailure, type SaveState } from './ReviewCard.js';

/** Where each class's subject came from, in the words the review shows. */
const SOURCE: Record<SubjectResolution, string> = {
  declared: 'From the timetable’s subject list',
  initialism: 'Initials match the timetable’s subject list',
  near: 'Needs review — closest match',
  ambiguous: 'Needs review — more than one match',
  activity: 'Activity, as printed',
  unknown: 'Needs review — not identified',
};

/** The 2px edge that says what an hour is — the same fills the week grid uses. */
const KIND_EDGE: Record<SlotKind, string> = {
  course: 'bg-chart-1',
  activity: 'bg-warning',
  break: 'bg-line-strong',
  unscheduled: 'bg-line-strong',
};

const needsReview = (entry: GridClass): boolean =>
  entry.resolution === 'near' || entry.resolution === 'ambiguous' || entry.resolution === 'unknown';

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
  /* label (GridClass.initials) → chosen subject code, '' for "leave unresolved". */
  const [corrections, setCorrections] = useState<Readonly<Record<string, string>>>({});

  // What the student is reviewing and what will be saved are the SAME object:
  // corrections are applied here, so the preview, the slots and the save all
  // read the corrected timetable (persist-exactly-what-was-reviewed).
  const view = useMemo(
    () => applyTimetableCorrections(parsed, corrections),
    [parsed, corrections],
  );

  // The labels the parser could not identify, grouped so one choice resolves
  // every occurrence of that label. Built from the ORIGINAL parse, so a label
  // stays correctable after it has been resolved.
  const toResolve = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; source: string; code: string | null; when: string[] }
    >();
    for (const entry of parsed.classes) {
      if (!needsReview(entry)) continue;
      const group = groups.get(entry.initials);
      if (group === undefined) {
        groups.set(entry.initials, {
          label: entry.initials,
          source: entry.sourceText,
          code: entry.subjectCode,
          when: [`${entry.day} ${entry.start}`],
        });
      } else group.when.push(`${entry.day} ${entry.start}`);
    }
    return [...groups.values()];
  }, [parsed]);

  const courseOptions = useMemo(
    () => [
      { value: 'leave', label: 'Leave unresolved' },
      ...view.dictionary.map((entry) => ({
        value: entry.subjectCode,
        label: `${entry.subjectCode} — ${entry.title}`,
      })),
    ],
    [view.dictionary],
  );

  const relation = relateTimetable(
    {
      fingerprint,
      className: parsed.context.className,
      effectiveFrom: parsed.context.effectiveFrom,
    },
    saved,
  );
  const chosen = batch === '' ? null : batch;
  const slots = slotsForBatch(view, chosen, profileId, newId) as TimetableSlot[];
  const batchNeeded = needsBatch(parsed) && chosen === null;
  const duplicate = relation.kind === 'duplicate';
  const stale = relation.kind === 'revision' && !relation.supersedes;
  const ready = !duplicate && !batchNeeded && slots.length > 0;

  const confirm = async (): Promise<void> => {
    if (state === 'saving' || state === 'saved') return;
    tapHaptic();
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
      successHaptic();
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
      {!view.coverage.looksComplete && view.coverage.cellsFound > 0 && (
        <Callout tone="warning" title="Partial timetable.">
          {view.coverage.cellsResolved} of {view.coverage.cellsFound} classes could be identified,
          across {view.coverage.slotsFound} of its time columns. Resolve the ones below, save what
          was read and add the rest by hand, or enter the whole timetable manually.
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
      {toResolve.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Resolve these classes before saving</SectionTitle>
          <p className="mt-1 mb-4 text-[13px] text-ink-2">
            These labels could not be matched to a course. Pick the subject each one means — only
            from this timetable’s own subject list, never a guess. One choice resolves every class
            printed under that label; leave one unresolved to save it as it was read.
          </p>
          <div className="flex flex-col divide-y divide-line">
            {toResolve.map((group) => {
              const current = corrections[group.label];
              const value =
                current !== undefined
                  ? current === ''
                    ? 'leave'
                    : current
                  : (group.code ?? 'leave');
              return (
                <div
                  key={group.label}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{group.label}</div>
                    <div className="truncate text-[12px] text-ink-3">
                      printed “{group.source}” · {group.when.join(', ')}
                    </div>
                  </div>
                  <Field label={`Course for ${group.label}`} className="sm:w-80">
                    <Select
                      value={value}
                      onValueChange={(next) => {
                        tapHaptic();
                        setCorrections((prev) => ({
                          ...prev,
                          [group.label]: next === 'leave' ? '' : next,
                        }));
                      }}
                      placeholder="Choose a course…"
                      options={courseOptions}
                    />
                  </Field>
                </div>
              );
            })}
          </div>
        </Card>
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
              onValueChange={(value) => {
                tapHaptic();
                setBatch(value);
              }}
              placeholder="Choose…"
              options={parsed.batches.map((value) => ({ value, label: value }))}
            />
          </Field>
        </Card>
      )}
      {slots.length > 0 && (
        <Card className="flex flex-wrap gap-x-7 gap-y-3 p-4" style={{ animation: 'gt-fade 0.3s ease both' }}>
          <Stat label="Classes" value={String(slots.length)} />
          <Stat label="Days" value={String(byDay.length)} />
          {parsed.context.semester !== null && (
            <Stat label="Semester" value={String(parsed.context.semester)} />
          )}
          {parsed.context.effectiveFrom !== null && (
            <Stat label="In effect from" value={parsed.context.effectiveFrom} />
          )}
        </Card>
      )}
      {byDay.length > 0 && (
        <div className="flex flex-col gap-3">
          {byDay.map((group) => (
            <Card key={group.day} className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b bg-sunken/60 px-4 py-2">
                <span className="text-[13px] font-semibold text-ink">{group.day}</span>
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-3">
                  <Clock className="size-3" aria-hidden />
                  {group.slots.length} {group.slots.length === 1 ? 'class' : 'classes'}
                </span>
              </div>
              <ul className="divide-y">
                {group.slots.map((slot) => {
                  const detail = timetableEntry(slot, slot.subjectTitle ?? null);
                  const meta = [detail.detail, slot.faculty].filter(Boolean).join(' · ');
                  const kind = slotKind(slot);
                  return (
                    <li key={slot.id} className="relative flex items-center gap-3 py-2.5 pr-3 pl-4">
                      <span
                        aria-hidden
                        className={cn(
                          'absolute inset-y-2 left-0 w-[3px] rounded-full',
                          KIND_EDGE[kind],
                        )}
                      />
                      <span className="w-22 shrink-0 font-mono text-[12px] tabular-nums text-ink-3">
                        {slot.startTime}–{slot.endTime}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {detail.name === '' ? '—' : detail.name}
                        </span>
                        {meta !== '' && (
                          <span className="block truncate text-[12px] text-ink-3">{meta}</span>
                        )}
                      </span>
                      {slot.room !== null && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ink-3">
                          <MapPin className="size-3" aria-hidden />
                          {slot.room}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {view.classes.length > 0 && (
        <details className="rounded-lg border border-line bg-panel px-4 py-3 text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">
            How each class was read ({view.classes.length})
          </summary>
          <ul className="mt-3 divide-y divide-line">
            {view.classes.map((entry) => (
              <li
                key={`${entry.day}-${entry.start}-${entry.batch ?? ''}-${entry.sourceText}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
              >
                <span className="w-24 shrink-0 font-mono text-[12px] text-ink-3">
                  {entry.day} {entry.start}
                </span>
                <span className="min-w-0 flex-1 text-ink">
                  “{entry.sourceText}”
                  {entry.subjectCode !== null && (
                    <span className="text-ink-2"> → {entry.subjectCode}</span>
                  )}
                  {entry.batch !== null && (
                    <span className="text-ink-2"> · batch {entry.batch}</span>
                  )}
                  {entry.room !== null && <span className="text-ink-2"> · room {entry.room}</span>}
                </span>
                <Badge tone={needsReview(entry) ? 'warning' : 'neutral'}>
                  {SOURCE[entry.resolution]}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
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

/** One figure in the summary strip: a quiet label over the value it counts. */
function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[12px] font-medium text-ink-3">{label}</span>
      <span className="text-[15px] font-semibold text-ink tabular-nums">{value}</span>
    </span>
  );
}
