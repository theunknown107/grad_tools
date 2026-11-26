import { CircleCheck, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout, EmptyState } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { SectionTitle } from '../../components/ui/page.js';
import {
  ATTEMPT_KIND_LABEL,
  attemptKey,
  attemptOutcome,
  courseAttemptHistories,
} from '../../domain/course-attempts.js';
import type { AttemptKind, CourseAttempt } from '../../domain/types.js';
import { useCourseAttempts } from '../../hooks/useCollection.js';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHead,
  numeric,
} from '../../components/ui/table.js';
import type { StudentProfileId } from '../../domain/identity.js';
import type { BacklogRecord, BacklogStatus } from '../../domain/types.js';
import { useBacklogs } from '../../hooks/useCollection.js';
import { newId, nowIso } from '../../lib/id.js';
import { SEMESTER_OPTIONS } from '../import/CalendarReview.js';

const STATUS_LABEL: Record<BacklogStatus, string> = {
  active: 'Not cleared',
  attempted: 'Sat, awaiting result',
  cleared: 'Cleared',
};
const STATUS_TONE: Record<BacklogStatus, Tone> = {
  active: 'warning',
  attempted: 'accent',
  cleared: 'success',
};

const RESULT_OPTIONS = [
  { value: 'pending', label: 'Result awaited' },
  { value: 'P', label: 'Passed (P)' },
  { value: 'F', label: 'Not passed (F)' },
];

/**
 * Records one re-exam a student sat for a backlog: the session, the kind, and
 * what it printed. Student-entered, device-local, in the backup — never OCR,
 * never a recomputed figure.
 */
