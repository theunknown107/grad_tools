/**
 * Attendance overview and bunk planner.
 *
 * Authority: docs/03 UF-07, docs/16 §16.7/§16.9, M3 continuation §17-§18.
 *
 * ---------------------------------------------------------------------------
 * TONE
 * ---------------------------------------------------------------------------
 * This screen reports arithmetic. It never advises a student to skip a class,
 * and never moralises about whether they should (docs/19 §19.11, docs/28
 * §28.6). "You can miss 3 more and stay above 85%" is arithmetic. "You should
 * skip tomorrow" is advice, and GradTools does not give it.
 *
 * Condonation is shown as DISCRETIONARY, never as an entitlement: the Vice
 * Chancellor may condone up to 10 points on the Principal's recommendation
 * with documented grounds (22OB 3.7(1)).
 */

import { useMemo, useState } from 'react';
import {
  calculateAttendance,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
  vtu2022RuleSet,
  type AttendanceStatus,
} from '@gradtools/academic-rules';
import type { AttendanceRecord, SemesterSubject } from '../../domain/types.js';
import { PageHeader } from '../../components/AppShell.js';
import { Plus, Trash2 } from '../../components/icons.js';
import {
  Button,
  EmptyState,
  ExplanationDisclosure,
  Notice,
  Panel,
  StatusPill,
  statusIcons,
  TextField,
  type PillTone,
} from '../../components/ui/index.js';
import { formatCount, formatPercent } from '../../lib/format.js';
import { Bar, Row, Rows, Section } from '../../components/ui/layout.js';
import { newId, nowIso } from '../../lib/id.js';
import { useAttendance, useProfile, useSemesterSubjects } from '../../hooks/useCollection.js';
import { asStudentProfileId } from '../../domain/identity.js';
import styles from './attendance.module.css';

const ruleSet = vtu2022RuleSet;

const STATUS_PRESENTATION: Record<
  AttendanceStatus,
  { tone: PillTone; label: string; icon: (typeof statusIcons)[keyof typeof statusIcons] }
> = {
  safe: { tone: 'success', label: 'Safe', icon: statusIcons.safe },
  below_requirement: {
    tone: 'warning',
    label: 'Below requirement',
    icon: statusIcons.below,
  },
  dx_risk: { tone: 'danger', label: 'DX risk', icon: statusIcons.risk },
};

/** A course's real name, or null when the student has not entered one. */
function subjectName(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
}

