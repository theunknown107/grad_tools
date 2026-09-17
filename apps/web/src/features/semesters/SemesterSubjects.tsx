import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/button.js';
import { EmptyState } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
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
import type { SemesterSubject } from '../../domain/types.js';
import { useSemesterSubjects } from '../../hooks/useCollection.js';
import { newId, nowIso } from '../../lib/id.js';

export const CREDIT_OPTIONS = ['0.5', '1', '1.5', '2', '3', '4', '5'].map((value) => ({
  value,
  label: value,
}));

/** The subjects a semester teaches — shared by attendance and the timetable. */
export function SemesterSubjects({
  semester,
  profileId,
}: {
  readonly semester: number;
  readonly profileId: StudentProfileId;
}) {
  const { items, save, remove } = useSemesterSubjects();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [credits, setCredits] = useState('4');
  const subjects = items.filter((subject) => subject.semester === semester);

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const cleaned = code.trim().toUpperCase();
    if (cleaned === '') return;
    const subject: SemesterSubject = {
      id: newId(),
      profileId,
      semester,
      code: cleaned,
      title: title.trim() === '' ? cleaned : title.trim(),
      credits: Number(credits),
      notes: null,
      updatedAt: nowIso(),
    };
    await save(subject);
    setCode('');
    setTitle('');
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => void add(event)}
        className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1.6fr_7rem_auto]"
        aria-label={`Add a subject to semester ${String(semester)}`}
      >
        <Field label="Code">
          <Input
            className="font-mono"
            placeholder="BCS501"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="Name" optional>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Credits">
          <Select value={credits} onValueChange={setCredits} options={CREDIT_OPTIONS} />
        </Field>
        <Button type="submit" icon={<Plus />} disabled={code.trim() === ''}>
          Add subject
        </Button>
      </form>
      {subjects.length === 0 ? (
        <EmptyState
          compact
          icon={<BookOpen />}
          title="No subjects for this semester yet"
          description="Adding them here lets attendance and the timetable use the same list."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-raised">
          <Table>
            <TableCaption>
              Subjects for semester {semester}. {subjects.length} listed.
            </TableCaption>
            <TableHeader>
              <tr>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {subjects.map((subject) => (
                <TableRow key={subject.id}>
                  <TableRowHead className="font-mono text-[12px]">{subject.code}</TableRowHead>
                  <TableCell className="text-ink-2">{subject.title}</TableCell>
                  <TableCell className={numeric}>{subject.credits}</TableCell>
                  <TableCell className="w-12 text-right">
                    <IconButton
                      size="sm"
                      label={`Remove ${subject.code}`}
                      className="hover:text-danger"
                      onClick={() => void remove(subject.id)}
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
    </div>
  );
}
