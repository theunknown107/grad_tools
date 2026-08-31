/**
 * The subjects a student is taking in one semester.
 *
 * Authority: docs/08 §8.13 · M6 §14, §16
 *
 * A SUBJECT IS DEFINED ONCE. Attendance and the timetable point at this list
 * rather than each holding their own copy, so a code typed here is the code
 * they both use and a rename does not leave three spellings behind (M6 §16).
 *
 * Everything here is student-entered and stays on the device. Titles and notes
 * are rendered as TEXT — nothing on this screen interprets markup.
 */

import { useState } from 'react';
import type { SemesterSubject } from '../../domain/types.js';
import type { StudentProfileId } from '../../domain/identity.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  EmptyState,
  SelectField,
  TextField,
  numericClass,
  tableClass,
  TableScroll,
} from '../../components/ui/index.js';
import { newId, nowIso } from '../../lib/id.js';
import { useSemesterSubjects } from '../../hooks/useCollection.js';
import styles from './semesters.module.css';

/** Credit values a VTU course can carry. A select, not free text. */
const CREDIT_OPTIONS = [0.5, 1, 1.5, 2, 3, 4, 5] as const;

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

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim() === '') return;

    const subject: SemesterSubject = {
      id: newId(),
      profileId,
      semester,
      code: code.trim().toUpperCase(),
      title: title.trim() === '' ? code.trim().toUpperCase() : title.trim(),
      credits: Number(credits),
      notes: null,
      updatedAt: nowIso(),
    };
    await save(subject);
    setCode('');
    setTitle('');
  }

  return (
    <div className={styles.subjects}>
      <form className={styles.subjectForm} onSubmit={(event) => void add(event)}>
        <TextField
          label="Code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          placeholder="BCS501"
        />
        <TextField
          label="Name"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          placeholder="Optional"
        />
        <SelectField
          label="Credits"
          value={credits}
          onChange={(event) => {
            setCredits(event.target.value);
          }}
        >
          {CREDIT_OPTIONS.map((value) => (
            <option key={value} value={String(value)}>
              {value}
            </option>
          ))}
        </SelectField>
        <Button type="submit" variant="secondary">
          <Icon name="plus" size="nav" />
          Add subject
        </Button>
      </form>

      {subjects.length === 0 ? (
        <EmptyState>
          No subjects for this semester yet. Adding them here lets attendance and the timetable use
          the same list.
        </EmptyState>
      ) : (
        <TableScroll>
          <table className={tableClass}>
            <caption className={styles.caption}>
              Subjects for semester {semester}. {subjects.length} listed.
            </caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Credits</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.id}>
                  <th scope="row">{subject.code}</th>
                  <td>{subject.title}</td>
                  <td className={numericClass}>{subject.credits}</td>
                  <td>
                    <Button
                      variant="danger"
                      iconOnly
                      aria-label={`Remove ${subject.code}`}
                      onClick={() => {
                        void remove(subject.id);
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
    </div>
  );
}