export function AttendancePage() {
  const { items, loading, save, remove } = useAttendance();
  const { profile } = useProfile();

  const { items: semesterSubjects } = useSemesterSubjects();
  /* Whether the DX rule needs stating at all — said once, at the list. */
  const anyAtRisk = items.some((record) => {
    const verdict = calculateAttendance(record.attended, record.conducted, ruleSet);
    return verdict.ok && verdict.value.status === 'dx_risk';
  });
  const [subjectCode, setSubjectCode] = useState('');
  const [attended, setAttended] = useState('');
  const [conducted, setConducted] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const profileId = profile?.id ?? asStudentProfileId('local');

  const addRecord = () => {
    const attendedValue = Number(attended);
    const conductedValue = Number(conducted);

    if (subjectCode.trim() === '') {
      setFormError('Enter a subject code.');
      return;
    }
    if (!Number.isInteger(attendedValue) || !Number.isInteger(conductedValue)) {
      setFormError('Attended and conducted must be whole numbers.');
      return;
    }
    if (attendedValue > conductedValue) {
      setFormError(
        `Attended (${String(attendedValue)}) cannot be more than conducted (${String(conductedValue)}).`,
      );
      return;
    }
    if (attendedValue < 0 || conductedValue < 1) {
      setFormError('Enter the classes held so far and how many you attended.');
      return;
    }

    setFormError(undefined);
    void save({
      id: newId(),
      profileId,
      semester: profile?.currentSemester ?? 1,
      subjectCode: subjectCode.trim().toUpperCase(),
      // The semester list is the one place a subject is named; reuse its title
      // rather than storing the code twice.
      subjectTitle:
        semesterSubjects.find((subject) => subject.code === subjectCode.trim().toUpperCase())
          ?.title ?? subjectCode.trim().toUpperCase(),
      attended: attendedValue,
      conducted: conductedValue,
      updatedAt: nowIso(),
    });
    setSubjectCode('');
    setAttended('');
    setConducted('');
  };

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`The requirement is ${String(ruleSet.attendanceRequiredPct)}% per course (clause 22OB 3.7). Below ${String(ruleSet.attendanceDxFloorPct)}% a course is marked DX and you cannot sit its exam.`}
      />

      <div className={styles.stack}>
        <Panel title="Add a course" flush>
          <div className={styles.addRow}>
            {/*
              THE SUBJECT IS DEFINED ONCE (M6 §16). The semester's subject list
              suggests codes here rather than this screen keeping its own copy.
              Still free text, because a student may be tracking something they
              have not added to the semester yet.
            */}
            <TextField
              label="Subject code"
              placeholder="BCS304"
              mono
              list="semester-subject-codes"
              hint={
                semesterSubjects.length > 0 ? 'Your semester subjects are suggested.' : undefined
              }
              value={subjectCode}
              onChange={(event) => {
                setSubjectCode(event.target.value);
              }}
            />
            <datalist id="semester-subject-codes">
              {semesterSubjects.map((subject) => (
                <option key={subject.id} value={subject.code}>
                  {subject.title}
                </option>
              ))}
            </datalist>
            <TextField
              label="Attended"
              inputMode="numeric"
              placeholder="42"
              value={attended}
              onChange={(event) => {
                setAttended(event.target.value);
              }}
            />
            <TextField
              label="Conducted"
              inputMode="numeric"
              placeholder="50"
              value={conducted}
              onChange={(event) => {
                setConducted(event.target.value);
              }}
            />
            <Button variant="primary" onClick={addRecord}>
              <Plus size={16} aria-hidden="true" />
              Add
            </Button>
          </div>
          {formError !== undefined && (
            <div className={styles.formError} role="alert">
              <Notice tone="danger">{formError}</Notice>
            </div>
          )}
        </Panel>

        {loading ? null : items.length === 0 ? (
          <Panel title="Your courses" flush>
            <EmptyState>
              No courses added yet. Add the courses you are taking this semester and GradTools will
              show how many classes you can still miss.
            </EmptyState>
          </Panel>
        ) : (
          <Section
            title="Your courses"
            /*
             * No description here: the page subtitle already states the
             * requirement, and repeating it under the heading would be the same
             * mistake at a smaller scale. The per-row "85% required" caption is
             * gone for the same reason — the requirement belongs to the scheme,
             * not to each of six courses (M9.3 §13, M9.5).
             */
            action={
              /*
               * SAID ONCE, NOT PER COURSE (M9.3 §13). The DX rule used to be
               * repeated in full inside every at-risk card; with three such
               * courses a student read the same paragraph three times and the
               * page became mostly warning.
               */
              anyAtRisk ? <span className={styles.dxHint}>DX rule below</span> : undefined
            }
          >
            <Rows>
              {items.map((record) => (
                <AttendanceRow
                  key={record.id}
                  record={record}
                  name={subjectName(record.subjectCode, semesterSubjects)}
                  onRemove={() => void remove(record.id)}
                />
              ))}
            </Rows>
            {anyAtRisk && (
              <p className={styles.dxNote}>
                Below {String(ruleSet.attendanceDxFloorPct)}% a course is marked DX and you are not
                permitted to sit its Semester End Examination (clause 22OB 3.7(5)). A shortage of up
                to {String(ruleSet.attendanceCondonablePct)} points may be condoned by the Vice
                Chancellor on the Principal&rsquo;s recommendation with supporting documents. This
                is discretionary, not automatic.
              </p>
            )}
          </Section>
        )}

        <BunkPlanner records={items} />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-course card                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One course, as a row.
 *
 * WAS A CARD, AND SHOULD NOT HAVE BEEN (M9.3 §13, §26). Six courses meant six
 * large boxes with 40px figures and ragged heights, which made a page a student
 * scans into a page a student scrolls. As rows they can be compared down a
 * column, which is the only comparison that matters here.
 *
 * The figure a student came for — how many classes they can miss — stays on the
 * row rather than moving into a sub-panel. That is the answer; it does not need
 * a box around it.
 */
