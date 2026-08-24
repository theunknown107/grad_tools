/**
 * Manual semester results.
 *
 * Authority: docs/03 UF-08, docs/08 §SemesterRecord, M3 continuation §19.
 *
 * ---------------------------------------------------------------------------
 * ASSERTED vs COMPUTED
 * ---------------------------------------------------------------------------
 * `sgpaAsserted` is what the grade card says. The computed SGPA is derived on
 * read from @gradtools/academic-rules. When they disagree BOTH are shown and
 * the disagreement is flagged — neither silently overrides the other.
 *
 * A disagreement usually means either our reading of the rules is wrong or the
 * entry has a typo, and both are worth surfacing rather than hiding.
 *
 * Results are entered by the student. GradTools does not retrieve them from
 * any university system (docs/15 §15.5).
 */

import { useState } from 'react';
import { calculateSGPA, vtu2022RuleSet } from '@gradtools/academic-rules';
import type { ResultSubject, SemesterResult } from '../../domain/types.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { PageHeader } from '../../components/AppShell.js';
import { Plus, Trash2 } from '../../components/icons.js';
import {
  Button,
  EmptyState,
  ExplanationDisclosure,
  Notice,
  Panel,
  SelectField,
  StatusPill,
  TableScroll,
  TextField,
  monoClass,
  numericClass,
  tableClass,
} from '../../components/ui/index.js';
import { formatGpa } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';
import { useProfile, useResults } from '../../hooks/useCollection.js';
import styles from './results.module.css';

const ruleSet = vtu2022RuleSet;
const CREDIT_OPTIONS = [0.5, 1, 1.5, 2, 3, 4, 5] as const;

interface DraftSubject {
  readonly id: string;
  readonly subjectCode: string;
  readonly credits: string;
  readonly gradeLetter: string;
}

function blankSubject(): DraftSubject {
  return { id: newId(), subjectCode: '', credits: '4', gradeLetter: 'A' };
}

