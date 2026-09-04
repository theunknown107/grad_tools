/**
 * An academic calendar that was read, shown before it is kept.
 *
 * Authority: docs/08 §8.21 · M10A.7 §25, §28–§31
 *
 * ---------------------------------------------------------------------------
 * REVIEW IS SHORT HERE, ON PURPOSE
 * ---------------------------------------------------------------------------
 *
 * A result card is nine rows of marks and every one of them changes an SGPA, so
 * the student checks each. A calendar is a handful of dates that change nothing
 * they have to defend — the cost of a wrong one is a reminder on the wrong day,
 * not a degree classification they cannot explain.
 *
 * So this screen shows what was read and asks once. What it does NOT do is
 * decide anything the document left open: a missing semester is asked for, and
 * a calendar that disagrees with one already saved is shown side by side rather
 * than resolved (§28, §29).
 *
 * Dates are rendered as text. The document is untrusted input, and it reaches
 * the page as strings and nothing else.
 */

import { useState } from 'react';
import {
  relateCalendar,
  type CalendarCategory,
  type ParsedCalendar,
  type SavedCalendar,
} from '../../domain/calendar-import.js';
import { Button, Notice, SelectField, StatusPill } from '../../components/ui/index.js';
import { newId, nowIso } from '../../lib/id.js';
import styles from './results.module.css';

/** What each category is called on screen. Never the enum name (§31). */
const CATEGORY_LABEL: Record<CalendarCategory, string> = {
  SEMESTER_START: 'Semester begins',
  REGISTRATION: 'Registration',
  LAST_WORKING_DAY: 'Last working day',
  EXAM_PERIOD: 'Examinations',
  ACADEMIC_PERIOD: 'Teaching',
  HOLIDAY: 'Holiday',
  OTHER_ACADEMIC: 'Academic date',
};

/** `2026-09-07` as `7 Sep 2026`. */
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
  readonly onSave: (calendar: SavedCalendar) => void;
}) {
  const [semester, setSemester] = useState(
    parsed.semester === null ? '' : String(parsed.semester),
  );
  const [done, setDone] = useState(false);

  const chosen = semester === '' ? null : Number(semester);
  const relation = relateCalendar(
    {
      fingerprint,
      semester: chosen,
      academicYear: parsed.academicYear,
      events: parsed.events,
    },
    saved,
  );

  /*
   * A DUPLICATE IS NOT SAVED AGAIN, and a revision is not saved without a
   * decision. Both are shown; neither is resolved here (§27, §28, §29).
   */
  const blocked = relation.kind === 'duplicate';
  const ready = !blocked && parsed.events.length > 0 && chosen !== null;

  const confirm = () => {
    onSave({
      id: newId(),
      semester: chosen,
      academicYear: parsed.academicYear,
      events: parsed.events,
      fingerprint,
      importedAt: nowIso(),
      sourceKind,
    });
    setDone(true);
  };

  return (
    <section className={styles.importGroup}>
      <div className={styles.semesterHead}>
        <div className={styles.semesterIdentity}>
          <h3 className={styles.semesterTitle}>
            {parsed.academicYear === null
              ? 'Academic calendar'
              : `Academic calendar ${parsed.academicYear}`}
          </h3>
          <span className={styles.semesterMeta}>
            {parsed.events.length} dates · from {fileName}
          </span>
        </div>
      </div>

      {relation.kind === 'duplicate' && (
        <div className={styles.editorNotice}>
          <Notice>
            You have already imported this calendar. Nothing needs saving again.
          </Notice>
        </div>
      )}

      {relation.kind === 'revision' && (
        <div className={styles.editorNotice}>
          {/*
            TWO CALENDARS FOR ONE TERM ARE SHOWN, NOT RESOLVED. A reissued
            calendar and a wrong upload look identical from here, and only the
            student knows which they meant (§29).
          */}
          <Notice tone="warning">
            You already have a calendar for this term. Saving this one keeps both — check which
            dates changed before you do.
            {relation.differences.length > 0 && (
              <ul className={styles.differences}>
                {relation.differences.map((difference) => (
                  <li key={difference}>{difference}</li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      )}

      {parsed.warnings.map((warning) => (
        <div className={styles.editorNotice} key={warning}>
          <Notice tone="warning">{warning}</Notice>
        </div>
      ))}

      {/* The picker is for a calendar that simply did not print its semester. */}
      {parsed.semester === null && parsed.events.length > 0 && (
        <div className={styles.editorNotice}>
          <SelectField
            label="Semester"
            hint="This calendar did not print one, so it cannot be guessed."
            value={semester}
            onChange={(event) => {
              setSemester(event.target.value);
            }}
          >
            <option value="">Choose…</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
              <option key={value} value={value}>
                Semester {value}
              </option>
            ))}
          </SelectField>
        </div>
      )}

      <ul className={styles.subjectRows}>
        {parsed.events.map((event) => (
          <li key={event.id} className={styles.editorRow}>
            <div className={styles.editorSubject}>
              <strong>{event.title}</strong>
              <span className={styles.semesterMeta}>
                {CATEGORY_LABEL[event.category]}
                {' · '}
                {event.endDate === null
                  ? formatDate(event.startDate)
                  : `${formatDate(event.startDate)} – ${formatDate(event.endDate)}`}
              </span>
            </div>
            {/*
              WHAT THE PARSER SAW, beside what it made of it — the same
              accounting the result importer gives, for the same reason: when a
              reading is wrong this line is the only thing that explains why.
            */}
            <p className={styles.sourceLine}>
              <span className={styles.sourceLabel}>Read from</span> {event.sourceLine}
            </p>
          </li>
        ))}
      </ul>

      <div className={styles.editorActions}>
        {done ? (
          <StatusPill tone="success">Saved</StatusPill>
        ) : (
          <Button variant="primary" disabled={!ready} onClick={confirm}>
            Confirm and save calendar
          </Button>
        )}
      </div>
    </section>
  );
}
