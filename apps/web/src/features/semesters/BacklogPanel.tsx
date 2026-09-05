/**
 * Backlogs — subjects not yet cleared.
 *
 * Authority: docs/08 §8.13 · M6 §10
 *
 * NO EXAM DATE FIELD, and none may be added. A re-sit date is a university
 * fact that has to come from a verified source; a student-entered one would
 * look identical on screen and be trusted the same way (M6 §10).
 *
 * `attempted` is deliberately not `cleared`: it means the exam was sat and the
 * result is not known. Folding the two together would quietly turn a hope into
 * a pass.
 */

import { useState } from 'react';
import type { BacklogRecord, BacklogStatus } from '../../domain/types.js';
import type { StudentProfileId } from '../../domain/identity.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  EmptyState,
  Panel,
  SelectField,
  StatusPill,
  TextField,
  numericClass,
  tableClass,
  TableScroll,
} from '../../components/ui/index.js';
import { newId, nowIso } from '../../lib/id.js';
import { PastelCard, Rail } from '../../components/ui/tone.js';
import { formatCount } from '../../lib/format.js';
import { useBacklogs } from '../../hooks/useCollection.js';
import styles from './semesters.module.css';

const STATUS_LABEL: Record<BacklogStatus, string> = {
  active: 'Not cleared',
  attempted: 'Sat, awaiting result',
  cleared: 'Cleared',
};

const STATUS_TONE: Record<BacklogStatus, 'warning' | 'accent' | 'success'> = {
  active: 'warning',
  attempted: 'accent',
  cleared: 'success',
};

export function BacklogPanel({ profileId }: { readonly profileId: StudentProfileId }) {
  const { items, save, remove } = useBacklogs();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [semester, setSemester] = useState('1');

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim() === '') return;

    const record: BacklogRecord = {
      id: newId(),
      profileId,
      subjectCode: code.trim().toUpperCase(),
      subjectTitle: title.trim() === '' ? code.trim().toUpperCase() : title.trim(),
      originSemester: Number(semester),
      status: 'active',
      attempts: 0,
      clearedInSemester: null,
      updatedAt: nowIso(),
    };
    await save(record);
    setCode('');
    setTitle('');
  }

  async function setStatus(record: BacklogRecord, status: BacklogStatus) {
    await save({
      ...record,
      status,
      // Sitting the exam is what increments attempts; clearing it does not.
      attempts: status === 'attempted' ? record.attempts + 1 : record.attempts,
      clearedInSemester: status === 'cleared' ? record.clearedInSemester : null,
      updatedAt: nowIso(),
    });
  }

  return (
    <Panel title="Backlogs">
      <p className={styles.note}>
        Subjects you still have to clear. GradTools does not know when the exams are — those come
        from official notices, not from here.
      </p>

      {/*
        THE TONE IS THE STATUS, not a rotation. A backlog still open takes the
        attention tone and a cleared one takes the progress tone, so the state
        of the degree is legible before a single row is read. Nothing here is
        alarming red: the reference's palette says "deal with this", not
        "something has gone wrong".
      */}
      {items.length > 0 && (
        <Rail label="Backlogs">
          {items.map((record) => {
            const cleared = record.status === 'cleared';
            return (
              <PastelCard
                key={record.id}
                tone={cleared ? 'lime' : 'peach'}
                pill={cleared ? 'Cleared' : 'Open'}
                title={record.subjectCode}
                body={
                  cleared
                    ? `Cleared${record.clearedInSemester === null ? '' : ` in semester ${String(record.clearedInSemester)}`}.`
                    : `Carried from semester ${String(record.originSemester)}${
                        record.attempts > 0 ? `, ${formatCount(record.attempts, 'attempt')}` : ''
                      }.`
                }
              />
            );
          })}
        </Rail>
      )}

      <form className={styles.backlogForm} onSubmit={(event) => void add(event)}>
        <TextField
          label="Subject code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          placeholder="BCS301"
        />
        <TextField
          label="Subject name"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          placeholder="Optional"
        />
        <SelectField
          label="From semester"
          value={semester}
          onChange={(event) => {
            setSemester(event.target.value);
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((number) => (
            <option key={number} value={String(number)}>
              Semester {number}
            </option>
          ))}
        </SelectField>
        <Button type="submit" variant="secondary">
          <Icon name="plus" size="nav" />
          Add backlog
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState>No backlogs recorded. Nothing to clear.</EmptyState>
      ) : (
        <TableScroll>
          <table className={tableClass}>
            <caption className={styles.caption}>Subjects carried from earlier semesters.</caption>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">From</th>
                <th scope="col">Attempts</th>
                <th scope="col">Status</th>
                <th scope="col">Change</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr key={record.id}>
                  {/* Student-entered text, rendered as text. Never markup. */}
                  <th scope="row">
                    {record.subjectCode}
                    {record.subjectTitle !== record.subjectCode && (
                      <span className={styles.subjectTitle}> {record.subjectTitle}</span>
                    )}
                  </th>
                  <td className={numericClass}>S{record.originSemester}</td>
                  <td className={numericClass}>{record.attempts}</td>
                  <td>
                    <StatusPill tone={STATUS_TONE[record.status]}>
                      {STATUS_LABEL[record.status]}
                    </StatusPill>
                  </td>
                  <td>
                    <SelectField
                      label={`Status for ${record.subjectCode}`}
                      value={record.status}
                      onChange={(event) => {
                        void setStatus(record, event.target.value as BacklogStatus);
                      }}
                    >
                      <option value="active">Not cleared</option>
                      <option value="attempted">Sat, awaiting result</option>
                      <option value="cleared">Cleared</option>
                    </SelectField>
                  </td>
                  <td>
                    <Button
                      variant="danger"
                      iconOnly
                      aria-label={`Remove ${record.subjectCode}`}
                      onClick={() => {
                        void remove(record.id);
                      }}
                    >
                      <Icon name="trash" size="nav" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
