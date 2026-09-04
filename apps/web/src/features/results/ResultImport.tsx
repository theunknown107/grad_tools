/**
 * Importing a result card: read it, show what was read, let it be corrected.
 *
 * Authority: docs/08 §8.19 · docs/32 OQ-049 · M10A.6 §15, §16, §17, §18, §19
 *
 * ---------------------------------------------------------------------------
 * THE REVIEW IS THE FEATURE
 * ---------------------------------------------------------------------------
 *
 * Nothing here saves on its own. A file is read, what was read is shown beside
 * the line it came from, every field can be corrected, and only then is there a
 * button — and it says "Confirm and save", not "Upload", because the thing it
 * does is change a student's academic record (§15, §76).
 *
 * The reason is not caution for its own sake. An extraction that is right nine
 * times out of ten and silent about the tenth is worse than one a student
 * checks, because the tenth becomes an SGPA they cannot explain.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN REFUSES TO DECIDE
 * ---------------------------------------------------------------------------
 *
 * A total that does not add up is shown, never recomputed. Two files that
 * describe one semester differently are shown side by side and neither is
 * chosen. A semester that already has a result is blocked rather than replaced.
 * In each case a person can tell what happened and a rule cannot.
 */

import { useEffect, useRef, useState } from 'react';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import type { Subject } from '@gradtools/shared-types';
import type { ResultSubject, SemesterResult, TimetableSlot } from '../../domain/types.js';
import { RESULT_STATUSES } from '../../domain/types.js';
import { parseResultCard, rowToSubject, type ParsedRow } from '../../domain/result-import.js';
import { classifyDocument } from '../../domain/document-type.js';
import {
  fingerprintOf,
  parseAcademicCalendar,
  type ParsedCalendar,
  type SavedCalendar,
} from '../../domain/calendar-import.js';
import { CalendarReview } from './CalendarReview.js';
import { parseTimetable, type ParsedTimetable, type SavedTimetable } from '../../domain/timetable-import.js';
import { TimetableReview } from './TimetableReview.js';
import {
  blockingReason,
  groupBySemester,
  isReadyToImport,
  type ImportedFile,
  type SemesterGroup,
} from '../../domain/result-reconcile.js';
import { PdfReadError } from '../../lib/pdf-text.js';
import { OcrError, startOcr, type OcrSession } from '../../lib/ocr.js';
import {
  fileKind,
  readImageFile,
  readPdfFile,
  type FileReading,
  type Recognize,
} from '../../lib/result-file.js';
import { subjectKey } from '../../domain/subjects.js';
import type { asStudentProfileId } from '../../domain/identity.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  Notice,
  Panel,
  SelectField,
  StatusPill,
  TextField,
} from '../../components/ui/index.js';
import { newId, nowIso } from '../../lib/id.js';
import { useSubjects } from '../../hooks/useReference.js';
import styles from './results.module.css';

const ruleSet = vtu2022RuleSet;

/** A result card is a page or two of text; more files than this is a mistake. */
const MAX_FILES = 12;

/* -------------------------------------------------------------------------- */
/* Per-file state                                                             */
/* -------------------------------------------------------------------------- */

interface FileState {
  readonly id: string;
  readonly fileName: string;
  readonly bytes: number;
  /**
   * `queued` is a file waiting its turn at the recogniser.
   *
   * It is a state of its own because OCR is SEQUENTIAL — one worker for the
   * batch — and a file that shows "Reading…" for ninety seconds while three
   * others go first looks broken. "Waiting to be read" is the truth.
   */
  readonly status: 'reading' | 'queued' | 'recognising' | 'read' | 'failed';
  /** Why it failed, in words a student can act on. Null while it has not. */
  readonly error: string | null;
  readonly file: ImportedFile | null;
  /** Set instead of `file` when the document turned out to be a calendar. */
  readonly calendar: ParsedCalendar | null;
  /** Set instead of `file` when the document turned out to be a timetable. */
  readonly timetable: ParsedTimetable | null;
  readonly fingerprint: string | null;
  /** How this file was read. Carried to the review, not just logged. */
  readonly reading: FileReading | null;
}

/** A row being reviewed. Strings, because "" and 0 are different answers. */
interface DraftRow {
  readonly id: string;
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly internal: string;
  readonly external: string;
  readonly total: string;
  readonly resultStatus: string;
  readonly gradeLetter: string;
  readonly credits: string;
  readonly announcedOn: string;
  readonly sourceLine: string;
  readonly warnings: ParsedRow['warnings'];
}