export function ResultsPage() {
  const { items, loading, save, remove } = useResults();
  const { profile } = useProfile();
  const [isAdding, setIsAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Results"
        subtitle="Enter a semester result once and SGPA, CGPA and backlogs follow from it."
        action={
          <Button
            variant="primary"
            onClick={() => {
              setIsAdding((current) => !current);
            }}
          >
            <Plus size={16} aria-hidden="true" />
            {isAdding ? 'Cancel' : 'Add a semester'}
          </Button>
        }
      />

      <div className={styles.stack}>
        <Notice>
          GradTools does not fetch results from the university portal. That site asks automated
          tools not to access it, and we respect that. We never ask for your portal password either.
          Enter or paste a result once and everything else works from there.
        </Notice>

        {isAdding && (
          <ResultEditor
            profileId={profile?.id ?? asStudentProfileId('local')}
            onSave={(result) => {
              void save(result);
              setIsAdding(false);
            }}
          />
        )}

        {loading ? null : items.length === 0 ? (
          <Panel title="Saved semesters" flush>
            <EmptyState
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setIsAdding(true);
                  }}
                >
                  Add a semester
                </Button>
              }
            >
              No results saved. Enter a semester result to see SGPA, CGPA and backlogs.
            </EmptyState>
          </Panel>
        ) : (
          [...items]
            .sort((a, b) => a.semester - b.semester)
            .map((result) => (
              <SavedResult
                key={result.id}
                result={result}
                onRemove={() => void remove(result.id)}
              />
            ))
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                     */
/* -------------------------------------------------------------------------- */

function ResultEditor({
  profileId,
  onSave,
}: {
  profileId: ReturnType<typeof asStudentProfileId>;
  onSave: (result: SemesterResult) => void;
}) {
  const [semester, setSemester] = useState('3');
  const [sgpaAsserted, setSgpaAsserted] = useState('');
  const [subjects, setSubjects] = useState<DraftSubject[]>(() => [
    blankSubject(),
    blankSubject(),
    blankSubject(),
  ]);

  const gradeOptions = [...ruleSet.gradeBands, ...ruleSet.specialGrades];

  const update = (id: string, patch: Partial<DraftSubject>) => {
    setSubjects((current) =>
      current.map((subject) => (subject.id === id ? { ...subject, ...patch } : subject)),
    );
  };

  const commit = () => {
    const filled: ResultSubject[] = subjects
      .filter((subject) => subject.subjectCode.trim() !== '')
      .map((subject) => ({
        id: subject.id,
        subjectCode: subject.subjectCode.trim().toUpperCase(),
        subjectTitle: subject.subjectCode.trim().toUpperCase(),
        credits: Number(subject.credits),
        gradeLetter: subject.gradeLetter,
      }));

    if (filled.length === 0) return;

    onSave({
      id: newId(),
      profileId,
      semester: Number(semester),
      schemeId: ruleSet.schemeId,
      sgpaAsserted: sgpaAsserted.trim() === '' ? null : Number(sgpaAsserted),
      subjects: filled,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  };

  return (
    <Panel title="New semester result" flush>
      <div className={styles.editorMeta}>
        <SelectField
          label="Semester"
          value={semester}
          onChange={(event) => {
            setSemester(event.target.value);
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
            <option key={value} value={value}>
              Semester {value}
            </option>
          ))}
        </SelectField>
        <TextField
          label="SGPA printed on your grade card"
          hint="Optional. If it differs from the computed value, GradTools shows both."
          inputMode="decimal"
          placeholder="8.43"
          value={sgpaAsserted}
          onChange={(event) => {
            setSgpaAsserted(event.target.value);
          }}
        />
      </div>

      <ul className={styles.subjectRows}>
        {subjects.map((subject, index) => (
          <li className={styles.subjectRow} key={subject.id}>
            <TextField
              label={`Subject code ${String(index + 1)}`}
              placeholder="BCS301"
              mono
              value={subject.subjectCode}
              onChange={(event) => {
                update(subject.id, { subjectCode: event.target.value });
              }}
            />
            <SelectField
              label={`Credits ${String(index + 1)}`}
              value={subject.credits}
              onChange={(event) => {
                update(subject.id, { credits: event.target.value });
              }}
            >
              {CREDIT_OPTIONS.map((credit) => (
                <option key={credit} value={credit}>
                  {credit}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={`Grade ${String(index + 1)}`}
              value={subject.gradeLetter}
              onChange={(event) => {
                update(subject.id, { gradeLetter: event.target.value });
              }}
            >
              {gradeOptions.map((grade) => (
                <option key={grade.letter} value={grade.letter}>
                  {grade.letter}
                </option>
              ))}
            </SelectField>
            <Button
              variant="danger"
              iconOnly
              aria-label={`Remove subject ${String(index + 1)}`}
              disabled={subjects.length === 1}
              onClick={() => {
                setSubjects((current) =>
                  current.filter((candidate) => candidate.id !== subject.id),
                );
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      <div className={styles.editorActions}>
        <Button
          onClick={() => {
            setSubjects((current) => [...current, blankSubject()]);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Add subject
        </Button>
        <Button variant="primary" onClick={commit}>
          Save semester
        </Button>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Saved result                                                               */
/* -------------------------------------------------------------------------- */

function SavedResult({ result, onRemove }: { result: SemesterResult; onRemove: () => void }) {
  const computed = calculateSGPA(
    result.subjects.map((subject) => ({
      credits: subject.credits,
      gradeLetter: subject.gradeLetter,
      subjectCode: subject.subjectCode,
    })),
    ruleSet,
  );

  const totalCredits = result.subjects.reduce((total, subject) => total + subject.credits, 0);

  /* Compared at the engine's own precision (2 dp) so a display-rounding
     artefact is never reported as a discrepancy. */
  const asserted = result.sgpaAsserted;
  const discrepancy =
    computed.ok && asserted !== null && Math.abs(computed.value - asserted) >= 0.005
      ? { computed: computed.value, asserted }
      : null;

  return (
    <Panel
      title={`Semester ${String(result.semester)}`}
      action={
        <Button
          variant="danger"
          iconOnly
          small
          aria-label={`Delete semester ${String(result.semester)} result`}
          onClick={onRemove}
        >
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      }
      flush
    >
      <div className={styles.summary}>
        <div>
          <span className={styles.summaryLabel}>SGPA (computed)</span>
          <span className={styles.summaryValue}>
            {computed.ok ? formatGpa(computed.value) : '—'}
          </span>
        </div>
        {asserted !== null && (
          <div>
            <span className={styles.summaryLabel}>SGPA (your grade card)</span>
            <span className={styles.summaryValue}>{formatGpa(asserted)}</span>
          </div>
        )}
        <div>
          <span className={styles.summaryLabel}>Credits</span>
          <span className={styles.summaryValue}>{String(totalCredits)}</span>
        </div>
      </div>

      {discrepancy && (
        <div className={styles.discrepancy}>
          <Notice tone="warning">
            <strong>These two figures disagree.</strong> Your grade card says{' '}
            {formatGpa(discrepancy.asserted)}; computing from the subjects above gives{' '}
            {formatGpa(discrepancy.computed)}. GradTools shows both rather than picking one. It
            usually means either a subject entry has a typo, or a grade needs checking.
          </Notice>
        </div>
      )}

      {!computed.ok && (
        <div className={styles.discrepancy}>
          <Notice tone="warning">{computed.detail}</Notice>
        </div>
      )}

      <TableScroll>
        <table className={tableClass}>
          <caption className="visually-hidden">Subjects in semester {result.semester}</caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col" className={numericClass}>
                Credits
              </th>
              <th scope="col" className={numericClass}>
                Grade
              </th>
            </tr>
          </thead>
          <tbody>
            {result.subjects.map((subject) => (
              <tr key={subject.id}>
                <td className={monoClass}>{subject.subjectCode}</td>
                <td className={numericClass}>{subject.credits}</td>
                <td className={numericClass}>
                  <StatusPill tone="neutral">{subject.gradeLetter}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <ExplanationDisclosure explanation={computed.explanation} />
    </Panel>
  );
}
