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
import { calculateCGPA, calculateSGPA, vtu2022RuleSet } from '@gradtools/academic-rules';
import type { ResultSubject, SemesterResult } from '../../domain/types.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { PageHeader } from '../../components/AppShell.js';
import { Icon } from '../../components/icons.js';
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
import { IslandTabs, IslandTabPanel } from '../../components/ui/IslandTabs.js';
import { MetricStrip } from '../../components/ui/layout.js';
import { DropdownMenu } from '../../components/ui/DropdownMenu.js';
import { Sheet } from '../../components/ui/Sheet.js';
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
  const [view, setView] = useState('overview');

  /* Whether any saved semester's grade card and computed SGPA disagree. */
  const anyMismatch = items.some((result) => {
    if (result.sgpaAsserted === null) return false;
    const computed = calculateSGPA(
      result.subjects.map((subject) => ({
        credits: subject.credits,
        gradeLetter: subject.gradeLetter,
        subjectCode: subject.subjectCode,
      })),
      vtu2022RuleSet,
    );
    return computed.ok && Math.abs(computed.value - result.sgpaAsserted) >= 0.005;
  });

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
            <Icon name="plus" size="nav" />
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

        {/*
          The reason a disagreement matters, said ONCE. Each semester that
          disagrees then needs only one line (M9.3 §24).
        */}
        {anyMismatch && (
          <p className={styles.mismatchHelp}>
            Where a grade card and the computed figure disagree, GradTools shows both rather than
            picking one. It usually means a subject entry has a typo, or a grade needs checking.
          </p>
        )}

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
          <EmptyState
            title="No results yet"
            icons={['results', 'gpa', 'degree']}
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
            Enter a semester result to see SGPA, CGPA and backlogs.
          </EmptyState>
        ) : (
          <>
            {/*
              M9.6E: OVERVIEW AND DETAIL ARE DIFFERENT QUESTIONS.
              The page was one flat list of every semester's full table, so
              "how am I doing overall" could only be answered by scrolling four
              tables and adding up. The two views are genuinely distinct
              content, which is the only justification for tabs (§28).
            */}
            <IslandTabs
              label="Results view"
              value={view}
              onChange={setView}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'semesters', label: 'Semesters', count: items.length },
              ]}
            />

            {view === 'overview' ? (
              <IslandTabPanel id="overview">
                <ResultsOverview items={items} />
              </IslandTabPanel>
            ) : (
              <IslandTabPanel id="semesters">
                <div className={styles.stack}>
                  {[...items]
                    .sort((a, b) => a.semester - b.semester)
                    .map((result) => (
                      <SavedResult
                        key={result.id}
                        result={result}
                        onRemove={() => void remove(result.id)}
                      />
                    ))}
                </div>
              </IslandTabPanel>
            )}
          </>
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
      // Pinned at entry: a later rule set must never silently re-grade a
      // semester that has already been sat (M6 §6).
      ruleSetId: ruleSet.id,
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
              <Icon name="trash" size="nav" />
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
          <Icon name="plus" size="nav" />
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

/**
 * Cumulative standing, and one quiet row per semester.
 *
 * M9.6E §11: "make the result readable in seconds". The figures a student
 * actually asks for — where do I stand, and which semester dragged — were
 * previously reachable only by reading four separate tables.
 *
 * Every figure here comes from the rules engine. Nothing is derived in this
 * component beyond summing credits, which the engine does not own.
 */
