/**
 * Confirming an examination time table before it is kept.
 *
 * Authority: Phase 7B.2 §23, §24, §27–§29
 *
 * ---------------------------------------------------------------------------
 * REVIEW, BECAUSE THE READING CAN BE WRONG AND THE STUDENT CAN TELL
 * ---------------------------------------------------------------------------
 *
 * An exam time table arrives as a PDF or as a photograph, and a photograph is
 * read by OCR. On the one real document available, OCR returns the Biology
 * paper's `BBOK407 / BBOC407` as `[BBOK4O7/BBOC4O7|` at confidence 13. Saving
 * that silently would put a course code in a student's exam schedule that no
 * university ever issued.
 *
 * So nothing is stored until a person has seen what was read, exactly as a
 * result card and a class timetable already work here.
 */
import { useState } from 'react';
import { Button, Notice, Panel, StatusPill, monoClass } from '../../components/ui/index.js';
import { Rows, Row } from '../../components/ui/layout.js';
import { useToast } from '../../components/ui/Toast.js';
import {
  relateExamTimetable,
  type ParsedExamTimetable,
  type SavedExamTimetable,
  type StoredExamEvent,
} from '../../domain/exam-import.js';
import { newId, nowIso } from '../../lib/id.js';
import styles from './results.module.css';

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
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

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

  const confirm = async () => {
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
      toast({
        title: 'Data confirmed and recorded.',
        description: `${String(parsed.events.length)} exams are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      setState('failed');
      setError(cause instanceof Error ? cause.message : 'The exams could not be saved.');
    }
  };

  /* One line per date, so a long timetable reads as a schedule and not a list. */
  const byDate = new Map<string, typeof parsed.events>();
  for (const event of parsed.events) {
    byDate.set(event.examDate, [...(byDate.get(event.examDate) ?? []), event]);
  }

  return (
    <Panel title="Examination time table">
      <div className={styles.semesterHead}>
        <strong>{fileName}</strong>
        <div className={styles.semesterMeta}>
          {parsed.context.examCycle !== null && (
            <StatusPill tone="neutral">{parsed.context.examCycle}</StatusPill>
          )}
          {parsed.context.publicationState !== null && (
            <StatusPill tone={parsed.context.publicationState === 'draft' ? 'warning' : 'neutral'}>
              {parsed.context.publicationState}
            </StatusPill>
          )}
          {parsed.context.schemes.map((scheme) => (
            <StatusPill key={scheme} tone="neutral">{`${scheme} scheme`}</StatusPill>
          ))}
        </div>
      </div>

      {/*
        WHAT THE DOCUMENT COULD NOT SAY. A pattern names no course, and the
        warning says so rather than letting the student find out when a paper
        they expected is not on their list (§27).
      */}
      {parsed.warnings.map((warning) => (
        <div key={warning} className={styles.editorNotice}>
          <Notice tone="warning">{warning}</Notice>
        </div>
      ))}

      {duplicate && (
        <div className={styles.editorNotice}>
          <Notice tone="info">
            This is the same document you added on {relation.existing.importedAt.slice(0, 10)}.
            Nothing to record.
          </Notice>
        </div>
      )}

      {stale && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">
            You already hold a {relation.existing.publicationState ?? 'later'} time table for this
            cycle. This one can still be saved — it simply is not the newer publication.
          </Notice>
        </div>
      )}

      <Rows>
        {[...byDate.entries()].slice(0, 8).map(([date, events]) => (
          <Row
            key={date}
            lead={date}
            title={events.map((event) => event.printed).join(' · ')}
            meta={
              events[0]?.session ??
              (events[0]?.semester === null || events[0]?.semester === undefined
                ? undefined
                : `Semester ${String(events[0].semester)}`)
            }
            trailing={
              <span className={monoClass}>
                {events.length} {events.length === 1 ? 'paper' : 'papers'}
              </span>
            }
          />
        ))}
      </Rows>
      {byDate.size > 8 && (
        <p className={styles.semesterMeta}>
          and {byDate.size - 8} more {byDate.size - 8 === 1 ? 'date' : 'dates'}
        </p>
      )}

      {error !== null && (
        <div className={styles.editorNotice}>
          <Notice tone="danger">
            {error} Nothing you reviewed has been lost — press the button again to retry.
          </Notice>
        </div>
      )}

      <div className={styles.editorActions}>
        <Button
          variant="primary"
          disabled={!ready || state === 'saving' || state === 'saved'}
          onClick={() => void confirm()}
        >
          {state === 'saved'
            ? 'Recorded'
            : `Confirm ${String(parsed.events.length)} ${parsed.events.length === 1 ? 'exam' : 'exams'}`}
        </Button>
      </div>
    </Panel>
  );
}