function ReExamRecorder({
  profileId,
  record,
  onRecord,
  onCancel,
}: {
  readonly profileId: StudentProfileId;
  readonly record: BacklogRecord;
  readonly onRecord: (attempt: CourseAttempt) => void;
  readonly onCancel: () => void;
}) {
  const [session, setSession] = useState('');
  const [kind, setKind] = useState<AttemptKind>('makeup');
  const [result, setResult] = useState('pending');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (session.trim() === '') return;
    onRecord({
      id: newId(),
      profileId,
      semester: record.originSemester,
      subjectCode: record.subjectCode,
      kind,
      session: session.trim(),
      external: null,
      total: null,
      resultStatus: result === 'pending' ? null : result,
      recordedAt: nowIso(),
    });
  };

  return (
    <form
      onSubmit={submit}
      aria-label={`Record a re-exam for ${record.subjectCode}`}
      className="grid items-end gap-3 py-2 sm:grid-cols-[1.4fr_1fr_1fr_auto_auto]"
    >
      <Field label="Exam session">
        <Input
          placeholder="Summer / Makeup - 2026"
          required
          value={session}
          onChange={(event) => setSession(event.target.value)}
        />
      </Field>
      <Field label="Exam type">
        <Select
          value={kind}
          onValueChange={(value) => setKind(value as AttemptKind)}
          options={(Object.keys(ATTEMPT_KIND_LABEL) as AttemptKind[]).map((value) => ({
            value,
            label: ATTEMPT_KIND_LABEL[value],
          }))}
        />
      </Field>
      <Field label="Result">
        <Select value={result} onValueChange={setResult} options={RESULT_OPTIONS} />
      </Field>
      <Button type="submit" size="sm" disabled={session.trim() === ''}>
        Record
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** The backlogs a student records themselves — their own list of what to clear. */
export function BacklogPanel({
  profileId,
  clear,
}: {
  readonly profileId: StudentProfileId;
  /**
   * `hasNoBacklogs`. "No backlogs recorded" is always true of an empty list;
   * "Nothing to clear" is a claim about the student, and needs the results too.
   */
  readonly clear: boolean;
}) {
  const { items, save, remove } = useBacklogs();
  const { items: attempts, save: saveAttempt } = useCourseAttempts();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [semester, setSemester] = useState('1');
  /* Which backlog row has its re-exam recorder open, and its draft. */
  const [recording, setRecording] = useState<string | null>(null);

  const historyByCourse = useMemo(() => {
    const map = new Map<string, ReturnType<typeof courseAttemptHistories>[number]>();
    for (const history of courseAttemptHistories(attempts)) {
      map.set(`${String(history.semester)}:${history.subjectCode.toUpperCase()}`, history);
    }
    return map;
  }, [attempts]);

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const cleaned = code.trim().toUpperCase();
    if (cleaned === '') return;
    await save({
      id: newId(),
      profileId,
      subjectCode: cleaned,
      subjectTitle: title.trim() === '' ? cleaned : title.trim(),
      originSemester: Number(semester),
      status: 'active',
      attempts: 0,
      clearedInSemester: null,
      updatedAt: nowIso(),
    });
    setCode('');
    setTitle('');
  };

  const setStatus = async (record: BacklogRecord, status: BacklogStatus): Promise<void> => {
    await save({
      ...record,
      status,
      attempts: status === 'attempted' ? record.attempts + 1 : record.attempts,
      clearedInSemester: status === 'cleared' ? record.clearedInSemester : null,
      updatedAt: nowIso(),
    });
  };

  /*
   * A recorded re-exam is kept whole (session, kind, what it printed) alongside
   * the quick attempt counter. It never recomputes an SGPA or CGPA — the
   * regulation is not consistent about how a re-pass changes them (OQ-069,
   * docs/53). On a printed pass the backlog is marked cleared; on a printed F
   * it is counted as another attempt; anything else leaves the status alone.
   */
  const recordAttempt = async (record: BacklogRecord, attempt: CourseAttempt): Promise<void> => {
    const already = attempts.find((existing) => attemptKey(existing) === attemptKey(attempt));
    await saveAttempt({ ...attempt, id: already?.id ?? attempt.id });
    const outcome = attemptOutcome(attempt);
    if (outcome === 'passed') await setStatus(record, 'cleared');
    else if (outcome === 'not_passed')
      await save({ ...record, attempts: record.attempts + 1, updatedAt: nowIso() });
    setRecording(null);
  };

  return (
    <Card className="p-5" aria-labelledby="backlogs-title">
      <SectionTitle id="backlogs-title">Backlogs</SectionTitle>
      <p className="mb-4 text-[13px] text-ink-2">
        Subjects you still have to clear. GradTools does not know when the exams are — those come
        from official notices, not from here.
      </p>
      <form
        onSubmit={(event) => void add(event)}
        className="mb-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1.6fr_10rem_auto]"
        aria-label="Add a backlog"
      >
        <Field label="Subject code">
          <Input
            className="font-mono"
            placeholder="BCS301"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="Subject name" optional>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="From semester">
          <Select value={semester} onValueChange={setSemester} options={SEMESTER_OPTIONS} />
        </Field>
        <Button type="submit" icon={<Plus />} disabled={code.trim() === ''}>
          Add backlog
        </Button>
      </form>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<CircleCheck />}
          title="No backlogs recorded"
          description={clear ? 'Nothing to clear.' : undefined}
        />
      ) : (
        <div className="border-t border-line">
          {/* One rule, not a second frame: the card around it is already the edge. */}
          <Table>
            <TableCaption>Subjects carried from earlier semesters.</TableCaption>
            <TableHeader>
              <tr>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">From</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {items.map((record) => {
                const history = historyByCourse.get(
                  `${String(record.originSemester)}:${record.subjectCode.toUpperCase()}`,
                );
                return (
                  <Fragment key={record.id}>
                    <TableRow>
                      <TableRowHead>
                        <span className="font-mono text-[12px]">{record.subjectCode}</span>
                        {record.subjectTitle !== record.subjectCode && (
                          <span className="block text-[12px] font-normal text-ink-3">
                            {record.subjectTitle}
                          </span>
                        )}
                        {history !== undefined && history.attempts.length > 0 && (
                          <span className="mt-0.5 block text-[12px] font-normal text-ink-3">
                            {history.attempts.length} re-exam
                            {history.attempts.length === 1 ? '' : 's'} recorded
                            {history.standing === 'cleared' && history.clearedIn !== null
                              ? ` · cleared in ${history.clearedIn}`
                              : ''}
                          </span>
                        )}
                      </TableRowHead>
                      <TableCell className={numeric}>S{record.originSemester}</TableCell>
                      <TableCell className={numeric}>{record.attempts}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[record.status]}>
                          {STATUS_LABEL[record.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-44">
                        <Select
                          size="sm"
                          aria-label={`Status for ${record.subjectCode}`}
                          value={record.status}
                          onValueChange={(value) => void setStatus(record, value as BacklogStatus)}
                          options={(Object.keys(STATUS_LABEL) as BacklogStatus[]).map((status) => ({
                            value: status,
                            label: STATUS_LABEL[status],
                          }))}
                        />
                      </TableCell>
                      <TableCell className="w-20 text-right">
                        <IconButton
                          size="sm"
                          label={`Record a re-exam for ${record.subjectCode}`}
                          onClick={() =>
                            setRecording((open) => (open === record.id ? null : record.id))
                          }
                        >
                          <RotateCcw />
                        </IconButton>
                        <IconButton
                          size="sm"
                          label={`Remove ${record.subjectCode}`}
                          className="hover:text-danger"
                          onClick={() => void remove(record.id)}
                        >
                          <Trash2 />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                    {recording === record.id && (
                      <tr>
                        <TableCell colSpan={6} className="bg-accent-weak/20">
                          <ReExamRecorder
                            profileId={profileId}
                            record={record}
                            onCancel={() => setRecording(null)}
                            onRecord={(attempt) => void recordAttempt(record, attempt)}
                          />
                        </TableCell>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {attempts.length > 0 && (
        <Callout className="mt-4">
          A recorded re-exam updates this list. It does not change a saved SGPA or CGPA: the VTU
          2022 regulation is not consistent about how a cleared backlog affects them (docs/53), so
          GradTools leaves those figures as they were rather than guessing.
        </Callout>
      )}
    </Card>
  );
}
