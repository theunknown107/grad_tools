/**
 * The import workflow: read files on this device, work out what each one is,
 * and hand each to its review.
 *
 *   PDF with text      → read directly
 *   PDF without text   → queued for OCR
 *   photo              → queued for OCR
 *
 * Then `classifyDocument` routes it: result card, academic calendar, class
 * timetable, exam timetable or scheme. Anything else is refused with the
 * classifier's own reason. The stepper follows the real state of the files.
 */

import { vtu2022RuleSet } from '@gradtools/academic-rules';
import { parseScheme, schemePages, type ParsedScheme } from '@gradtools/vtu-catalogue';
import { coursesForScheme } from '@gradtools/vtu-catalogue/data';
import { FileText, ImageIcon, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileDropzone } from '../../components/forms/FileDropzone.js';
import { ImportStepper, type ImportStep } from '../../components/forms/ImportStepper.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardRows } from '../../components/ui/card.js';
import { IconTile, Row } from '../../components/ui/page.js';
import { Spinner } from '../../components/ui/spinner.js';
import {
  fingerprintOf,
  parseAcademicCalendar,
  type ParsedCalendar,
} from '../../domain/calendar-import.js';
import { classifyDocument } from '../../domain/document-type.js';
import { parseExamTimetable, type ParsedExamTimetable } from '../../domain/exam-import.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { parseResultCard } from '../../domain/result-import.js';
import {
  groupBySemester,
  type ImportedFile,
  type SemesterGroup,
} from '../../domain/result-reconcile.js';
import { buildSubjectIndex, type CatalogueSubject } from '../../domain/subjects.js';
import { parseTimetable, type ParsedTimetable } from '../../domain/timetable-import.js';
import type { SchemeCourse, TimetableSlot } from '../../domain/types.js';
import type { SavedExamTimetable, StoredExamEvent } from '../../domain/exam-import.js';
import {
  useCalendars,
  useExamEvents,
  useExamTimetables,
  useProfile,
  useResults,
  useSchemeCourses,
  useSemesterSubjects,
  useTimetable,
  useTimetableImports,
} from '../../hooks/useCollection.js';
import { useSubjects } from '../../hooks/useReference.js';
import { cn } from '../../lib/cn.js';
import { newId } from '../../lib/id.js';
import { OcrError, startOcr, type OcrSession } from '../../lib/ocr.js';
import { PdfReadError } from '../../lib/pdf-text.js';
import {
  fileKind,
  readImageFile,
  readPdfFile,
  type FileReading,
  type Recognize,
} from '../../lib/result-file.js';
import { CalendarReview } from './CalendarReview.js';
import { ExamReview } from './ExamReview.js';
import { ResultReview } from './ResultReview.js';
import { SchemeReview } from './SchemeReview.js';
import { TimetableReview } from './TimetableReview.js';

const MAX_FILES = 12;

interface FileState {
  readonly id: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly image: boolean;
  readonly status: 'reading' | 'queued' | 'recognising' | 'read' | 'failed';
  readonly error: string | null;
  readonly file: ImportedFile | null;
  readonly calendar: ParsedCalendar | null;
  readonly timetable: ParsedTimetable | null;
  readonly exam: ParsedExamTimetable | null;
  readonly scheme: ParsedScheme | null;
  readonly fingerprint: string | null;
  readonly reading: FileReading | null;
}

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileMeta(entry: FileState): string {
  if (entry.status === 'failed') return entry.error ?? 'Could not be read';
  if (entry.status === 'queued') return 'Waiting to be read…';
  if (entry.status === 'recognising') return 'Reading the text in this picture…';
  if (entry.status === 'reading') return 'Checking the file type and structure…';
  const kind =
    entry.calendar !== null
      ? 'Academic calendar'
      : entry.timetable !== null
        ? 'Class timetable'
        : entry.exam !== null
          ? 'Exam timetable'
          : entry.scheme !== null
            ? 'Scheme of teaching'
            : 'Result card';
  if (entry.file === null) return kind;
  const rows = entry.file.card.rows.length;
  if (entry.reading?.source !== 'ocr') return `${kind} · ${String(rows)} rows read`;
  const doubtful = entry.reading.lowConfidenceWords;
  return doubtful === 0
    ? `${kind} · ${String(rows)} rows read from a picture · check them against the card`
    : `${kind} · ${String(rows)} rows read from a picture · ${String(doubtful)} words were unclear`;
}

