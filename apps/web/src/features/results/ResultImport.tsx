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

import { useEffect, useMemo, useRef, useState } from 'react';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import type {
  ResultSubject,
  SemesterResult,
  SchemeCourse,
  SemesterSubject,
  TimetableSlot,
} from '../../domain/types.js';
import { RESULT_STATUSES } from '../../domain/types.js';
import { parseResultCard, rowToSubject, type ParsedRow } from '../../domain/result-import.js';
import { classifyDocument } from '../../domain/document-type.js';
import { COURSE_KIND_LABEL, enrichRow, type RowEnrichment } from '../../domain/enrichment.js';
import { resolveCourseKind } from '../../domain/exams.js';
import {
  fingerprintOf,
  parseAcademicCalendar,
  type ParsedCalendar,
  type SavedCalendar,
} from '../../domain/calendar-import.js';
import { CalendarReview } from './CalendarReview.js';
import { SchemeReview } from './SchemeReview.js';
import { parseScheme, schemePages, type ParsedScheme } from '@gradtools/vtu-catalogue';
import {
  parseTimetable,
  type ParsedTimetable,
  type SavedTimetable,
} from '../../domain/timetable-import.js';
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
import {
  buildSubjectIndex,
  creditsFor,
  resolveSubject,
  subjectKey,
  type CatalogueSubject,
  type SubjectIdentity,
} from '../../domain/subjects.js';
import type { asStudentProfileId } from '../../domain/identity.js';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons.js';
import {
  Button,
  buttonClassName,
  Notice,
  Panel,
  SelectField,
  TextField,
} from '../../components/ui/index.js';
import { Alert } from '../../components/ui/Feedback.js';
import { useToast } from '../../components/ui/Toast.js';
import { ImportStepper, type ImportStep } from '../../components/ui/ImportStepper.js';
import { FileDropzone } from '../../components/ui/FileDropzone.js';
import { Attachment, ItemGroup, ItemRow } from '../../components/ui/Item.js';
import { newId, nowIso } from '../../lib/id.js';
import { useSubjects } from '../../hooks/useReference.js';
import { useSchemeCourses } from '../../hooks/useCollection.js';
import { coursesForScheme } from '@gradtools/vtu-catalogue/data';
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
  /** Set instead of `file` when the document turned out to be a scheme. */
  readonly scheme: ParsedScheme | null;
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
  /**
   * The student's answer to "did this course have a final exam?", as `''`
   * (not asked / not answered), `'yes'` or `'no'`.
   *
   * Asked ONLY where nothing else can resolve it — see the control below. The
   * product rule is "ask only when necessary", and this is the one question a
   * result card genuinely cannot answer for itself.
   */
  readonly hasSee: string;
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
    hasSee: '',
    announcedOn: row.announcedOn ?? '',
    sourceLine: row.sourceLine,
    warnings: row.warnings,
  };
}

/**
 * What one file is doing, in a phrase.
 *
 * A recognised file says so. Presenting figures read off a photograph exactly
 * as it presents figures extracted from a PDF's own text would imply the two
 * are equally reliable, and they are not (§13, §42).
 */
/**
 * Whether this row still needs the student to say if the course had an SEE.
 *
 * Asked through `resolveCourseKind` — the SAME resolver the rules layer uses —
 * rather than by re-deriving the condition here. Two copies of "when is this
 * unknown" would drift, and the drift would show up as a question asked about a
 * row that was already resolved, or worse, not asked about one that was not.
 *
 * A row the student has already answered keeps its control, so the answer can
 * be changed; it simply no longer needs one.
 */
function needsSeeAnswer(row: DraftRow, referenceHasSee: boolean | null): boolean {
  if (row.hasSee !== '') return true;
  const external = row.external === '' ? null : Number(row.external);
  return (
    resolveCourseKind({
      subjectCode: row.subjectCode,
      subjectTitle: row.subjectTitle,
      internal: null,
      external: Number.isFinite(external) ? external : null,
      total: null,
      resultStatus: null,
      announcedOn: null,
      gradeLetter: row.gradeLetter === '' ? null : row.gradeLetter,
      gradePoint: null,
      credits: null,
      /* The catalogue's answer, where there is one — so a subject the
         reference data already covers is never asked about. */
      hasSee: referenceHasSee,
      provenance: 'manual',
      id: row.id,
    }).kind === null
  );
}

