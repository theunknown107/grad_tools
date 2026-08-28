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
import type { AttendanceRecord } from '../../domain/types.js';
import { PageHeader } from '../../components/AppShell.js';
import { Plus, Trash2 } from '../../components/icons.js';
import {
  Button,
  EmptyState,
  ExplanationDisclosure,
  Meter,
  Notice,
  Panel,
  StatusPill,
  statusIcons,
  TextField,
  type PillTone,
} from '../../components/ui/index.js';
import { formatCount, formatPercent } from '../../lib/format.js';
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

export function AttendancePage() {
  const { items, loading, save, remove } = useAttendance();
  const { profile } = useProfile();

  const { items: semesterSubjects } = useSemesterSubjects();
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
          <div className={styles.cards}>
            {items.map((record) => (
              <AttendanceCard
                key={record.id}
                record={record}
                onRemove={() => void remove(record.id)}
              />
            ))}
          </div>
        )}

        <BunkPlanner records={items} />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-course card                                                            */
/* -------------------------------------------------------------------------- */

function AttendanceCard({ record, onRemove }: { record: AttendanceRecord; onRemove: () => void }) {
  const attendance = calculateAttendance(record.attended, record.conducted, ruleSet);
  const canMiss = calculateClassesCanMiss(record.attended, record.conducted, ruleSet);
  const mustAttend = calculateClassesMustAttend(record.attended, record.conducted, ruleSet);

  if (!attendance.ok) {
    return (
      <Panel title={record.subjectCode}>
        <Notice tone="warning">{attendance.detail}</Notice>
      </Panel>
    );
  }

  const { percentage, status, requiredPct, dxFloorPct } = attendance.value;
  const presentation = STATUS_PRESENTATION[status];

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{record.subjectCode}</h3>
        <StatusPill tone={presentation.tone} icon={presentation.icon}>
          {presentation.label}
        </StatusPill>
        <Button
          variant="danger"
          iconOnly
          small
          aria-label={`Remove ${record.subjectCode}`}
          onClick={onRemove}
        >
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      </header>

      <p className={styles.percentage}>{formatPercent(percentage)}</p>
      <p className={styles.ratio}>
        {String(record.attended)} of {String(record.conducted)} classes attended
      </p>

      <div className={styles.meterWrap}>
        <Meter
          value={percentage}
          threshold={requiredPct}
          tone={
            status === 'safe' ? 'success' : status === 'below_requirement' ? 'warning' : 'danger'
          }
          label={`${record.subjectCode} attendance ${formatPercent(percentage)}`}
        />
        <div className={styles.meterLegend}>
          <span>0%</span>
          <span>{String(requiredPct)}% required</span>
          <span>100%</span>
        </div>
      </div>

      {/* The answer the student actually came for, stated as arithmetic. */}
      <div className={styles.answerBlock}>
        {canMiss.ok && canMiss.value > 0 ? (
          <>
            <span className={styles.answerLabel}>You can miss</span>
            <span className={styles.answerFigure}>
              {formatCount(canMiss.value, 'class', 'classes')}
            </span>
            <span className={styles.answerNote}>and stay at or above {String(requiredPct)}%.</span>
          </>
        ) : mustAttend.ok && mustAttend.value > 0 ? (
          <>
            <span className={styles.answerLabel}>To reach {String(requiredPct)}%</span>
            <span className={styles.answerFigure}>
              attend {formatCount(mustAttend.value, 'class', 'classes')}
            </span>
            <span className={styles.answerNote}>
              in a row, with none missed.
              {/*
                docs/16 §16.9: a recovery figure larger than the classes held so
                far is very likely more than the semester has left, and telling a
                student to attend 84 consecutive classes is noise rather than
                advice. The engine only knows it is unreachable when it is given
                the remaining count, which this card does not have — so instead of
                inventing one, say so and point at the planner, which does ask.
              */}
              {mustAttend.value > record.conducted && (
                <>
                  {' '}
                  That is likely more classes than remain this semester. The planner below can check
                  it against your actual remaining classes.
                </>
              )}
            </span>
          </>
        ) : (
          <>
            <span className={styles.answerLabel}>You can miss</span>
            <span className={styles.answerFigure}>0 classes</span>
            <span className={styles.answerNote}>
              without dropping below {String(requiredPct)}%.
            </span>
          </>
        )}
      </div>

      {status === 'dx_risk' && (
        <div className={styles.cardNotice}>
          <Notice tone="danger">
            Below {String(dxFloorPct)}% a course is marked DX and you are not permitted to sit its
            Semester End Examination (clause 22OB 3.7(5)). Shortage of up to{' '}
            {String(ruleSet.attendanceCondonablePct)} points may be condoned by the Vice Chancellor
            on the Principal&rsquo;s recommendation with supporting documents. This is
            discretionary, not automatic.
          </Notice>
        </div>
      )}

      <ExplanationDisclosure explanation={attendance.explanation} />
    </section>
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
