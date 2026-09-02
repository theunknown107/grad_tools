/**
 * Semester results — what the card printed, and what follows from it.
 *
 * Authority: docs/03 UF-08 · docs/08 §8.19 · docs/32 OQ-049
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF A REAL RESULT CARD
 * ---------------------------------------------------------------------------
 *
 * A VTU provisional result prints seven columns — subject code, subject name,
 * internal, external, total, a one-letter result, and the date it was announced
 * — and prints no grade, no grade point, no credits and no SGPA at all. This
 * page used to ask for exactly the three things the card does not print and had
 * nowhere to put the five it does, so a student copying their own card had to
 * invent a grade before anything would save (OQ-049).
 *
 * It now asks for what the card shows. Everything else is optional, stays
 * missing when it is missing, and is labelled where it is calculated.
 *
 * ---------------------------------------------------------------------------
 * SOURCE AND CALCULATED ARE NEVER MIXED
 * ---------------------------------------------------------------------------
 *
 * `domain/results.ts` computes; nothing here does. A calculated total, grade or
 * backlog state is shown NEXT TO the printed one, labelled, and never written
 * over it. Where the two disagree, both stay on screen — a disagreement usually
 * means a transcription slip, and hiding either one hides the slip.
 *
 * Results are entered by the student. GradTools does not retrieve them from any
 * university system, and does not read result cards from images (docs/15 §15.5).
 */

import { useMemo, useState } from 'react';
import { calculateCGPA, vtu2022RuleSet } from '@gradtools/academic-rules';
import type { Subject } from '@gradtools/shared-types';
import type { ResultSubject, SemesterResult } from '../../domain/types.js';
import { RESULT_STATUSES } from '../../domain/types.js';
import {
  evaluateResultSubject,
  normalizeResultSubject,
  semesterBacklogs,
  semesterSgpa,
  validateResultSubject,
  type ResultSubjectField,
  type SubjectEvaluation,
} from '../../domain/results.js';
import { ruleSetForResult } from '../../domain/academics.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { PageHeader } from '../../components/AppShell.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  EmptyState,
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
import { useSubjects } from '../../hooks/useReference.js';
import styles from './results.module.css';

const ruleSet = vtu2022RuleSet;

/** What a missing value reads as. Said the same way everywhere (§4, §22). */
const ABSENT = 'Not available';

