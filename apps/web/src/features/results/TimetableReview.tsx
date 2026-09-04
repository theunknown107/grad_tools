/**
 * A class timetable that was read, shown before it becomes the student's week.
 *
 * Authority: docs/08 §8.22 · M10A.8 §28–§31
 *
 * ---------------------------------------------------------------------------
 * ONLY THE AMBIGUOUS PARTS NEED ANSWERING
 * ---------------------------------------------------------------------------
 *
 * A student importing a timetable wants their week, not a form. So this asks
 * exactly the questions the document left open and nothing else:
 *
 *   WHICH BATCH — because a cell reading `PHYE1/POPE2` is two different
 *   classes and no one but the student knows which half they are in (§23).
 *
 *   WHAT TO DO ABOUT A REVISION — because a timetable that supersedes the
 *   active one replaces a student's week, and a stale upload must not (§13).
 *
 * Everything the document was clear about is shown and confirmed in one press.
 *
 * ---------------------------------------------------------------------------
 * SAVING REPLACES, IT DOES NOT MERGE
 * ---------------------------------------------------------------------------
 *
 * There is ONE active timetable (§31). Merging a revision into the classes
 * already stored would leave a week that is partly last month's — the failure
 * mode where a student turns up to a class that moved.
 */

import { useState } from 'react';
import {
  needsBatch,
  relateTimetable,
  slotsForBatch,
  type ParsedTimetable,
  type SavedTimetable,
} from '../../domain/timetable-import.js';
import type { TimetableSlot } from '../../domain/types.js';
import type { asStudentProfileId } from '../../domain/identity.js';
import { Button, Notice, SelectField, StatusPill } from '../../components/ui/index.js';
import { newId, nowIso } from '../../lib/id.js';
import styles from './results.module.css';

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

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
  readonly onSave: (slots: readonly TimetableSlot[], record: SavedTimetable) => void;
}) {
  const [batch, setBatch] = useState('');
  const [done, setDone] = useState(false);

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

  const confirm = () => {
    onSave(slots, {
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
    setDone(true);
  };

  const byDay = DAY_ORDER.map((day) => ({
    day,
    slots: slots.filter((slot) => slot.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime)),
  })).filter((group) => group.slots.length > 0);

  return (
    <section className={styles.importGroup}>
      <div className={styles.semesterHead}>
        <div className={styles.semesterIdentity}>
          <h3 className={styles.semesterTitle}>
            {parsed.context.className ?? 'Class timetable'}
            {parsed.context.revision === null ? '' : ` · ${parsed.context.revision}`}
          </h3>
          <span className={styles.semesterMeta}>
            {slots.length} classes · from {fileName}
            {parsed.context.effectiveFrom === null
              ? ''
              : ` · in effect from ${parsed.context.effectiveFrom}`}
          </span>
        </div>
      </div>

      {duplicate && (
        <div className={styles.editorNotice}>
          <Notice>You have already imported this timetable. Nothing needs saving again.</Notice>
        </div>
      )}

      {relation.kind === 'revision' && !stale && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">
            This replaces the timetable you are using
            {relation.existing.revision === null ? '' : ` (${relation.existing.revision})`}. Saving
            it changes your week from{' '}
            {parsed.context.effectiveFrom ?? 'the date it takes effect'}.
          </Notice>
        </div>
      )}

      {stale && (
        <div className={styles.editorNotice}>
          {/*
            OLDER THAN WHAT IS ALREADY ACTIVE. A student who uploads last term's
            timetable after this term's has not gone back in time, and the most
            recent upload is not automatically the truth (§14, §16).
          */}
          <Notice tone="warning">
            This timetable takes effect before the one you are already using, so it looks like an
            older revision. Saving it would put back classes that have since changed.
          </Notice>
        </div>
      )}

      {!parsed.coverage.looksComplete && parsed.coverage.cellsFound > 0 && (
        <div className={styles.editorNotice}>
          {/*
            A PARTLY-READ TIMETABLE MUST NOT LOOK LIKE A WHOLE ONE.
            A photograph can give up a handful of perfectly correct classes and
            lose most of its columns. Six right classes presented as "your week"
            is worse than an honest partial: it looks complete, and a student
            would plan around the ones that are missing (§26).
          */}
          <Notice tone="warning">
            This is only part of the timetable. {parsed.coverage.cellsResolved} of{' '}
            {parsed.coverage.cellsFound} classes could be identified, across{' '}
            {parsed.coverage.slotsFound} of its time columns. Save what was read and add the rest by
            hand, or enter the whole timetable manually.
          </Notice>
        </div>
      )}

      {parsed.warnings.map((warning) => (
        <div className={styles.editorNotice} key={warning}>
          <Notice tone="warning">{warning}</Notice>
        </div>
      ))}

      {parsed.conflicts.length > 0 && (
        <div className={styles.editorNotice}>
          {/* Shown, never resolved: only a person can say which is right (§17). */}
          <Notice tone="warning">
            More than one class is printed at the same time:
            <ul className={styles.differences}>
              {parsed.conflicts.map((conflict) => (
                <li key={`${conflict.day}-${conflict.start}-${conflict.batch ?? ''}`}>
                  {conflict.day} {conflict.start} — {conflict.initials.join(' and ')}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {needsBatch(parsed) && (
        <div className={styles.editorNotice}>
          <SelectField
            label="Your batch"
            hint="Some classes on this timetable are split between batches, so only you can say which of them are yours."
            value={batch}
            onChange={(event) => {
              setBatch(event.target.value);
            }}
          >
            <option value="">Choose…</option>
            {parsed.batches.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </SelectField>
        </div>
      )}

      <ul className={styles.subjectRows}>
        {byDay.map((group) => (
          <li key={group.day} className={styles.editorRow}>
            <div className={styles.editorSubject}>
              <strong>{group.day}</strong>
              <span className={styles.semesterMeta}>
                {group.slots
                  .map((slot) => `${slot.startTime} ${slot.subjectCode}`)
                  .join(' · ')}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className={styles.editorActions}>
        {done ? (
          <StatusPill tone="success">Saved</StatusPill>
        ) : (
          <Button variant="primary" disabled={!ready} onClick={confirm}>
            {relation.kind === 'revision' ? 'Replace my timetable' : 'Confirm and save timetable'}
          </Button>
        )}
      </div>
    </section>
  );
}