function ResultsOverview({ items }: { readonly items: readonly SemesterResult[] }) {
  const perSemester = [...items]
    .sort((a, b) => a.semester - b.semester)
    .map((result) => {
      const sgpa = calculateSGPA(
        result.subjects.map((subject) => ({
          credits: subject.credits,
          gradeLetter: subject.gradeLetter,
          subjectCode: subject.subjectCode,
        })),
        ruleSet,
      );
      return {
        result,
        sgpa: sgpa.ok ? sgpa.value : null,
        credits: result.subjects.reduce((total, subject) => total + subject.credits, 0),
      };
    });

  const gradable = perSemester.filter((entry) => entry.sgpa !== null && entry.credits > 0);
  const cgpa = calculateCGPA(
    gradable.map((entry) => ({
      credits: entry.credits,
      sgpa: entry.sgpa as number,
      semester: entry.result.semester,
    })),
    ruleSet,
  );
  const totalCredits = gradable.reduce((total, entry) => total + entry.credits, 0);
  const subjects = perSemester.reduce((total, entry) => total + entry.result.subjects.length, 0);

  return (
    <div className={styles.overview}>
      <MetricStrip
        metrics={[
          { label: 'CGPA', value: cgpa.ok ? formatGpa(cgpa.value) : '—' },
          { label: 'Semesters', value: String(perSemester.length) },
          { label: 'Subjects', value: String(subjects) },
          { label: 'Credits', value: String(totalCredits) },
        ]}
      />

      {/*
        Quiet rows, not cards (§28). A per-semester list is repeated data and
        takes a hairline; the elevated surfaces on this page are the strip
        above and the tables behind the other tab.
      */}
      <ol className={styles.ledger}>
        {perSemester.map((entry) => (
          <li key={entry.result.id} className={styles.ledgerRow}>
            <span className={styles.ledgerSemester}>S{entry.result.semester}</span>
            <span className={styles.ledgerMeta}>
              {entry.result.subjects.length} subjects · {entry.credits} credits
            </span>
            {/*
              The bar is scaled across the PASSING range (4-10), not 0-10:
              below 4 a course is failed, so the lower 40% of a 0-10 bar is a
              region no SGPA can occupy and every real reading would sit in the
              top half looking identical.
            */}
            <span className={styles.ledgerBar} aria-hidden="true">
              <span
                style={{
                  inlineSize:
                    entry.sgpa === null
                      ? '0%'
                      : `${String(Math.max(0, Math.min(100, ((entry.sgpa - 4) / 6) * 100)))}%`,
                }}
              />
            </span>
            <span className={styles.ledgerSgpa}>
              {entry.sgpa === null ? '—' : formatGpa(entry.sgpa)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SavedResult({ result, onRemove }: { result: SemesterResult; onRemove: () => void }) {
  const [detail, setDetail] = useState<ResultSubject | null>(null);
  const computed = calculateSGPA(
    result.subjects.map((subject) => ({
      credits: subject.credits,
      gradeLetter: subject.gradeLetter,
      subjectCode: subject.subjectCode,
    })),
    ruleSet,
  );

  const totalCredits = result.subjects.reduce((total, subject) => total + subject.credits, 0);

  /*
   * Normalised with `?? null`, exactly as `domain/academics.ts` does. The type
   * says `number | null`, but this record came out of IndexedDB and nothing
   * type-checks it at runtime: a row written before the field existed carries
   * `undefined`, `asserted !== null` is then TRUE, and `formatGpa(undefined)`
   * throws and takes the page down. Found by the M9.6B browser sweep.
   */
  const asserted = result.sgpaAsserted ?? null;
  const discrepancy =
    computed.ok && asserted !== null && Math.abs(computed.value - asserted) >= 0.005
      ? { computed: computed.value, asserted }
      : null;

  return (
    <section className={styles.semester} aria-labelledby={`sem-${String(result.semester)}`}>
      {/*
        M9.6E: THE SEMESTER HEADER IS A LEDGER LINE, NOT A PANEL HEADER.
        Each semester used to be its own bordered card with a title bar; four
        of them made the page a stack of identical boxes. The figures now sit
        inline with the heading, which is how a grade card actually reads.
      */}
      <div className={styles.semesterHead}>
        <div className={styles.semesterIdentity}>
          <h3 className={styles.semesterTitle} id={`sem-${String(result.semester)}`}>
            Semester {result.semester}
          </h3>
          <span className={styles.semesterMeta}>
            {result.subjects.length} subjects · {totalCredits} credits
          </span>
        </div>

        <dl className={styles.semesterFigures}>
          <div>
            <dt>SGPA</dt>
            <dd>{computed.ok ? formatGpa(computed.value) : '—'}</dd>
          </div>
          {asserted !== null ? (
            <div>
              <dt>Grade card</dt>
              <dd data-muted="true">{formatGpa(asserted)}</dd>
            </div>
          ) : null}
        </dl>

        {/*
          Row actions behind a menu (M9.6E §4). Delete was a permanently
          visible red button on every semester — a destructive action given
          the same prominence as the data, four times over.
        */}
        <DropdownMenu
          label={`Actions for semester ${String(result.semester)}`}
          items={[
            { label: 'Delete this semester', icon: 'trash', onSelect: onRemove, tone: 'danger' },
          ]}
        />
      </div>

      {discrepancy ? (
        <p className={styles.mismatch}>
          Grade card {formatGpa(discrepancy.asserted)} · computed {formatGpa(discrepancy.computed)}{' '}
          — these disagree.
        </p>
      ) : null}

      {!computed.ok ? (
        <div className={styles.discrepancy}>
          <Notice tone="warning">{computed.detail}</Notice>
        </div>
      ) : null}

      {/*
        DESKTOP: a dense table. MOBILE: the same rows as buttons that open a
        sheet (M9.6E §10) — nine columns cannot be shown at 390px and must not
        scroll sideways.
      */}
      <div className={styles.tableWide}>
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
                  <td>
                    {subject.subjectTitle !== subject.subjectCode && subject.subjectTitle !== '' ? (
                      <>
                        <span className={styles.subjectName}>{subject.subjectTitle}</span>
                        <span className={`${styles.subjectCode ?? ''} ${monoClass}`}>
                          {subject.subjectCode}
                        </span>
                      </>
                    ) : (
                      <span className={monoClass}>{subject.subjectCode}</span>
                    )}
                  </td>
                  <td className={numericClass}>{subject.credits}</td>
                  <td className={numericClass}>
                    <StatusPill tone="neutral">{subject.gradeLetter}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>

      <ul className={styles.tableNarrow}>
        {result.subjects.map((subject) => (
          <li key={subject.id}>
            <button
              type="button"
              className={styles.subjectRow}
              onClick={() => setDetail(subject)}
              aria-haspopup="dialog"
            >
              <span className={styles.subjectRowText}>
                <span className={styles.subjectName}>
                  {subject.subjectTitle === '' ? subject.subjectCode : subject.subjectTitle}
                </span>
                <span className={`${styles.subjectCode ?? ''} ${monoClass}`}>
                  {subject.subjectCode} · {subject.credits} credits
                </span>
              </span>
              <StatusPill tone="neutral">{subject.gradeLetter}</StatusPill>
              <Icon name="chevronRight" size="small" />
            </button>
          </li>
        ))}
      </ul>

      <Sheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        side="bottom"
        title={
          detail?.subjectTitle === '' ? (detail.subjectCode ?? '') : (detail?.subjectTitle ?? '')
        }
        description={`Semester ${String(result.semester)}`}
      >
        {detail !== null ? (
          <dl className={styles.detailList}>
            <div>
              <dt>Subject code</dt>
              <dd className={monoClass}>{detail.subjectCode}</dd>
            </div>
            <div>
              <dt>Credits</dt>
              <dd>{detail.credits}</dd>
            </div>
            <div>
              <dt>Grade</dt>
              <dd>
                <StatusPill tone="neutral">{detail.gradeLetter}</StatusPill>
              </dd>
            </div>
            {/*
              Only what the record actually holds. `ResultSubject` cannot store
              internal, external or total marks (OQ-049), and inventing rows
              here to fill the sheet would be exactly the manufactured value
              docs/37 forbids.
            */}
          </dl>
        ) : null}
      </Sheet>

      <ExplanationDisclosure explanation={computed.explanation} />
    </section>
  );
}