function markText(value: number | null): string {
  return value === null ? '—' : String(value);
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function ResultsPage() {
  const { items, loading, save, remove } = useResults();
  const { profile } = useProfile();
  /** The result being edited, `'new'` while adding, null when neither. */
  const [editing, setEditing] = useState<SemesterResult | 'new' | null>(null);
  const [view, setView] = useState('overview');

  /*
   * Whether any saved semester's grade card and calculated SGPA disagree. The
   * REASON a disagreement matters is worth one sentence and is said ONCE here
   * (M9.3 §24); each semester that disagrees then needs only its two figures.
   */
  const anyMismatch = items.some((item) => {
    if (item.sgpaAsserted === null) return false;
    const { sgpa } = semesterSgpa(item, ruleSetForResult(item).ruleSet);
    return sgpa !== null && Math.abs(sgpa - item.sgpaAsserted) >= 0.005;
  });

  return (
    <>
      <PageHeader
        title="Results"
        subtitle="Enter a result card as it is printed. SGPA, CGPA and backlogs follow from it."
        action={
          <Button
            variant="primary"
            onClick={() => {
              setEditing((current) => (current === null ? 'new' : null));
            }}
          >
            <Icon name="plus" size="nav" />
            {editing === null ? 'Add a semester' : 'Cancel'}
          </Button>
        }
      />

      <div className={styles.stack}>
        <Notice>
          GradTools does not fetch results from the university portal. That site asks automated
          tools not to access it, and we respect that. We never ask for your portal password either.
          Enter a result once and everything else works from there.
        </Notice>

        {anyMismatch && (
          <p className={styles.mismatchHelp}>
            Where a grade card and the calculated figure disagree, GradTools shows both rather than
            picking one. It usually means a subject entry has a typo, or a grade needs checking.
          </p>
        )}

        {editing !== null && (
          <ResultEditor
            key={editing === 'new' ? 'new' : editing.id}
            existing={editing === 'new' ? null : editing}
            profileId={profile?.id ?? asStudentProfileId('local')}
            schemeId={profile?.schemeId ?? ruleSet.schemeId}
            branch={profile?.branch ?? null}
            onCancel={() => {
              setEditing(null);
            }}
            onSave={(result) => {
              void save(result);
              setEditing(null);
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
                  setEditing('new');
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
                        onEdit={() => {
                          setEditing(result);
                        }}
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

/**
 * One row being typed.
 *
 * Every mark is held as a STRING while the student types, because "" and 0 are
 * different answers and a number-typed state cannot hold the first one. The
 * conversion to `ResultSubject` is where "" becomes null — which is what an
 * empty column on a card means.
 */
interface DraftSubject {
  readonly id: string;
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly internal: string;
  readonly external: string;
  readonly total: string;
  readonly resultStatus: string;
  readonly gradeLetter: string;
  readonly credits: string;
  /** Tri-state, because unknown must be expressible (DEC-037). */
  readonly hasSee: 'yes' | 'no' | 'unknown';
  readonly fromCatalogue: boolean;
  /** Carried through untouched: the editor never offers to change a source grade point. */
  readonly gradePoint: number | null;
}

function blankSubject(): DraftSubject {
  return {
    id: newId(),
    subjectCode: '',
    subjectTitle: '',
    internal: '',
    external: '',
    total: '',
    resultStatus: '',
    gradeLetter: '',
    credits: '',
    hasSee: 'unknown',
    fromCatalogue: false,
    gradePoint: null,
  };
}

function toDraft(subject: ResultSubject): DraftSubject {
  return {
    id: subject.id,
    subjectCode: subject.subjectCode,
    subjectTitle: subject.subjectTitle,
    internal: subject.internal === null ? '' : String(subject.internal),
    external: subject.external === null ? '' : String(subject.external),
    total: subject.total === null ? '' : String(subject.total),
    resultStatus: subject.resultStatus ?? '',
    gradeLetter: subject.gradeLetter ?? '',
    credits: subject.credits === null ? '' : String(subject.credits),
    hasSee: subject.hasSee === null ? 'unknown' : subject.hasSee ? 'yes' : 'no',
    fromCatalogue: subject.provenance === 'catalogue',
    gradePoint: subject.gradePoint,
  };
}

/**
 * A typed row as a stored one.
 *
 * `normalizeResultSubject` does the "" → null conversion, so the editor and the
 * storage boundary cannot disagree about what an empty field means.
 */
function toSubject(draft: DraftSubject, announcedOn: string): ResultSubject {
  return normalizeResultSubject({
    id: draft.id,
    subjectCode: draft.subjectCode.trim().toUpperCase(),
    subjectTitle:
      draft.subjectTitle.trim() === ''
        ? draft.subjectCode.trim().toUpperCase()
        : draft.subjectTitle.trim(),
    internal: draft.internal,
    external: draft.external,
    total: draft.total,
    resultStatus: draft.resultStatus,
    announcedOn,
    gradeLetter: draft.gradeLetter,
    gradePoint: draft.gradePoint,
    credits: draft.credits,
    hasSee: draft.hasSee === 'unknown' ? null : draft.hasSee === 'yes',
    provenance: draft.fromCatalogue ? 'catalogue' : 'manual',
  });
}

function ResultEditor({
  existing,
  profileId,
  schemeId,
  branch,
  onSave,
  onCancel,
}: {
  readonly existing: SemesterResult | null;
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly schemeId: string;
  readonly branch: string | null;
  readonly onSave: (result: SemesterResult) => void;
  readonly onCancel: () => void;
}) {
  const [semester, setSemester] = useState(String(existing?.semester ?? 3));
  const [sgpaAsserted, setSgpaAsserted] = useState(
    existing?.sgpaAsserted === null || existing === null ? '' : String(existing.sgpaAsserted),
  );
  const [announcedOn, setAnnouncedOn] = useState(
    existing?.subjects.find((subject) => subject.announcedOn !== null)?.announcedOn ?? '',
  );
  const [subjects, setSubjects] = useState<DraftSubject[]>(() =>
    existing === null ? [blankSubject()] : existing.subjects.map(toDraft),
  );
  const [showErrors, setShowErrors] = useState(false);

  /*
   * The catalogue for the chosen semester. It is what makes credits and SEE
   * applicability authoritative rather than typed (§6, §11, §15) — and it is
   * OPTIONAL: when the server is unreachable the picker simply is not offered
   * and every row is entered manually, because a local-first app cannot make
   * entering your own marks depend on a network call (§26).
   */
  const catalogue = useSubjects(schemeId, branch ?? undefined, Number(semester));
  const options = catalogue.state.status === 'ready' ? catalogue.state.data : [];

  const update = (id: string, patch: Partial<DraftSubject>) => {
    setSubjects((current) =>
      current.map((subject) => (subject.id === id ? { ...subject, ...patch } : subject)),
    );
  };

  /**
   * Choosing a catalogued subject fills in what the catalogue knows.
   *
   * The code, the title, the credits and whether the course has a SEE, all in
   * one action — so the student never types metadata GradTools already holds
   * (§19). Choosing "enter manually" clears only the identity, not the marks
   * that have already been typed into the row.
   */
  const pick = (draft: DraftSubject, subject: Subject | null) => {
    update(
      draft.id,
      subject === null
        ? {
            subjectCode: '',
            subjectTitle: '',
            credits: '',
            hasSee: 'unknown',
            fromCatalogue: false,
          }
        : {
            subjectCode: subject.code,
            subjectTitle: subject.title,
            credits: String(subject.credits),
            hasSee: subject.hasSee ? 'yes' : 'no',
            fromCatalogue: true,
          },
    );
  };

  const rows = subjects.map((draft) => ({
    draft,
    subject: toSubject(draft, announcedOn),
  }));
  const issues = new Map(
    rows.map(({ draft, subject }) => [draft.id, validateResultSubject(subject, ruleSet)]),
  );
  const invalid = [...issues.values()].some((list) => list.length > 0);

  const errorFor = (id: string, field: ResultSubjectField): string | undefined => {
    if (!showErrors) return undefined;
    return issues.get(id)?.find((issue) => issue.field === field)?.message;
  };

  const commit = () => {
    if (invalid) {
      setShowErrors(true);
      return;
    }
    onSave({
      id: existing?.id ?? newId(),
      profileId,
      semester: Number(semester),
      schemeId: existing?.schemeId ?? ruleSet.schemeId,
      /*
       * PINNED AT ENTRY, and kept on edit. A later rule set must never silently
       * re-grade a semester that has already been sat, and editing a typo in
       * one mark is not a reason to re-pin the whole semester (M6 §6).
       */
      ruleSetId: existing?.ruleSetId ?? ruleSet.id,
      sgpaAsserted: sgpaAsserted.trim() === '' ? null : Number(sgpaAsserted),
      subjects: rows.map((row) => row.subject),
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  };

  return (
    <Panel
      title={
        existing === null ? 'New semester result' : `Editing semester ${String(existing.semester)}`
      }
      flush
    >
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
          label="Announced on"
          hint="The date printed on the card. Optional."
          type="date"
          value={announcedOn}
          onChange={(event) => {
            setAnnouncedOn(event.target.value);
          }}
        />
        <TextField
          label="SGPA printed on your grade card"
          hint="Optional. A provisional result does not print one."
          inputMode="decimal"
          placeholder="8.43"
          value={sgpaAsserted}
          onChange={(event) => {
            setSgpaAsserted(event.target.value);
          }}
        />
      </div>

      <ul className={styles.subjectRows}>
        {rows.map(({ draft }, index) => {
          const position = String(index + 1);
          return (
            <li className={styles.editorRow} key={draft.id}>
              <div className={styles.editorSubject}>
                {options.length > 0 && (
                  <SelectField
                    label={`Subject ${position}`}
                    value={draft.fromCatalogue ? draft.subjectCode : ''}
                    onChange={(event) => {
                      pick(
                        draft,
                        options.find((subject) => subject.code === event.target.value) ?? null,
                      );
                    }}
                  >
                    <option value="">Enter manually</option>
                    {options.map((subject) => (
                      <option key={subject.id} value={subject.code}>
                        {subject.code} — {subject.title}
                      </option>
                    ))}
                  </SelectField>
                )}
                <TextField
                  label={options.length > 0 ? `Code ${position}` : `Subject code ${position}`}
                  placeholder="BCS301"
                  mono
                  readOnly={draft.fromCatalogue}
                  value={draft.subjectCode}
                  error={errorFor(draft.id, 'subjectCode')}
                  onChange={(event) => {
                    update(draft.id, { subjectCode: event.target.value });
                  }}
                />
                <TextField
                  label={`Subject name ${position}`}
                  hint={draft.fromCatalogue ? undefined : 'Optional.'}
                  readOnly={draft.fromCatalogue}
                  value={draft.subjectTitle}
                  onChange={(event) => {
                    update(draft.id, { subjectTitle: event.target.value });
                  }}
                />
              </div>

              <TextField
                label={`Internal ${position}`}
                inputMode="numeric"
                value={draft.internal}
                error={errorFor(draft.id, 'internal')}
                onChange={(event) => {
                  update(draft.id, { internal: event.target.value });
                }}
              />
              <TextField
                label={`External ${position}`}
                hint={draft.hasSee === 'no' ? 'No SEE' : undefined}
                inputMode="numeric"
                value={draft.external}
                error={errorFor(draft.id, 'external')}
                onChange={(event) => {
                  update(draft.id, { external: event.target.value });
                }}
              />
              <TextField
                label={`Total ${position}`}
                inputMode="numeric"
                value={draft.total}
                error={errorFor(draft.id, 'total')}
                onChange={(event) => {
                  update(draft.id, { total: event.target.value });
                }}
              />
              <SelectField
                label={`Result ${position}`}
                value={draft.resultStatus}
                onChange={(event) => {
                  update(draft.id, { resultStatus: event.target.value });
                }}
              >
                <option value="">—</option>
                {RESULT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </SelectField>
              {/*
                SEE APPLICABILITY IS ASKED, NEVER INFERRED (§11, DEC-037). The
                catalogue answers it where it can; where it cannot, "Not sure"
                is a real answer that leaves the backlog state unknown rather
                than guessing it from an external of 0.
              */}
              <SelectField
                label={`Semester-end exam ${position}`}
                value={draft.hasSee}
                onChange={(event) => {
                  update(draft.id, { hasSee: event.target.value as DraftSubject['hasSee'] });
                }}
              >
                <option value="unknown">Not sure</option>
                <option value="yes">Yes</option>
                <option value="no">No — internal only</option>
              </SelectField>
              <TextField
                label={`Credits ${position}`}
                hint={draft.fromCatalogue ? 'From the catalogue' : undefined}
                inputMode="decimal"
                value={draft.credits}
                error={errorFor(draft.id, 'credits')}
                onChange={(event) => {
                  update(draft.id, { credits: event.target.value });
                }}
              />
              <SelectField
                label={`Grade ${position}`}
                hint="Only if your card prints one."
                value={draft.gradeLetter}
                onChange={(event) => {
                  update(draft.id, { gradeLetter: event.target.value });
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
                aria-label={`Remove subject ${position}`}
                disabled={subjects.length === 1}
                onClick={() => {
                  setSubjects((current) =>
                    current.filter((candidate) => candidate.id !== draft.id),
                  );
                }}
              >
                <Icon name="trash" size="nav" />
              </Button>
            </li>
          );
        })}
      </ul>

      {showErrors && invalid && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">
            Some rows do not match the card. Nothing is corrected for you — check the marks against
            what is printed.
          </Notice>
        </div>
      )}

      <div className={styles.editorActions}>
        <Button
          onClick={() => {
            setSubjects((current) => [...current, blankSubject()]);
          }}
        >
          <Icon name="plus" size="nav" />
          Add subject
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={commit}>
          {existing === null ? 'Save semester' : 'Save changes'}
        </Button>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cumulative standing, and one quiet row per semester.
 *
 * Every figure comes from the rules engine through `semesterSgpa`, which is
 * also what decides that an incomplete semester has no SGPA — so a provisional
 * result appears in the ledger with its subjects and credits and an em dash
 * where a figure would mislead.
 */
function ResultsOverview({ items }: { readonly items: readonly SemesterResult[] }) {
  const perSemester = [...items]
    .sort((a, b) => a.semester - b.semester)
    .map((result) => {
      const { ruleSet: resolved } = ruleSetForResult(result);
      const graded = semesterSgpa(result, resolved);
      return { result, ...graded, ...semesterBacklogs(result, resolved) };
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
  const backlogs = perSemester.reduce((total, entry) => total + entry.backlogs, 0);
  const undetermined = perSemester.reduce((total, entry) => total + entry.undetermined, 0);

  return (
    <div className={styles.overview}>
      <MetricStrip
        metrics={[
          { label: 'CGPA', value: cgpa.ok ? formatGpa(cgpa.value) : '—' },
          { label: 'Semesters', value: String(perSemester.length) },
          { label: 'Subjects', value: String(subjects) },
          {
            label: 'Backlogs',
            value: undetermined > 0 ? `${String(backlogs)}+` : String(backlogs),
          },
          { label: 'Credits', value: String(totalCredits) },
        ]}
      />

      {/*
        A "+" ON A BACKLOG COUNT IS NOT DECORATION. Where a row's SEE
        applicability is unknown its pass state cannot be worked out, so the
        count is a floor rather than a total — and the number a student most
        needs to be right about must not quietly read as complete.
      */}
      {undetermined > 0 && (
        <p className={styles.mismatchHelp}>
          {String(undetermined)} subject{undetermined === 1 ? '' : 's'} could not be checked for a
          backlog, because whether the course has a semester-end exam is not recorded. The backlog
          count is at least {String(backlogs)}.
        </p>
      )}

      <ol className={styles.ledger}>
        {perSemester.map((entry) => (
          <li key={entry.result.id} className={styles.ledgerRow}>
            <span className={styles.ledgerSemester}>S{entry.result.semester}</span>
            <span className={styles.ledgerMeta}>
              {entry.result.subjects.length} subjects
              {entry.credits > 0 ? ` · ${String(entry.credits)} credits` : ''}
              {entry.backlogs > 0 ? ` · ${String(entry.backlogs)} backlog` : ''}
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

/* -------------------------------------------------------------------------- */
/* One saved semester                                                         */
/* -------------------------------------------------------------------------- */

function SavedResult({
  result,
  onEdit,
  onRemove,
}: {
  readonly result: SemesterResult;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const [detail, setDetail] = useState<ResultSubject | null>(null);
  const resolved = ruleSetForResult(result);
  const { sgpa, credits, inputs } = semesterSgpa(result, resolved.ruleSet);
  const { backlogs, undetermined } = semesterBacklogs(result, resolved.ruleSet);

  const evaluations = useMemo(
    () =>
      new Map(
        result.subjects.map((subject) => [
          subject.id,
          evaluateResultSubject(subject, resolved.ruleSet),
        ]),
      ),
    [result.subjects, resolved.ruleSet],
  );

  /*
   * Normalised with `?? null`, exactly as `domain/results.ts` does. The type
   * says `number | null`, but this record came out of IndexedDB and nothing
   * type-checks it at runtime: a row written before the field existed carries
   * `undefined`, `asserted !== null` is then TRUE, and `formatGpa(undefined)`
   * throws and takes the page down. Found by the M9.6B browser sweep.
   */
  const asserted = result.sgpaAsserted ?? null;
  const discrepancy =
    sgpa !== null && asserted !== null && Math.abs(sgpa - asserted) >= 0.005
      ? { computed: sgpa, asserted }
      : null;

  return (
    <section className={styles.semester} aria-labelledby={`sem-${String(result.semester)}`}>
      <div className={styles.semesterHead}>
        <div className={styles.semesterIdentity}>
          <h3 className={styles.semesterTitle} id={`sem-${String(result.semester)}`}>
            Semester {result.semester}
          </h3>
          <span className={styles.semesterMeta}>
            {result.subjects.length} subjects
            {credits > 0 ? ` · ${String(credits)} credits` : ''}
          </span>
        </div>

        <dl className={styles.semesterFigures}>
          <div>
            <dt>SGPA</dt>
            <dd>{sgpa === null ? '—' : formatGpa(sgpa)}</dd>
          </div>
          {asserted !== null ? (
            <div>
              <dt>Grade card</dt>
              <dd data-muted="true">{formatGpa(asserted)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Backlogs</dt>
            <dd>{undetermined > 0 ? `${String(backlogs)}+` : String(backlogs)}</dd>
          </div>
        </dl>

        <DropdownMenu
          label={`Actions for semester ${String(result.semester)}`}
          items={[
            { label: 'Edit this semester', icon: 'edit', onSelect: onEdit },
            { label: 'Delete this semester', icon: 'trash', onSelect: onRemove, tone: 'danger' },
          ]}
        />
      </div>

      {discrepancy ? (
        <p className={styles.mismatch}>
          Grade card {formatGpa(discrepancy.asserted)} · calculated{' '}
          {formatGpa(discrepancy.computed)} — these disagree.
        </p>
      ) : null}

      {/*
        WHY THERE IS NO SGPA, WHEN THERE IS NONE (§4, §16). "—" alone reads as a
        failure of the app; naming the rows that are missing a grade or credits
        turns it into something the student can finish.
      */}
      {sgpa === null && inputs.missing.length > 0 ? (
        <p className={styles.mismatch}>
          No SGPA yet — SGPA needs a grade and credits for every subject, and{' '}
          {inputs.missing.map((entry) => entry.subjectCode).join(', ')} still{' '}
          {inputs.missing.length === 1 ? 'has' : 'have'} none. The marks below are unaffected.
        </p>
      ) : null}

      {resolved.resolution === 'unavailable' ? (
        <div className={styles.discrepancy}>
          <Notice tone="warning">
            This semester was graded under rule set {resolved.missingRuleSetId ?? ''}, which this
            version of GradTools does not have. Nothing is calculated from it — no other rule set is
            substituted.
          </Notice>
        </div>
      ) : null}

      {/*
        DESKTOP: the card's own columns. MOBILE: the same rows as buttons that
        open a sheet (§21) — eight columns cannot be shown at 390px and must not
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
                  Internal
                </th>
                <th scope="col" className={numericClass}>
                  External
                </th>
                <th scope="col" className={numericClass}>
                  Total
                </th>
                <th scope="col" className={numericClass}>
                  Grade
                </th>
                <th scope="col">Result</th>
                <th scope="col" className={numericClass}>
                  Credits
                </th>
              </tr>
            </thead>
            <tbody>
              {result.subjects.map((subject) => {
                const evaluation = evaluations.get(subject.id);
                const grade = subject.gradeLetter ?? evaluation?.computedGrade?.letter ?? null;
                return (
                  <tr key={subject.id}>
                    <td>
                      <span className={styles.subjectName}>{subject.subjectTitle}</span>
                      <span className={`${styles.subjectCode ?? ''} ${monoClass}`}>
                        {subject.subjectCode}
                      </span>
                    </td>
                    <td className={numericClass}>{markText(subject.internal)}</td>
                    <td className={numericClass}>
                      {subject.hasSee === false ? '—' : markText(subject.external)}
                    </td>
                    <td className={numericClass}>{markText(subject.total)}</td>
                    <td className={numericClass}>
                      {grade === null ? (
                        <span className={styles.absent}>—</span>
                      ) : (
                        <StatusPill tone="neutral">{grade}</StatusPill>
                      )}
                    </td>
                    <td>
                      <BacklogMark
                        evaluation={evaluation}
                        status={subject.resultStatus}
                        hasSee={subject.hasSee}
                      />
                    </td>
                    <td className={numericClass}>
                      {subject.credits === null ? '—' : subject.credits}
                    </td>
                  </tr>
                );
              })}
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
              onClick={() => {
                setDetail(subject);
              }}
              aria-haspopup="dialog"
            >
              <span className={styles.subjectRowText}>
                <span className={styles.subjectName}>{subject.subjectTitle}</span>
                <span className={`${styles.subjectCode ?? ''} ${monoClass}`}>
                  {subject.subjectCode} ·{' '}
                  {subject.total === null
                    ? `${markText(subject.internal)} internal`
                    : `${String(subject.total)} total`}
                </span>
              </span>
              <BacklogMark
                evaluation={evaluations.get(subject.id)}
                status={subject.resultStatus}
                hasSee={subject.hasSee}
              />
              <Icon name="chevronRight" size="small" />
            </button>
          </li>
        ))}
      </ul>

      <Sheet
        open={detail !== null}
        onClose={() => {
          setDetail(null);
        }}
        side="bottom"
        title={detail?.subjectTitle ?? ''}
        description={`Semester ${String(result.semester)}`}
      >
        {detail !== null ? (
          <SubjectDetail subject={detail} evaluation={evaluations.get(detail.id)} />
        ) : null}
      </Sheet>
    </section>
  );
}

/**
 * The printed status, or the calculated one, or neither.
 *
 * A card that prints a status is showing what the university decided, and that
 * is what leads. The calculated pass/backlog state appears only where there is
 * no printed one — never over it (§3, §22).
 */
function BacklogMark({
  evaluation,
  status,
  hasSee,
}: {
  readonly evaluation: SubjectEvaluation | undefined;
  readonly status: string | null;
  readonly hasSee: boolean | null;
}) {
  if (status !== null) {
    return <StatusPill tone={status === 'P' ? 'success' : 'neutral'}>{status}</StatusPill>;
  }
  if (evaluation?.backlog === true) return <StatusPill tone="danger">Backlog</StatusPill>;
  if (evaluation?.backlog === false) return <StatusPill tone="success">Passed</StatusPill>;
  /*
   * NOT A WARNING TONE (§28). "We do not know whether this course has a
   * semester-end exam" is a gap in the record, not bad news about the student's
   * marks, and colouring it red would alarm somebody who has passed.
   */
  return <StatusPill tone="neutral">{hasSee === null ? 'SEE unknown' : 'Not checked'}</StatusPill>;
}

/** Everything one row holds, source first and calculated second, each labelled. */
function SubjectDetail({
  subject,
  evaluation,
}: {
  readonly subject: ResultSubject;
  readonly evaluation: SubjectEvaluation | undefined;
}) {
  const seeMax = ruleSet.courseMax - ruleSet.cieMax;
  /*
   * Narrowed once, here, rather than at each `?.` below. A row whose evaluation
   * is undefined and one whose calculated grade is null read the same on screen
   * — "Not available" — and collapsing the two states up front keeps the JSX
   * from having to distinguish them three times over.
   */
  const computedGrade = evaluation?.computedGrade ?? null;
  const sourcePoints = evaluation?.sourceGrade?.points ?? null;
  const computedPoints = computedGrade?.points ?? null;

  return (
    <dl className={styles.detailList}>
      <div>
        <dt>Subject code</dt>
        <dd className={monoClass}>{subject.subjectCode}</dd>
      </div>
      <div>
        <dt>Internal / CIE</dt>
        <dd>{subject.internal === null ? ABSENT : `${String(subject.internal)}`}</dd>
      </div>
      {/*
        THE SEE ROW IS THE ONE THAT MUST NOT LIE (§9, §11, §28). A CIE-only
        course reads "Not applicable" rather than "0 / 50" — a zero next to a
        maximum says the student sat an exam and scored nothing.
      */}
      <div>
        <dt>External / SEE contribution</dt>
        <dd>
          {subject.hasSee === false
            ? 'Not applicable — this course has no semester-end exam'
            : subject.external === null
              ? ABSENT
              : `${String(subject.external)} / ${String(seeMax)}`}
        </dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd>
          {subject.total === null
            ? evaluation?.computedTotal === null || evaluation === undefined
              ? ABSENT
              : `${String(evaluation.computedTotal)} · calculated`
            : `${String(subject.total)} · from the card`}
        </dd>
      </div>
      {evaluation?.totalDisagrees === true ? (
        <div>
          <dt>Total does not add up</dt>
          <dd>
            The card prints {String(subject.total)}, the columns add to{' '}
            {String(evaluation.computedTotal)}. Both are shown; neither is corrected.
          </dd>
        </div>
      ) : null}
      <div>
        <dt>Result</dt>
        <dd>{subject.resultStatus ?? ABSENT}</dd>
      </div>
      <div>
        <dt>Grade</dt>
        <dd>
          {subject.gradeLetter !== null
            ? `${subject.gradeLetter} · from the card`
            : computedGrade !== null
              ? `${computedGrade.letter} · calculated`
              : ABSENT}
        </dd>
      </div>
      <div>
        <dt>Grade point</dt>
        <dd>
          {subject.gradePoint !== null
            ? `${String(subject.gradePoint)} · from the card`
            : sourcePoints !== null
              ? `${String(sourcePoints)} · calculated`
              : computedPoints !== null
                ? `${String(computedPoints)} · calculated`
                : ABSENT}
        </dd>
      </div>
      <div>
        <dt>Credits</dt>
        <dd>
          {subject.credits === null
            ? ABSENT
            : `${String(subject.credits)}${subject.provenance === 'catalogue' ? ' · from the catalogue' : ''}`}
        </dd>
      </div>
      <div>
        <dt>Backlog</dt>
        <dd>
          {evaluation === undefined || evaluation.backlog === null
            ? `Not known — ${evaluation?.unavailableReason ?? 'not enough information'}`
            : evaluation.backlog
              ? 'Yes'
              : 'No'}
        </dd>
      </div>
      {subject.announcedOn !== null ? (
        <div>
          <dt>Announced on</dt>
          <dd>{subject.announcedOn}</dd>
        </div>
      ) : null}
      {subject.provenance === 'manual' ? (
        <div>
          <dt>Subject</dt>
          <dd>Entered manually — not matched to the subject catalogue</dd>
        </div>
      ) : null}
    </dl>
  );
}