function AttendanceRow({
  record,
  name,
  onRemove,
}: {
  readonly record: AttendanceRecord;
  readonly name: string | null;
  readonly onRemove: () => void;
}) {
  const attendance = calculateAttendance(record.attended, record.conducted, ruleSet);
  const canMiss = calculateClassesCanMiss(record.attended, record.conducted, ruleSet);
  const mustAttend = calculateClassesMustAttend(record.attended, record.conducted, ruleSet);

  if (!attendance.ok) {
    return (
      <Row
        title={name ?? record.subjectCode}
        meta={attendance.detail}
        trailing={
          <Button
            variant="danger"
            iconOnly
            small
            aria-label={`Remove ${record.subjectCode}`}
            onClick={onRemove}
          >
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        }
      />
    );
  }

  const { percentage, status } = attendance.value;
  const tone = status === 'safe' ? 'default' : status === 'dx_risk' ? 'danger' : 'warning';

  /* One short sentence, not a labelled block. */
  const advice =
    canMiss.ok && canMiss.value > 0
      ? `Can miss ${formatCount(canMiss.value, 'class', 'classes')}`
      : mustAttend.ok && mustAttend.value > 0
        ? `Attend ${formatCount(mustAttend.value, 'class', 'classes')} in a row`
        : `Cannot miss any`;

  return (
    <Row
      title={name ?? record.subjectCode}
      meta={
        <>
          {name === null ? '' : `${record.subjectCode} · `}
          {record.attended} of {record.conducted} classes · {advice}
        </>
      }
      trailing={
        <span className={styles.rowFigures}>
          <span className={styles.rowPercent} data-tone={tone}>
            {formatPercent(percentage)}
          </span>
          <Bar value={percentage} tone={tone} label={`${name ?? record.subjectCode} attendance`} />
        </span>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Bunk planner                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Interactive planner: pick a course, say how many more classes will be held
 * and how many of them you would miss, and see the resulting attendance.
 *
 * The projected figure comes from calculateAttendance on the projected counts,
 * so the planner and the overview cannot disagree.
 */
function BunkPlanner({ records }: { records: readonly AttendanceRecord[] }) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [plannedClasses, setPlannedClasses] = useState('10');
  const [classesToMiss, setClassesToMiss] = useState('2');

  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) ?? records[0],
    [records, selectedId],
  );

  if (records.length === 0) {
    return (
      <Panel title="Bunk planner" flush>
        <EmptyState>
          Add a course above and you can plan against it here. It shows how many of the remaining
          classes you could miss, and what your attendance would be afterwards.
        </EmptyState>
      </Panel>
    );
  }

  if (!selected) return null;

  const planned = Number(plannedClasses);
  const missed = Number(classesToMiss);
  const inputsValid =
    Number.isInteger(planned) && Number.isInteger(missed) && planned >= 0 && missed >= 0;
  const missedExceedsPlanned = inputsValid && missed > planned;

  const projectedAttended = selected.attended + Math.max(0, planned - missed);
  const projectedConducted = selected.conducted + Math.max(0, planned);

  const projection =
    inputsValid && !missedExceedsPlanned
      ? calculateAttendance(projectedAttended, projectedConducted, ruleSet)
      : null;

  /* If the projection lands below the threshold, how many of the remaining
     classes would need to be attended instead. Still arithmetic, not advice. */
  const recovery =
    projection?.ok === true && projection.value.status !== 'safe'
      ? calculateClassesMustAttend(projectedAttended, projectedConducted, ruleSet)
      : null;

  return (
    <Panel title="Bunk planner" flush>
      <div className={styles.plannerControls}>
        <div className={styles.plannerField}>
          <label className={styles.plannerLabel} htmlFor="planner-subject">
            Course
          </label>
          <select
            id="planner-subject"
            className={styles.plannerSelect}
            value={selected.id}
            onChange={(event) => {
              setSelectedId(event.target.value);
            }}
          >
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.subjectCode} ({String(record.attended)}/{String(record.conducted)})
              </option>
            ))}
          </select>
        </div>

        <TextField
          label="Classes still to be held"
          inputMode="numeric"
          value={plannedClasses}
          onChange={(event) => {
            setPlannedClasses(event.target.value);
          }}
        />
        <TextField
          label="Of those, classes you would miss"
          inputMode="numeric"
          value={classesToMiss}
          error={missedExceedsPlanned ? 'Cannot miss more classes than will be held.' : undefined}
          onChange={(event) => {
            setClassesToMiss(event.target.value);
          }}
        />
      </div>

      {projection?.ok === true && (
        <div className={styles.plannerResult}>
          <div className={styles.plannerOutcome}>
            <span className={styles.answerLabel}>Attendance would become</span>
            <span className={styles.plannerFigure}>
              {formatPercent(projection.value.percentage)}
            </span>
            <span className={styles.answerNote}>
              {String(projectedAttended)} of {String(projectedConducted)} classes ·{' '}
              {String(projection.value.requiredPct)}% required
            </span>
          </div>

          <StatusPill
            tone={STATUS_PRESENTATION[projection.value.status].tone}
            icon={STATUS_PRESENTATION[projection.value.status].icon}
          >
            {STATUS_PRESENTATION[projection.value.status].label}
          </StatusPill>

          {recovery?.ok === true && recovery.value > 0 && (
            <p className={styles.plannerRecovery}>
              Reaching {String(projection.value.requiredPct)}% from there would take{' '}
              {formatCount(recovery.value, 'further class', 'further classes')} attended in a row.
            </p>
          )}

          <ExplanationDisclosure explanation={projection.explanation} />
        </div>
      )}
    </Panel>
  );
}