function toDraft(row: ParsedRow): DraftRow {
  return {
    id: newId(),
    subjectCode: row.subjectCode,
    subjectTitle: row.subjectTitle,
    internal: row.internal === null ? '' : String(row.internal),
    external: row.external === null ? '' : String(row.external),
    total: row.total === null ? '' : String(row.total),
    resultStatus: row.resultStatus ?? '',
    gradeLetter: '',
    credits: '',
    announcedOn: row.announcedOn ?? '',
    sourceLine: row.sourceLine,
    warnings: row.warnings,
  };
}

const STATUS_PILL: Record<FileState['status'], string> = {
  reading: '…',
  queued: 'Waiting',
  recognising: 'Reading',
  read: 'Read',
  failed: 'Failed',
};

/**
 * What one file is doing, in a phrase.
 *
 * A recognised file says so. Presenting figures read off a photograph exactly
 * as it presents figures extracted from a PDF's own text would imply the two
 * are equally reliable, and they are not (§13, §42).
 */
function fileMeta(entry: FileState): string {
  if (entry.status === 'failed') return entry.error ?? 'Could not be read';
  if (entry.status === 'queued') return 'Waiting to be read…';
  if (entry.status === 'recognising') return 'Reading the text in this picture…';
  if (entry.status === 'reading') return 'Reading…';

  const rows = entry.file?.card.rows.length ?? 0;
  if (entry.reading?.source !== 'ocr') return `${String(rows)} rows read`;

  /*
   * The count of doubtful words is offered as a REASON TO LOOK, never as a
   * score. A confidently misread digit is exactly as wrong as an unconfident
   * one, so there is no percentage here that would mean anything.
   */
  const doubtful = entry.reading.lowConfidenceWords;
  return doubtful === 0
    ? `${String(rows)} rows read from a picture · check them against the card`
    : `${String(rows)} rows read from a picture · ${String(doubtful)} words were unclear`;
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                 */
/* -------------------------------------------------------------------------- */

export function ResultImport({
  profileId,
  schemeId,
  savedSemesters,
  savedCalendars,
  savedTimetables,
  onSave,
  onSaveCalendar,
  onSaveTimetable,
  onCancel,
}: {
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly schemeId: string;
  readonly savedSemesters: readonly number[];
  readonly savedCalendars: readonly SavedCalendar[];
  readonly savedTimetables: readonly SavedTimetable[];
  readonly onSave: (result: SemesterResult) => void;
  readonly onSaveCalendar: (calendar: SavedCalendar) => void;
  readonly onSaveTimetable: (
    slots: readonly TimetableSlot[],
    record: SavedTimetable,
  ) => void;
  readonly onCancel: () => void;
}) {
  /*
   * THE CATALOGUE IS FETCHED HERE, NOT ON THE RESULTS PAGE, and by scheme
   * rather than by scheme and branch.
   *
   * Here, because this panel is the only thing that needs it — asking for it on
   * every visit to Results spent a request on a screen that never used the
   * answer, and the browser sweep caught it doing so.
   *
   * By scheme, because a profile's `branch` is free text a student typed and
   * may be a display name rather than the id the reference API expects, which
   * the same sweep caught returning 400. Codes are looked up by code; fetching
   * the scheme's subjects answers that without depending on a field nothing
   * validates.
   */
  const reference = useSubjects(schemeId);
  const catalogue: readonly Subject[] =
    reference.state.status === 'ready' ? reference.state.data : [];

  const [files, setFiles] = useState<readonly FileState[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState<readonly number[]>([]);

  /*
   * ONE ENGINE FOR THE WHOLE PANEL.
   *
   * Starting a worker per file would put several copies of a 3.7MB engine and a
   * 2.8MB model in memory at once, which on a phone is how the tab gets killed.
   * So the session is created on the first file that actually needs it — a
   * student importing text PDFs never downloads it at all — and terminated when
   * the panel closes (§8, §9, §10).
   */
  const session = useRef<OcrSession | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
      void session.current?.close();
      session.current = null;
    },
    [],
  );

  const patch = (id: string, changes: Partial<FileState>) => {
    setFiles((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
    );
  };

  /** Starts the engine on first need, and hands back a way to use it. */
  const recognizer = async (): Promise<Recognize> => {
    if (session.current === null) {
      session.current = await startOcr();
    }
    const live = session.current;
    return (canvas, page, options) => live.recognize(canvas, page, options);
  };

  const read = async (chosen: readonly File[]) => {
    cancelled.current = false;
    const accepted = chosen.slice(0, MAX_FILES);
    const pending: FileState[] = accepted.map((file) => ({
      id: newId(),
      fileName: file.name,
      bytes: file.size,
      status: fileKind(file) === 'image' ? 'queued' : 'reading',
      error: null,
      file: null,
      calendar: null,
      timetable: null,
      fingerprint: null,
      reading: null,
    }));
    setFiles((current) => [...current, ...pending]);

    /*
     * THE DOCUMENT DECIDES WHERE IT GOES, not the student and not the filename.
     *
     * One upload surface, one extraction, then a classifier over the lines it
     * produced. Asking a person "is this a result or a calendar?" pushes onto
     * them a question the document already answers (M10A.7 §7, §12, §23).
     */
    const store = (id: string, fileName: string, reading: FileReading) => {
      const seen = classifyDocument(reading.lines);

      if (seen.type === 'academic_calendar') {
        patch(id, {
          status: 'read',
          reading,
          calendar: parseAcademicCalendar(reading.lines, newId),
          fingerprint: fingerprintOf(reading.lines),
        });
        return;
      }

      if (seen.type === 'college_timetable') {
        patch(id, {
          status: 'read',
          reading,
          timetable: parseTimetable(reading.placed),
          fingerprint: fingerprintOf(reading.lines),
        });
        return;
      }

      if (seen.type !== 'result') {
        /*
         * A timetable, an exam schedule, a question paper, an invoice. Refused
         * with the classifier's own sentence, which says what the document
         * looked like and what to do — never a parser error (§11, §75).
         */
        patch(id, { status: 'failed', error: seen.reason });
        return;
      }

      patch(id, {
        status: 'read',
        reading,
        file: { fileName, card: parseResultCard(reading.lines) },
      });
    };

    const fail = (id: string, cause: unknown) => {
      const message =
        cause instanceof PdfReadError || cause instanceof OcrError
          ? cause.message
          : 'This file could not be read.';
      patch(id, { status: 'failed', error: message });
    };

    /*
     * PASS ONE: EVERYTHING THAT NEEDS NO RECOGNISER.
     *
     * Text extraction is cheap and independent, so these settle in parallel and
     * ONE FILE'S FAILURE IS ONE FILE'S FAILURE (§19) — four good cards and one
     * corrupt one leave four ready to review rather than a rejected batch. What
     * turns out to be a scan is set aside for pass two instead of failing here.
     */
    const queue: { id: string; file: File; kind: 'image' | 'pdf'; data?: ArrayBuffer }[] = [];

    await Promise.all(
      accepted.map(async (file, index) => {
        const entry = pending[index];
        if (entry === undefined) return;
        const kind = fileKind(file);

        if (kind === 'unsupported') {
          patch(entry.id, {
            status: 'failed',
            error: 'GradTools reads PDFs and photos (JPG, PNG). This is neither.',
          });
          return;
        }

        if (kind === 'image') {
          queue.push({ id: entry.id, file, kind });
          return;
        }

        const data = await file.arrayBuffer();
        try {
          store(entry.id, file.name, await readPdfFile(data, null));
        } catch (cause) {
          /*
           * A scan reaches here as the "no selectable text" refusal, because
           * pass one is run without a recogniser on purpose: a text PDF must
           * never pay for an engine it does not need. Anything else is a real
           * failure and stays one.
           */
          if (cause instanceof PdfReadError && cause.message.includes('no selectable text')) {
            queue.push({ id: entry.id, file, kind, data });
            patch(entry.id, { status: 'queued' });
            return;
          }
          fail(entry.id, cause);
        }
      }),
    );

    if (queue.length === 0) return;

    /*
     * PASS TWO: RECOGNITION, ONE FILE AT A TIME.
     *
     * Sequential because there is one worker, and because two pages competing
     * for a phone's cores finish later than the same two in order.
     */
    let recognize: Recognize;
    try {
      recognize = await recognizer();
    } catch (cause) {
      for (const item of queue) fail(item.id, cause);
      return;
    }

    for (const item of queue) {
      if (cancelled.current) {
        patch(item.id, { status: 'failed', error: 'Cancelled before this file was read.' });
        continue;
      }
      patch(item.id, { status: 'recognising' });
      try {
        const reading =
          item.kind === 'image'
            ? await readImageFile(item.file, recognize)
            : await readPdfFile(item.data ?? (await item.file.arrayBuffer()), recognize);
        store(item.id, item.file.name, reading);
      } catch (cause) {
        fail(item.id, cause);
      }
    }
  };

  const groups = groupBySemester(
    files.flatMap((entry) => (entry.file === null ? [] : [entry.file])),
    [...savedSemesters, ...saved],
  );
  const busy = files.some(
    (entry) =>
      entry.status === 'reading' || entry.status === 'queued' || entry.status === 'recognising',
  );

  /**
   * Which readings came off a picture, matched by the object the group holds.
   *
   * Reference equality rather than filename: two files can share a name, and a
   * name is not evidence of anything here (§22).
   */
  const recognisedIn = (group: SemesterGroup) =>
    files.filter(
      (entry) =>
        entry.reading?.source === 'ocr' &&
        entry.file !== null &&
        group.files.includes(entry.file),
    );

  return (
    <Panel title="Import a result" flush>
      <div className={styles.importIntro}>
        <Notice>
          Your file is read on this device. It is never uploaded, and GradTools does not keep it —
          only the result you confirm is saved.
        </Notice>
      </div>

      {/*
        A compact strip, not a full-width dropzone. The upload is the smallest
        step in this workflow and should not be the largest thing on screen.
      */}
      <div
        className={styles.dropzone}
        data-dragging={dragging}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void read([...event.dataTransfer.files]);
        }}
      >
        <Icon name="results" size="nav" />
        <span>Drop a result PDF or photo here, or</span>
        <label className={styles.browse}>
          <span>browse</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => {
              void read([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {files.length > 0 && (
        <ul className={styles.fileList}>
          {files.map((entry) => (
            <li key={entry.id}>
              {/*
                The filename is rendered as TEXT and used for nothing else — not
                as evidence of a semester, not as a path, not as identity (§22).
              */}
              <span className={styles.fileName}>{entry.fileName}</span>
              <span className={styles.fileMeta}>{fileMeta(entry)}</span>
              <StatusPill
                tone={
                  entry.status === 'failed'
                    ? 'danger'
                    : entry.status === 'read'
                      ? 'success'
                      : 'neutral'
                }
              >
                {STATUS_PILL[entry.status]}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}

      {/*
        A CALENDAR REVIEWS BESIDE A RESULT, in the same panel. One upload
        surface handles whatever the student dropped into it, and each document
        gets the review its own kind needs (§23, §24).
      */}
      {files.map((entry) =>
        entry.timetable === null || entry.fingerprint === null ? null : (
          <TimetableReview
            key={entry.id}
            fileName={entry.fileName}
            parsed={entry.timetable}
            fingerprint={entry.fingerprint}
            profileId={profileId}
            saved={savedTimetables}
            onSave={onSaveTimetable}
          />
        ),
      )}

      {files.map((entry) =>
        entry.calendar === null || entry.fingerprint === null ? null : (
          <CalendarReview
            key={entry.id}
            fileName={entry.fileName}
            parsed={entry.calendar}
            fingerprint={entry.fingerprint}
            sourceKind={entry.reading?.source === 'ocr' ? 'ocr' : 'text'}
            saved={savedCalendars}
            onSave={onSaveCalendar}
          />
        ),
      )}

      {groups.map((group) => (
        <ImportGroup
          key={`${String(group.semester)}-${group.files.map((file) => file.fileName).join('|')}`}
          group={group}
          recognised={recognisedIn(group).length > 0}
          catalogue={catalogue}
          profileId={profileId}
          onSave={(result) => {
            onSave(result);
            setSaved((current) => [...current, result.semester]);
          }}
        />
      ))}

      <div className={styles.editorActions}>
        <Button
          onClick={() => {
            /*
             * CANCEL STOPS THE QUEUE, not just the panel. Files still waiting
             * are abandoned and the engine is torn down; a worker left running
             * behind a closed panel holds the model in memory for the rest of
             * the session (§10).
             */
            cancelled.current = true;
            void session.current?.close();
            session.current = null;
            onCancel();
          }}
        >
          {busy ? 'Cancel' : 'Done'}
        </Button>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* One semester, reviewed                                                     */
/* -------------------------------------------------------------------------- */

function ImportGroup({
  group,
  recognised,
  catalogue,
  profileId,
  onSave,
}: {
  readonly group: SemesterGroup;
  /** True when any file behind this semester was read off a picture. */
  readonly recognised: boolean;
  readonly catalogue: readonly Subject[];
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly onSave: (result: SemesterResult) => void;
}) {
  const first = group.files[0];
  const [semester, setSemester] = useState(String(group.semester ?? ''));
  const [rows, setRows] = useState<readonly DraftRow[]>(() =>
    (first?.card.rows ?? []).map(toDraft),
  );
  const [done, setDone] = useState(false);

  const update = (id: string, patch: Partial<DraftRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const blocked = blockingReason(group);
  const ready = isReadyToImport(group) || (group.semester === null && semester !== '');

  /** Reference credits and SEE applicability, where the catalogue covers the code. */
  const referenceFor = (code: string) => {
    const match = catalogue.find((subject) => subjectKey(subject.code) === subjectKey(code));
    return match === undefined ? null : { credits: match.credits, hasSee: match.hasSee };
  };

  const confirm = () => {
    const subjects: ResultSubject[] = rows.map((row) => {
      const base = rowToSubject(
        {
          subjectCode: row.subjectCode,
          subjectTitle: row.subjectTitle,
          internal: row.internal === '' ? null : Number(row.internal),
          external: row.external === '' ? null : Number(row.external),
          total: row.total === '' ? null : Number(row.total),
          resultStatus: row.resultStatus === '' ? null : row.resultStatus,
          announcedOn: row.announcedOn === '' ? null : row.announcedOn,
          page: 1,
          sourceLine: row.sourceLine,
          warnings: [],
        },
        row.id,
        referenceFor(row.subjectCode),
      );
      /*
       * A grade or a credit the STUDENT typed during review is theirs, and
       * overrides nothing that came off the card — the card printed neither.
       */
      return {
        ...base,
        gradeLetter: row.gradeLetter === '' ? base.gradeLetter : row.gradeLetter,
        credits: row.credits === '' ? base.credits : Number(row.credits),
      };
    });

    onSave({
      id: newId(),
      profileId,
      semester: Number(semester),
      schemeId: ruleSet.schemeId,
      // Pinned at entry, exactly as a hand-typed result is (M6 §6).
      ruleSetId: ruleSet.id,
      sgpaAsserted: null,
      subjects,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    setDone(true);
  };

  if (first === undefined) return null;

  return (
    <section className={styles.importGroup}>
      <div className={styles.semesterHead}>
        <div className={styles.semesterIdentity}>
          <h3 className={styles.semesterTitle}>
            {group.semester === null
              ? 'Semester not detected'
              : `Semester ${String(group.semester)}`}
          </h3>
          <span className={styles.semesterMeta}>
            {rows.length} subjects · from {group.files.map((file) => file.fileName).join(', ')}
          </span>
        </div>
      </div>

      {/*
        THE BLOCKING REASON COMES FIRST, ALWAYS.
        It used to be suppressed whenever the semester was unknown — which is
        precisely the state a non-result PDF lands in, so the one message that
        said "this is not a result card" was hidden exactly when it mattered and
        the student was offered a semester picker for an invoice instead. Found
        by the browser sweep.
      */}
      {blocked !== null && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">{blocked}</Notice>
        </div>
      )}

      {/*
        A RECOGNISED CARD SAYS SO, ABOVE THE FIGURES IT PRODUCED.
        Extracted text is the characters the university printed; recognised text
        is a machine's reading of a photograph of them. Showing both the same
        way would imply they are equally reliable, and the one place that
        difference can still be caught is here, before saving.
      */}
      {recognised && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">
            These figures were read from a picture, not from a PDF&apos;s own text. Check every mark
            against the card before saving — a misread digit becomes an SGPA you cannot explain.
          </Notice>
        </div>
      )}

      {/* The picker is for a REAL card that simply did not print its semester. */}
      {group.semester === null && first.card.looksLikeResultCard && (
        <div className={styles.editorNotice}>
          <SelectField
            label="Semester"
            hint="This document did not print one, so it cannot be guessed."
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

      {/*
        A SUBJECT THAT WENT MISSING SAYS SO, WITH THE LINE IT CAME FROM.

        A nine-subject card arriving as eight rows, every one of them correct,
        is the worst available outcome: the card does not print how many
        subjects it has, so nothing on screen would tell the student that one is
        gone. The line is shown as text for them to compare against their card —
        never repaired, never guessed at (M10A.6C §6).
      */}
      {group.files.some((file) => file.card.unreadableRows.length > 0) && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">
            {group.files.flatMap((file) => file.card.unreadableRows).length === 1
              ? 'One line looks like a subject row but could not be read. Check it against your card and add it by hand if the subject is missing below.'
              : `${String(group.files.flatMap((file) => file.card.unreadableRows).length)} lines look like subject rows but could not be read. Check them against your card and add any missing subjects by hand.`}
            <ul className={styles.differences}>
              {group.files
                .flatMap((file) => file.card.unreadableRows)
                .map((line) => (
                  <li key={`${String(line.page)}-${line.text}`}>{line.text}</li>
                ))}
            </ul>
          </Notice>
        </div>
      )}

      {/*
        TWO FILES THAT DISAGREE ARE SHOWN, NOT RESOLVED (§18). A revaluation and
        the wrong file both have plausible row counts and arithmetic that adds
        up; only a person can tell them apart.
      */}
      {group.differences.length > 0 && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">
            These files describe the same semester differently:
            <ul className={styles.differences}>
              {group.differences.map((difference) => (
                <li key={`${difference.subjectCode}-${difference.field}`}>
                  {difference.subjectCode} · {difference.field}: {difference.a} → {difference.b}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <ul className={styles.subjectRows}>
        {rows.map((row, index) => (
          <li key={row.id} className={styles.editorRow}>
            <div className={styles.editorSubject}>
              <TextField
                label={`Subject code ${String(index + 1)}`}
                mono
                value={row.subjectCode}
                onChange={(event) => {
                  update(row.id, { subjectCode: event.target.value });
                }}
              />
              <TextField
                label={`Subject name ${String(index + 1)}`}
                value={row.subjectTitle}
                onChange={(event) => {
                  update(row.id, { subjectTitle: event.target.value });
                }}
              />
            </div>
            <TextField
              label={`Internal ${String(index + 1)}`}
              inputMode="numeric"
              value={row.internal}
              onChange={(event) => {
                update(row.id, { internal: event.target.value });
              }}
            />
            <TextField
              label={`External ${String(index + 1)}`}
              inputMode="numeric"
              value={row.external}
              onChange={(event) => {
                update(row.id, { external: event.target.value });
              }}
            />
            <TextField
              label={`Total ${String(index + 1)}`}
              inputMode="numeric"
              value={row.total}
              onChange={(event) => {
                update(row.id, { total: event.target.value });
              }}
            />
            <SelectField
              label={`Result ${String(index + 1)}`}
              value={row.resultStatus}
              onChange={(event) => {
                update(row.id, { resultStatus: event.target.value });
              }}
            >
              <option value="">—</option>
              {RESULT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </SelectField>
            <TextField
              label={`Credits ${String(index + 1)}`}
              hint="Only if you know it."
              inputMode="decimal"
              value={row.credits}
              onChange={(event) => {
                update(row.id, { credits: event.target.value });
              }}
            />
            <SelectField
              label={`Grade ${String(index + 1)}`}
              hint="Only if the card prints one."
              value={row.gradeLetter}
              onChange={(event) => {
                update(row.id, { gradeLetter: event.target.value });
              }}
            >
              <option value="">—</option>
              {[...ruleSet.gradeBands, ...ruleSet.specialGrades].map((grade) => (
                <option key={grade.letter} value={grade.letter}>
                  {grade.letter}
                </option>
              ))}
            </SelectField>
            <Button
              variant="danger"
              iconOnly
              aria-label={`Remove row ${String(index + 1)}`}
              onClick={() => {
                setRows((current) => current.filter((candidate) => candidate.id !== row.id));
              }}
            >
              <Icon name="trash" size="nav" />
            </Button>

            {/*
              WHAT THE PARSER SAW, beside what it made of it. When a reading is
              wrong this line is the only thing that explains why — and every
              warning is shown against the row it concerns rather than collected
              into a list nobody reads.
            */}
            <p className={styles.sourceLine}>
              <span className={styles.sourceLabel}>Read from</span> {row.sourceLine}
            </p>
            {row.warnings.map((warning) => (
              <p key={warning.kind} className={styles.mismatch}>
                {warning.message}
              </p>
            ))}
          </li>
        ))}
      </ul>

      <div className={styles.editorActions}>
        {done ? (
          <StatusPill tone="success">Saved</StatusPill>
        ) : (
          <Button variant="primary" disabled={!ready || rows.length === 0} onClick={confirm}>
            Confirm and save result
          </Button>
        )}
      </div>
    </section>
  );
}