export function DocumentImport({ onDone }: { readonly onDone: () => void }) {
  const { profile } = useProfile();
  const schemeId = profile?.schemeId ?? vtu2022RuleSet.schemeId;
  const profileId = profile?.id ?? asStudentProfileId('local');
  const { items: results, save: saveResult } = useResults();
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: calendars, save: saveCalendar } = useCalendars();
  const { items: timetable, save: saveSlot, remove: removeSlot } = useTimetable();
  const { items: timetableImports, save: saveImport } = useTimetableImports();
  const { items: examTimetables, save: saveExamDocument } = useExamTimetables();
  const { save: saveExamEvent } = useExamEvents();
  const schemeCourses = useSchemeCourses();
  const reference = useSubjects(schemeId);

  const catalogue: readonly CatalogueSubject[] = useMemo(
    () => [
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
        hasSee: null,
      })),
      ...(reference.state.status === 'ready' ? reference.state.data : []),
    ],
    [schemeCourses.items, reference.state, schemeId],
  );
  const subjectIndex = useMemo(
    () => buildSubjectIndex({ catalogue, results, semesterSubjects }),
    [catalogue, results, semesterSubjects],
  );

  const [files, setFiles] = useState<readonly FileState[]>([]);
  const [saved, setSaved] = useState<readonly number[]>([]);
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

  const patch = (id: string, changes: Partial<FileState>): void => {
    setFiles((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
    );
  };

  const recognizer = async (): Promise<Recognize> => {
    if (session.current === null) session.current = await startOcr();
    const live = session.current;
    return (canvas, page, options) => live.recognize(canvas, page, options);
  };

  const store = (id: string, fileName: string, reading: FileReading): void => {
    const seen = classifyDocument(reading.lines);
    const fingerprint = fingerprintOf(reading.lines);
    switch (seen.type) {
      case 'academic_calendar':
        patch(id, {
          status: 'read',
          reading,
          calendar: parseAcademicCalendar(reading.lines, newId),
          fingerprint,
        });
        return;
      case 'exam_timetable':
        patch(id, {
          status: 'read',
          reading,
          exam: parseExamTimetable(schemePages(reading.placed)),
          fingerprint,
        });
        return;
      case 'college_timetable':
        patch(id, {
          status: 'read',
          reading,
          timetable: parseTimetable(reading.placed),
          fingerprint,
        });
        return;
      case 'course_scheme':
        patch(id, {
          status: 'read',
          reading,
          scheme: parseScheme(schemePages(reading.placed)),
          fingerprint,
        });
        return;
      case 'result':
        patch(id, {
          status: 'read',
          reading,
          file: { fileName, card: parseResultCard(reading.lines) },
        });
        return;
      default:
        patch(id, { status: 'failed', error: seen.reason });
    }
  };

  const fail = (id: string, cause: unknown): void => {
    patch(id, {
      status: 'failed',
      error:
        cause instanceof PdfReadError || cause instanceof OcrError
          ? cause.message
          : 'This file could not be read.',
    });
  };

  const read = async (chosen: readonly File[]): Promise<void> => {
    cancelled.current = false;
    const accepted = chosen.slice(0, MAX_FILES);
    const pending: FileState[] = accepted.map((file) => ({
      id: newId(),
      fileName: file.name,
      bytes: file.size,
      image: fileKind(file) === 'image',
      status: fileKind(file) === 'image' ? 'queued' : 'reading',
      error: null,
      file: null,
      calendar: null,
      timetable: null,
      exam: null,
      scheme: null,
      fingerprint: null,
      reading: null,
    }));
    setFiles((current) => [...current, ...pending]);

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

  const groups: readonly SemesterGroup[] = groupBySemester(
    files.flatMap((entry) => (entry.file === null ? [] : [entry.file])),
    [...results.map((result) => result.semester), ...saved],
  );
  const busy = files.some(
    (entry) =>
      entry.status === 'reading' || entry.status === 'queued' || entry.status === 'recognising',
  );
  const anyReview = files.some(
    (entry) =>
      entry.calendar !== null ||
      entry.timetable !== null ||
      entry.exam !== null ||
      entry.scheme !== null,
  );
  const step: ImportStep =
    saved.length > 0
      ? 'Confirm'
      : files.some((entry) => entry.status === 'recognising')
        ? 'Parse'
        : files.some((entry) => entry.status === 'reading' || entry.status === 'queued')
          ? 'Validate'
          : groups.length > 0 || anyReview
            ? 'Review'
            : 'Select';

  const replaceScheme = async (courses: readonly SchemeCourse[]): Promise<void> => {
    const incoming = new Set(courses.map((course) => course.code));
    for (const existing of schemeCourses.items) {
      if (incoming.has(existing.code)) await schemeCourses.remove(existing.id);
    }
    for (const course of courses) await schemeCourses.save(course);
  };
  const replaceTimetable = async (
    slots: readonly TimetableSlot[],
    record: Parameters<typeof saveImport>[0],
  ): Promise<void> => {
    for (const slot of timetable) await removeSlot(slot.id);
    for (const slot of slots) await saveSlot(slot);
    await saveImport(record);
  };
  const saveExamTimetable = async (
    record: SavedExamTimetable,
    events: readonly StoredExamEvent[],
  ): Promise<void> => {
    await saveExamDocument(record);
    for (const event of events) await saveExamEvent(event);
  };

  return (
    <div className="flex flex-col gap-6">
      <ImportStepper at={step} done={saved.length > 0} />

      <FileDropzone busy={busy} onFiles={(chosen) => void read(chosen)} />

      {files.length > 0 && (
        <Card className="overflow-hidden">
          <h3 className="sr-only">Files you added</h3>
          <CardRows aria-live="polite">
            {files.map((entry) => {
              const working =
                entry.status === 'reading' ||
                entry.status === 'queued' ||
                entry.status === 'recognising';
              return (
                <Row key={entry.id}>
                  <IconTile
                    tone={entry.status === 'failed' ? 'danger' : working ? 'accent' : 'neutral'}
                  >
                    {working ? <Spinner /> : entry.image ? <ImageIcon /> : <FileText />}
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {entry.fileName}
                    </span>
                    <span
                      className={cn(
                        'block truncate text-[12px]',
                        entry.status === 'failed' ? 'text-danger' : 'text-ink-3',
                      )}
                    >
                      {sizeOf(entry.bytes)} · {fileMeta(entry)}
                    </span>
                  </span>
                  <Badge
                    tone={
                      entry.status === 'failed'
                        ? 'danger'
                        : entry.status === 'read'
                          ? 'success'
                          : 'accent'
                    }
                    className="hidden sm:inline-flex"
                  >
                    {entry.status === 'failed'
                      ? 'Failed'
                      : entry.status === 'read'
                        ? 'Read'
                        : 'Processing'}
                  </Badge>
                  {(entry.status === 'read' || entry.status === 'failed') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${entry.fileName}`}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((candidate) => candidate.id !== entry.id),
                        )
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </Row>
              );
            })}
          </CardRows>
        </Card>
      )}

      {files.map((entry) =>
        entry.timetable === null || entry.fingerprint === null ? null : (
          <TimetableReview
            key={entry.id}
            fileName={entry.fileName}
            parsed={entry.timetable}
            fingerprint={entry.fingerprint}
            profileId={profileId}
            saved={timetableImports}
            onSave={replaceTimetable}
          />
        ),
      )}
      {files.map((entry) =>
        entry.exam === null || entry.fingerprint === null ? null : (
          <ExamReview
            key={entry.id}
            fileName={entry.fileName}
            parsed={entry.exam}
            fingerprint={entry.fingerprint}
            profileId={profileId}
            saved={examTimetables}
            onSave={saveExamTimetable}
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
            onSave={replaceScheme}
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
            saved={calendars}
            onSave={saveCalendar}
          />
        ),
      )}
      {groups.map((group) => (
        <ResultReview
          key={`${String(group.semester)}-${group.files.map((file) => file.fileName).join('|')}`}
          group={group}
          recognised={files.some(
            (entry) =>
              entry.reading?.source === 'ocr' &&
              entry.file !== null &&
              group.files.includes(entry.file),
          )}
          catalogue={catalogue}
          subjectIndex={subjectIndex}
          profileId={profileId}
          onSave={async (result) => {
            await saveResult(result);
            setSaved((current) => [...current, result.semester]);
          }}
          onDiscard={() => {
            const names = new Set(group.files.map((file) => file.fileName));
            setFiles((current) => current.filter((entry) => !names.has(entry.fileName)));
          }}
        />
      ))}

      {files.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              cancelled.current = true;
              void session.current?.close();
              session.current = null;
              onDone();
            }}
          >
            {busy ? 'Cancel' : 'Done'}
          </Button>
        </div>
      )}
    </div>
  );
}
