import { CircleCheck, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { EmptyState } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { SectionTitle } from '../../components/ui/page.js';
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
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [semester, setSemester] = useState('1');

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
              {items.map((record) => (
                <TableRow key={record.id}>
                  <TableRowHead>
                    <span className="font-mono text-[12px]">{record.subjectCode}</span>
                    {record.subjectTitle !== record.subjectCode && (
                      <span className="block text-[12px] font-normal text-ink-3">
                        {record.subjectTitle}
                      </span>
                    )}
                  </TableRowHead>
                  <TableCell className={numeric}>S{record.originSemester}</TableCell>
                  <TableCell className={numeric}>{record.attempts}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</Badge>
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
                  <TableCell className="w-12 text-right">
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