/**
 * What the product actually knows about one reviewed row.
 *
 * Authority: Phase 7C §13, §14, §33
 *
 * Every value carries where it came from, and every absence carries why. A
 * student-provided figure is labelled "Your own record" and NEVER "catalogue"
 * (§14) — that mislabelling is what let a typed credit be trusted as reference
 * data elsewhere, and the words are what stop it returning.
 */
function ResolvedRow({
  row,
  enrichment,
}: {
  readonly row: DraftRow;
  readonly enrichment: RowEnrichment;
}) {
  const { credits, grade, gradePoint, courseKind } = enrichment;

  return (
    <dl className={styles.resolved} aria-label={`What is known about ${row.subjectCode}`}>
      <div className={styles.resolvedItem} data-unresolved={credits.value === null}>
        <dt>Credits</dt>
        <dd>
          {credits.value === null ? (
            <>
              <span className={styles.resolvedMissing}>Unavailable</span>
              <span className={styles.resolvedWhy}>{credits.reason}</span>
            </>
          ) : (
            <>
              {/* Zero is a real answer for a non-credit course, and is shown as
                  one rather than as an absence (§33). */}
              <span className={styles.resolvedValue}>{credits.value}</span>
              {credits.source !== null && (
                <span className={styles.resolvedWhy}>{credits.source}</span>
              )}
            </>
          )}
        </dd>
      </div>

      <div className={styles.resolvedItem} data-unresolved={courseKind.kind === null}>
        <dt>Assessment</dt>
        <dd>
          {courseKind.kind === null ? (
            <>
              <span className={styles.resolvedMissing}>Not known</span>
              <span className={styles.resolvedWhy}>
                Answer the final-exam question above to settle it.
              </span>
            </>
          ) : (
            <>
              <span className={styles.resolvedValue}>{COURSE_KIND_LABEL[courseKind.kind]}</span>
              <span className={styles.resolvedWhy}>
                {courseKind.from === 'catalogue'
                  ? 'VTU catalogue'
                  : courseKind.from === 'grade'
                    ? 'From the printed grade'
                    : 'From the marks'}
              </span>
            </>
          )}
        </dd>
      </div>

      <div className={styles.resolvedItem} data-unresolved={grade.value === null}>
        <dt>Grade</dt>
        <dd>
          {grade.value === null ? (
            <>
              <span className={styles.resolvedMissing}>Requires review</span>
              <span className={styles.resolvedWhy}>{grade.reason}</span>
            </>
          ) : (
            <>
              <span className={styles.resolvedValue}>{grade.value}</span>
              <span className={styles.resolvedWhy}>{grade.source}</span>
            </>
          )}
        </dd>
      </div>

      <div className={styles.resolvedItem} data-unresolved={gradePoint.value === null}>
        <dt>Grade point</dt>
        <dd>
          {gradePoint.value === null ? (
            <>
              {/* A dash cannot say whether the point is zero or unknown (§1). */}
              <span className={styles.resolvedMissing}>Not known</span>
              {gradePoint.reason !== null && (
                <span className={styles.resolvedWhy}>{gradePoint.reason}</span>
              )}
            </>
          ) : (
            <span className={styles.resolvedValue}>{gradePoint.value}</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

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
  title,
  savedSemesters,
  savedResults,
  semesterSubjects,
  savedCalendars,
  savedTimetables,
  onSave,
  onSaveCalendar,
  onSaveTimetable,
  onSaveScheme,
  onCancel,
}: {
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly schemeId: string;
  /**
   * The panel's own heading, or `undefined` where the page already carries it.
   *
   * On Results the panel needs to name itself, because it sits among other
   * things. On `/import` the page heading says the same words directly above
   * it, and printing them twice is a heading a screen reader reads twice.
   *
   * IT USED TO DEFAULT to "Add academic document", which meant the one caller
   * that deliberately passed nothing got the heading anyway — and with it a
   * card wrapping the whole flow. The approved design puts the stepper and the
   * drop surface directly on the canvas there, so absence has to mean absence.
   */
  readonly title?: string | undefined;
  readonly savedSemesters: readonly number[];
  /**
   * The student's own saved results and semester plan.
   *
   * Read ONLY to resolve credits for a code they have already described, so the
   * same figure is never asked for twice. Nothing here is treated as reference
   * data — see `creditsFor`, which keeps the two tiers apart.
   */
  readonly savedResults: readonly SemesterResult[];
  readonly semesterSubjects: readonly SemesterSubject[];
  readonly savedCalendars: readonly SavedCalendar[];
  readonly savedTimetables: readonly SavedTimetable[];
  readonly onSave: (result: SemesterResult) => void | Promise<void>;
  readonly onSaveCalendar: (calendar: SavedCalendar) => void;
  readonly onSaveTimetable: (slots: readonly TimetableSlot[], record: SavedTimetable) => void;
  /**
   * Records a scheme's courses as reference data.
   *
   * Given the whole scheme at once rather than a row at a time, because a
   * scheme REPLACES what it covers: the caller drops the codes it supersedes
   * and writes the new figures together, and a half-applied replacement would
   * leave two credit figures for one code with nothing to choose between them.
   */
  readonly onSaveScheme: (courses: readonly SchemeCourse[]) => void | Promise<void>;
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
  /*
   * Memoised because the not-ready branch is a fresh `[]` on every render, and
   * that array is a dependency of the subject index below — without this the
   * index is rebuilt on every keystroke in the review form.
   */
  /*
   * TWO CATALOGUE SOURCES, ONE TIER.
   *
   * The reference API is one; a Scheme of Teaching the student imported is the
   * other, and on a device that has never reached the network it is the ONLY
   * one. Both are the university's own published figures, so both belong to
   * the `catalogue` tier — and a credit from either is labelled "VTU
   * catalogue" honestly, which a figure the student typed never is (§14).
   *
   * The API's rows go in second so that where both cover a code, the reference
   * database — which is versioned and corrigible — settles it.
   */
  const schemeCourses = useSchemeCourses();
  const catalogue: readonly CatalogueSubject[] = useMemo(
    () => [
      /*
       * THE SHIPPED CATALOGUE FIRST (§26, §27).
       *
       * Generated by `pnpm vtu:normalize` from documents the crawler retrieved
       * from VTU, with provenance on every row. Before this, credits came from
       * a scheme PDF the student had to find and import by hand — which is the
       * manual catalogue maintenance this phase exists to remove.
       *
       * A scheme the student imports themselves still works and still wins,
       * because it is more specific to them: their own college's document
       * beats the one shipped in the build.
       */
      ...coursesForScheme(schemeId).map((course) => ({
        code: course.code,
        title: course.title,
        semester: course.semester,
        credits: course.credits,
        hasSee: null,
      })),
      ...schemeCourses.items.map((course) => ({
        code: course.code,
        title: course.title,
        semester: course.semester,
        credits: course.credits,
        /*
         * The scheme prints CIE and SEE columns, and this reader does not take
         * them: a `---` in the SEE column and a `50` are distinguished by
         * position in a table whose row shapes vary, and DEC-037 forbids
         * guessing SEE applicability from anything less than reference data.
         * Null keeps the question open rather than answering it wrongly.
         */
        hasSee: null,
      })),
      ...(reference.state.status === 'ready' ? reference.state.data : []),
    ],
    [schemeCourses.items, reference.state, schemeId],
  );

  /*
   * ONE INDEX OVER THE CATALOGUE AND THE STUDENT'S OWN RECORDS.
   *
   * The importer used to look credits up in the catalogue alone, so with no
   * network — or with a scheme the reference database does not cover — every
   * subject imported with `credits: null`, and a null credit is one of the two
   * things that makes an SGPA unavailable. The index adds the tier that was
   * missing: what this student has already said about this code.
   */
  const subjectIndex = useMemo(
    () => buildSubjectIndex({ catalogue, results: savedResults, semesterSubjects }),
    [catalogue, savedResults, semesterSubjects],
  );

  const [files, setFiles] = useState<readonly FileState[]>([]);
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
      scheme: null,
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

      if (seen.type === 'course_scheme') {
        patch(id, {
          status: 'read',
          reading,
          scheme: parseScheme(schemePages(reading.placed)),
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
        entry.reading?.source === 'ocr' && entry.file !== null && group.files.includes(entry.file),
    );

  /*
   * WHERE THE DOCUMENT HAS GOT TO, from the pipeline's own state.
   *
   * Every step is a state the importer actually passes through: a file being
   * read, a picture being recognised, rows waiting to be confirmed, a write
   * that completed. Nothing is inferred and nothing runs ahead of the work —
   * a stepper that shows a stage the code never enters is a promise it cannot
   * keep.
   */
  const step: ImportStep =
    saved.length > 0
      ? 'Confirm'
      : files.some((entry) => entry.status === 'recognising')
        ? 'Parse'
        : files.some((entry) => entry.status === 'reading' || entry.status === 'queued')
          ? 'Validate'
          : groups.length > 0
            ? 'Review'
            : 'Select';

  const body = (
    <>
      <div className={styles.importSteps}>
        <ImportStepper at={step} />
      </div>

      {/*
        THE DROP SURFACE (Phase 7B §4, §15).

        Replaces the one-line dashed strip that used to sit here. The strip was
        deliberately small — "the upload is the smallest step in this workflow"
        — and that reasoning was wrong twice over: automatic ingestion is the
        PRIMARY workflow of the product, and a 40px drop target is one a person
        dragging a PDF misses, which drops the file on the page and navigates
        the browser away from the app.

        The pipeline behind it is untouched. `read()` is the same function, and
        the dropzone only adds the VALIDATION step in front of it.
      */}
      <div className={styles.importDrop}>
        <FileDropzone
          busy={busy}
          title="Drop a document here"
          hint="A result card, an academic calendar or a class timetable. GradTools works out which is which."
          onFiles={(chosen) => {
            void read([...chosen]);
          }}
        />
      </div>

      {files.length > 0 && (
        <div className={styles.importFiles}>
          <ItemGroup label="Files you added">
            {files.map((entry) => (
              <ItemRow key={entry.id}>
                {/*
                  The filename is rendered as TEXT and used for nothing else —
                  not as evidence of a semester, not as a path, not as identity
                  (§22).
                */}
                <Attachment
                  fileName={entry.fileName}
                  bytes={entry.bytes}
                  status={entry.status}
                  {...(entry.status === 'failed'
                    ? { error: entry.error ?? 'Could not be read' }
                    : { detail: fileMeta(entry) })}
                  /*
                   * TAKING A FILE BACK.
                   *
                   * A person who drops the wrong card, or four when they meant
                   * one, could add files and never remove them — the only way
                   * out was to leave the page and lose the others too. The
                   * review groups derive from `files`, so dropping the entry
                   * takes its review with it and nothing else has to be undone.
                   *
                   * Not offered while the file is being READ: cancelling an
                   * in-flight OCR page is a different piece of work, and a
                   * button that silently does nothing is worse than none.
                   */
                  {...(entry.status === 'read' || entry.status === 'failed'
                    ? {
                        onRemove: () => {
                          setFiles((current) =>
                            current.filter((candidate) => candidate.id !== entry.id),
                          );
                        },
                      }
                    : {})}
                />
              </ItemRow>
            ))}
          </ItemGroup>
        </div>
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
        entry.scheme === null ? null : (
          <SchemeReview
            key={entry.id}
            fileName={entry.fileName}
            parsed={entry.scheme}
            profileId={profileId}
            saved={schemeCourses.items}
            onSave={onSaveScheme}
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
          subjectIndex={subjectIndex}
          profileId={profileId}
          /*
           * THE PROMISE IS RETURNED, and the semester is only marked saved
           * once the write has actually resolved. This wrapper used to call
           * `onSave(result)` and return undefined, so the group's `await`
           * finished instantly, a rejection escaped as an unhandled error, and
           * the semester joined `saved` whether or not it had been stored —
           * which then blocked re-importing the one file that had failed.
           */
          onSave={async (result) => {
            await onSave(result);
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
    </>
  );

  /*
   * A CARD ONLY WHERE THE PANEL IS A GUEST.
   *
   * On Results it sits among other things and needs an edge and a name. On
   * `/import` it IS the page, and the approved design puts the stepper and the
   * drop surface straight onto the canvas — a card there is a box around the
   * whole screen carrying a heading the page already printed.
   */
  return title === undefined ? (
    <div className={styles.importBare}>{body}</div>
  ) : (
    <Panel title={title} flush>
      {body}
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
  subjectIndex,
  profileId,
  onSave,
}: {
  readonly group: SemesterGroup;
  /** True when any file behind this semester was read off a picture. */
  readonly recognised: boolean;
  readonly catalogue: readonly CatalogueSubject[];
  readonly subjectIndex: Map<string, SubjectIdentity>;
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly onSave: (result: SemesterResult) => void | Promise<void>;
}) {
  const first = group.files[0];
  const [semester, setSemester] = useState(String(group.semester ?? ''));
  const [rows, setRows] = useState<readonly DraftRow[]>(() =>
    (first?.card.rows ?? []).map(toDraft),
  );
  /*
   * THE SAVE HAS FOUR STATES, NOT TWO.
   *
   * It used to be a boolean flipped SYNCHRONOUSLY, before the write had
   * happened — `onSave(...)` then `setDone(true)`, with the panel above
   * calling `void saveResult(result)`. So the screen said "Saved" whether or
   * not anything reached storage, and a rejected write was swallowed entirely
   * by that `void`: the row stayed in memory looking saved and was gone on the
   * next reload.
   */
  const toast = useToast();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const done = saveState === 'saved';

  const update = (id: string, patch: Partial<DraftRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  /**
   * What is known about a row AS IT STANDS IN THE FORM.
   *
   * Built from the draft rather than from the saved record, so the summary
   * updates the moment a credit is typed or the final-exam question answered —
   * which is the point: a student should see the effect of what they just told
   * the product, not after saving it.
   */
  const enrichmentFor = (row: DraftRow): RowEnrichment => {
    const reference = catalogueFor(row.subjectCode);
    const asSubject = rowToSubject(
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
      reference,
    );
    return enrichRow(
      {
        ...asSubject,
        gradeLetter: row.gradeLetter === '' ? asSubject.gradeLetter : row.gradeLetter,
        credits:
          row.credits === ''
            ? (asSubject.credits ?? rememberedCredits(row.subjectCode))
            : Number(row.credits),
        hasSee: row.hasSee === '' ? asSubject.hasSee : row.hasSee === 'yes',
      },
      resolveSubject(subjectIndex, row.subjectCode),
      ruleSet,
    );
  };

  const blocked = blockingReason(group);
  const ready = isReadyToImport(group) || (group.semester === null && semester !== '');

  /**
   * THE CATALOGUE, AND ONLY THE CATALOGUE.
   *
   * This is what `rowToSubject` is given, and it is what decides `provenance`.
   * A first version of this folded the student's own recorded credits in here
   * too, which was wrong in a way that quietly corrupted the reference tier:
   * `rowToSubject` marks a row `catalogue` whenever it is handed anything at
   * all, so a credit the STUDENT typed came back labelled as the scheme's
   * answer — and `buildSubjectIndex` then trusted it as reference data on every
   * other screen. The comment there even claimed the opposite.
   *
   * The student tier is applied separately, below, as an override on a row that
   * is still `manual`.
   */
  const catalogueFor = (code: string) => {
    const match = catalogue.find((subject) => subjectKey(subject.code) === subjectKey(code));
    return match === undefined ? null : { credits: match.credits, hasSee: match.hasSee };
  };

  /**
   * Credits this student has already recorded for the same code.
   *
   * Never `hasSee`: DEC-037 keeps that reference data, and an unknown one stays
   * unknown until somebody answers for it.
   */
  const rememberedCredits = (code: string) =>
    creditsFor(resolveSubject(subjectIndex, code)).credits;

  const confirm = async () => {
    /*
     * IDEMPOTENT AGAINST A SECOND PRESS. A double click, a held Enter or an
     * impatient retry must not write the semester twice — and the button being
     * disabled is not enough on its own, because the disable only lands after
     * the render that follows the first click.
     */
    if (saveState === 'saving' || saveState === 'saved') return;

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
        catalogueFor(row.subjectCode),
      );
      /*
       * A grade or a credit the STUDENT typed during review is theirs, and
       * overrides nothing that came off the card — the card printed neither.
       */
      return {
        ...base,
        gradeLetter: row.gradeLetter === '' ? base.gradeLetter : row.gradeLetter,
        /*
         * Typed at review, else the catalogue's, else what this student already
         * recorded for the same code. The last of those keeps `provenance:
         * 'manual'`, which is exactly right — it is their figure, not the
         * scheme's.
         */
        credits:
          row.credits === ''
            ? (base.credits ?? rememberedCredits(row.subjectCode))
            : Number(row.credits),
        /*
         * An answer the student gave is better than no answer, and it is still
         * not reference data — `provenance` stays whatever `rowToSubject`
         * decided, so nothing here can pass a student's answer off as the
         * catalogue's.
         */
        hasSee: row.hasSee === '' ? base.hasSee : row.hasSee === 'yes',
      };
    });

    setSaveState('saving');
    setSaveError(null);
    try {
      await onSave({
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
      setSaveState('saved');
      toast({
        title: 'Data confirmed and recorded.',
        description: `Semester ${semester} and its ${String(subjects.length)} subjects are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      /*
       * THE REVIEW STAYS, AND SO DOES EVERYTHING TYPED INTO IT.
       *
       * A failed write must never cost the student the work of reviewing —
       * that is the one thing they cannot get back by trying again. So the
       * rows are untouched, the button returns, and the reason is shown.
       */
      setSaveState('failed');
      setSaveError(
        cause instanceof Error && cause.message !== ''
          ? `Data could not be recorded: ${cause.message}`
          : 'Data could not be recorded. Please try again.',
      );
    }
  };

  if (first === undefined) return null;

  /*
   * A SAVED SEMESTER LEAVES THE REVIEW.
   *
   * It used to stay, fully rendered, with the button swapped for a small
   * "Saved" pill at the foot of a long form — so the screen after a successful
   * import looked exactly like the screen before it, and read as frozen. There
   * was nothing to say the work had finished and nothing to do next.
   *
   * The parsed rows are deliberately NOT kept behind a toggle here: they are in
   * the record now, and Results is where a saved semester is read and
   * corrected. Leaving an editable copy on the import screen would be a second
   * place to change a result, and the two would disagree.
   */
  if (done) {
    /*
     * THE SUCCESS STATE, as the approved design composes it: a mark, the
     * sentence, the figures that were actually written, and somewhere to go
     * next. It was an inline alert — correct, and easy to miss at the end of a
     * long review.
     *
     * The figures are counted from the rows that were saved. The design also
     * shows an SGPA here; this does not, because the SGPA is the rules
     * engine's to compute and it is not in scope at this point. Two true
     * numbers beat three where one is guessed.
     */
    /*
     * THE RESOLVED CREDITS, not the typed field.
     *
     * `row.credits` is what the student typed, and it is empty whenever the
     * catalogue supplied the figure instead — which is the usual case, and
     * why summing it reported 0 credits for a twenty-credit semester. The
     * enrichment holds the number that was actually saved.
     *
     * If ANY row's credits are unresolved the total is omitted rather than
     * under-reported: a partial sum presented as the semester's credits is
     * worse than not showing one.
     */
    const perRow = rows.map((row) => enrichmentFor(row).credits.value);
    const creditsKnown = perRow.every((value) => value !== null);
    const credits = perRow.reduce((total: number, value) => total + (value ?? 0), 0);
    return (
      <section
        className={`${styles.importDone ?? ''} gt-pop`}
        aria-label={`Semester ${semester} recorded`}
      >
        <span className={styles.doneMark} aria-hidden="true">
          <Icon name="check" size="large" />
        </span>
        {/* `live` used to carry this to a screen reader; the region does now. */}
        <h3 className={styles.doneTitle} role="status">
          Data confirmed and recorded.
        </h3>
        <p className={styles.doneBody}>
          Semester {semester} and its {rows.length} subject{rows.length === 1 ? '' : 's'} are saved
          on this device. Your dashboard, results and degree progress are already up to date.
        </p>
        <dl className={styles.doneFigures}>
          <div>
            <dd>{rows.length}</dd>
            <dt>subject{rows.length === 1 ? '' : 's'}</dt>
          </div>
          {creditsKnown && (
            <div>
              <dd>{credits}</dd>
              <dt>credits</dt>
            </div>
          )}
          <div>
            <dd>{semester}</dd>
            <dt>semester</dt>
          </div>
        </dl>
        <div className={styles.doneActions}>
          <Link className={buttonClassName('primary')} to="/results">
            View results
          </Link>
          <Link className={buttonClassName()} to="/">
            Go to dashboard
          </Link>
        </div>
      </section>
    );
  }

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
            {/*
              ASK ONLY WHEN NECESSARY.
              
              This control appears for a row whose course kind nothing could
              resolve — no catalogue entry, no PP/NP/AU on the card, and an
              external of 0, which reads identically as "this course has no
              final exam" and "sat it and scored nothing" (DEC-037). That is
              the ONE fact a result card cannot state and no arithmetic can
              recover, and without it the row has no pass state, no grade, and
              keeps the whole semester's SGPA unavailable.
              
              On the four real cards this was checked against it appears twice
              in semester 3 and once in semester 4, and not at all in semesters
              1 and 2 — which is the point. It is a question about the rows
              that need one, not a field on every row.
            */}
            {needsSeeAnswer(row, catalogueFor(row.subjectCode)?.hasSee ?? null) && (
              <SelectField
                label={`Final exam ${String(index + 1)}`}
                hint="This card does not say, and it changes the result."
                value={row.hasSee}
                onChange={(event) => {
                  update(row.id, { hasSee: event.target.value });
                }}
              >
                <option value="">Not sure</option>
                <option value="yes">Had a final exam</option>
                <option value="no">No final exam</option>
              </SelectField>
            )}
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
              WHAT IS ACTUALLY KNOWN ABOUT THIS ROW (§13).
              
              The card prints marks and nothing else — no credits, no grade, no
              grade point — so all three are DERIVED, and each derivation can
              fail on its own. Without this the review showed the raw fields and
              two empty inputs, and a student could not tell "4 credits" from
              "nobody knows how many credits this has".
              
              Uncertainty is shown, never hidden: an unresolved field says so
              and says why.
            */}
            <ResolvedRow row={row} enrichment={enrichmentFor(row)} />

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

      {saveError !== null && (
        <div className={styles.editorNotice}>
          <Alert tone="danger" live="assertive" title="Not recorded">
            {saveError} Nothing you reviewed has been lost — press the button again to retry.
          </Alert>
        </div>
      )}

      <div className={styles.editorActions}>
        <Button
          variant="primary"
          disabled={!ready || rows.length === 0 || saveState === 'saving'}
          onClick={() => void confirm()}
        >
          {saveState === 'saving' ? 'Recording…' : 'Confirm and save result'}
        </Button>
      </div>
    </section>
  );
}
