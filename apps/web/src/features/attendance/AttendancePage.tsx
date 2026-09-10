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

import { useState } from 'react';
import {
  calculateAttendance,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
  vtu2022RuleSet,
  type AttendanceStatus,
} from '@gradtools/academic-rules';
import type { AttendanceRecord, SemesterSubject } from '../../domain/types.js';
import { markClass, type ClassOutcome } from '../../domain/attendance.js';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  EmptyState,
  ExplanationDisclosure,
  monoClass,
  Notice,
  Panel,
  StatusPill,
  statusIcons,
  TextField,
  type PillTone,
} from '../../components/ui/index.js';
import { formatCount, formatPercent } from '../../lib/format.js';
import { MetricStrip } from '../../components/ui/layout.js';
import { Tooltip } from '../../components/ui/Tooltip.js';
import { Sheet } from '../../components/ui/Sheet.js';
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

/** The verdict, as a tone. Derived from the ENGINE's status, never a threshold. */
const TONE_OF: Record<AttendanceStatus, 'safe' | 'warning' | 'danger'> = {
  safe: 'safe',
  below_requirement: 'warning',
  dx_risk: 'danger',
};

/** A course's real name, or null when the student has not entered one. */
function subjectName(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
}

/**
 * The overall figure, and the one sentence that follows from it.
 *
 * M9.6F §9: the page answers "can I miss this class". A per-subject list
 * answers it subject by subject and never answers it for the semester, which
 * is the question a student asks first.
 *
 * Computed by the rules engine over the pooled totals — NOT an average of the
 * per-subject percentages. Averaging percentages weights a 12-class lab the
 * same as a 60-class lecture and produces a number that is nobody's attendance.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE DESIGN'S CHART
 * ---------------------------------------------------------------------------
 *
 * The approved design draws attendance over time, with the threshold as a
 * reference line. GradTools stores attendance as COUNTS, not as per-class
 * events (docs/08 §8.9) — there is no week-by-week history to plot, and
 * inventing one would be fabricating the student's own record.
 *
 * So the same fact is drawn the way the data supports it: the standing against
 * both thresholds, on one track, with each threshold marked where it falls.
 */
function OverallStanding({ items }: { readonly items: readonly AttendanceRecord[] }) {
  const attended = items.reduce((total, record) => total + record.attended, 0);
  const conducted = items.reduce((total, record) => total + record.conducted, 0);
  if (conducted === 0) return null;

  const overall = calculateAttendance(attended, conducted, ruleSet);
  if (!overall.ok) return null;

  const { percentage, status } = overall.value;

  return (
    <Panel title="Where you stand">
      <div className={styles.gaugeFigure}>
        <span className={styles.gaugeValue} data-tone={TONE_OF[status]}>
          {formatPercent(percentage)}
        </span>
        <StatusPill tone={STATUS_PRESENTATION[status].tone} icon={STATUS_PRESENTATION[status].icon}>
          {STATUS_PRESENTATION[status].label}
        </StatusPill>
      </div>

      <div className={styles.gauge}>
        <span className={styles.gaugeTrack} aria-hidden="true">
          <span
            className={styles.gaugeFill}
            data-tone={TONE_OF[status]}
            style={{ inlineSize: `${String(Math.max(0, Math.min(100, percentage)))}%` }}
          />
          {/* Both thresholds, where they actually fall on the scale. */}
          <span
            className={styles.gaugeMark}
            data-kind="floor"
            style={{ insetInlineStart: `${String(ruleSet.attendanceDxFloorPct)}%` }}
          />
          <span
            className={styles.gaugeMark}
            data-kind="required"
            style={{ insetInlineStart: `${String(ruleSet.attendanceRequiredPct)}%` }}
          />
        </span>
        {/*
          One legend, not two floating labels: the floor and the requirement
          are ten points apart, and positioned labels collide there.
        */}
        <p className={styles.gaugeScale}>
          <span data-kind="floor">{ruleSet.attendanceDxFloorPct}% DX floor</span>
          <span data-kind="required">{ruleSet.attendanceRequiredPct}% required</span>
        </p>
      </div>

      <p className={styles.standingNote}>
        {/*
          The pooled figure is NOT what the regulation checks — 22OB 3.7 is per
          course — so saying only "you are at 82%" would be reassuring and
          wrong. The sentence names which figure this is and points at the one
          that actually decides.
        */}
        {attended} of {conducted} classes attended, pooled across every course you track. The
        requirement is applied <strong>per course</strong> (22OB 3.7), so the list beside this is
        what decides whether you can sit each exam.
      </p>

      <ExplanationDisclosure explanation={overall.explanation} />
    </Panel>
  );
}

export function AttendancePage() {
  const { items, loading, save, remove } = useAttendance();
  const { profile } = useProfile();
  /** The record as it was before the last mark, so one tap can be taken back. */
  const [undo, setUndo] = useState<{ record: AttendanceRecord; label: string } | null>(null);
  /** The course whose planner is open. */
  const [planning, setPlanning] = useState<AttendanceRecord | null>(null);

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

  /* The four figures the design puts across the top, each from the engine. */
  const tracked = items.filter((record) => record.conducted > 0);
  const pooled = items.reduce(
    (running, record) => ({
      attended: running.attended + record.attended,
      conducted: running.conducted + record.conducted,
    }),
    { attended: 0, conducted: 0 },
  );
  const overall =
    pooled.conducted === 0 ? null : calculateAttendance(pooled.attended, pooled.conducted, ruleSet);
  const atRisk = items.filter((record) => {
    const verdict = calculateAttendance(record.attended, record.conducted, ruleSet);
    return verdict.ok && verdict.value.status !== 'safe';
  }).length;

  return (
    <>
      <PageHeader
        eyebrow="Semester attendance"
        title="Attendance"
        subtitle={`The requirement is ${String(ruleSet.attendanceRequiredPct)}% per course (clause 22OB 3.7). Below ${String(ruleSet.attendanceDxFloorPct)}% a course is marked DX and you cannot sit its exam.`}
        pills={
          items.length === 0 ? undefined : (
            <>
              <MetaPill>{formatCount(items.length, 'course')}</MetaPill>
              <MetaPill>{String(ruleSet.attendanceRequiredPct)}% required</MetaPill>
            </>
          )
        }
      />

      <div className={styles.stack}>
        {items.length > 0 && (
          <MetricStrip
            metrics={[
              {
                label: 'Overall attendance',
                value:
                  overall?.ok === true ? formatPercent(overall.value.percentage) : 'Unavailable',
                ...(overall?.ok === true && overall.value.status !== 'safe'
                  ? {
                      tone:
                        overall.value.status === 'dx_risk'
                          ? ('danger' as const)
                          : ('warning' as const),
                    }
                  : {}),
                note: `${String(ruleSet.attendanceRequiredPct)}% required`,
              },
              {
                label: 'Courses at risk',
                value: String(atRisk),
                ...(atRisk > 0 ? { tone: 'warning' as const } : {}),
                note: atRisk > 0 ? 'Below the requirement' : 'All clear',
              },
              {
                label: 'Classes held',
                value: String(pooled.conducted),
                note: 'Across every course',
              },
              {
                label: 'Tracked courses',
                value: String(tracked.length),
                ...(items.length - tracked.length > 0
                  ? { note: `${String(items.length - tracked.length)} awaiting data` }
                  : {}),
              },
            ]}
          />
        )}

        {/*
          -------------------------------------------------------------------
          M9.6F: LEAD WITH THE ANSWER, NOT WITH A FORM
          -------------------------------------------------------------------

          The first thing on this page was "Add a course" — a data-entry form —
          and the figures a student actually opened the page for were below it.
          The question this page exists to answer is "can I miss this class",
          and the overall standing is the first half of that answer.
        */}
        {loading ? null : items.length === 0 ? (
          <Panel title="Your courses" flush>
            <EmptyState title="No courses tracked yet" icons={['attendance']}>
              Add the courses you are taking this semester and GradTools will show how many classes
              you can still miss.
            </EmptyState>
          </Panel>
        ) : (
          <div className={styles.twoUp}>
            <OverallStanding items={items} />

            <Panel
              title="By course"
              flush
              /*
               * SAID ONCE, NOT PER COURSE (M9.3 §13). The DX rule used to be
               * repeated in full inside every at-risk card; with three such
               * courses a student read the same paragraph three times and the
               * page became mostly warning.
               */
              action={anyAtRisk ? <span className={styles.dxHint}>DX rule below</span> : undefined}
            >
              <ul className={styles.courseList}>
                {items.map((record) => (
                  <AttendanceRow
                    key={record.id}
                    record={record}
                    name={subjectName(record.subjectCode, semesterSubjects)}
                    onPlan={() => {
                      setPlanning(record);
                    }}
                    onMark={(outcome) => {
                      /*
                       * The previous record is kept, not recomputed. Undo by
                       * subtracting would happily take a count below zero if it
                       * were ever reached twice, and an irreversible counter
                       * with a mis-tappable button is worse than no button.
                       */
                      setUndo({ record, label: record.subjectCode });
                      void save(markClass(record, outcome));
                    }}
                  />
                ))}
              </ul>
              {anyAtRisk && (
                <p className={styles.dxNote}>
                  Below {String(ruleSet.attendanceDxFloorPct)}% a course is marked DX and you are
                  not permitted to sit its Semester End Examination (clause 22OB 3.7(5)). A shortage
                  of up to {String(ruleSet.attendanceCondonablePct)} points may be condoned by the
                  Vice Chancellor on the Principal&rsquo;s recommendation with supporting documents.
                  This is discretionary, not automatic.
                </p>
              )}
            </Panel>
          </div>
        )}

        {/*
          ONE STEP OF UNDO, WHICH IS THE STEP THAT GETS USED. A mis-tap on a
          counter is the ordinary mistake here — the buttons sit next to each
          other and get pressed while walking out of a lecture — and the fix has
          to be as cheap as the error.
        */}
        {undo !== null && (
          <div className={styles.undoBar}>
            <span>Recorded a class for {undo.label}.</span>
            <Button
              small
              onClick={() => {
                void save(undo.record);
                setUndo(null);
              }}
            >
              Undo
            </Button>
          </div>
        )}

        <details className={styles.addCourse}>
          <summary className={styles.addSummary}>
            <Icon name="plus" size="nav" />
            Add a course
          </summary>
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
              <Icon name="plus" size="nav" />
              Add
            </Button>
          </div>
          {formError !== undefined && (
            <div className={styles.formError} role="alert">
              <Notice tone="danger">{formError}</Notice>
            </div>
          )}
        </details>
      </div>

      <BunkPlanner
        record={planning}
        onClose={() => {
          setPlanning(null);
        }}
        onMark={(record, outcome) => {
          setUndo({ record, label: record.subjectCode });
          const next = markClass(record, outcome);
          void save(next);
          setPlanning(next);
        }}
        onRemove={(record) => {
          setPlanning(null);
          void remove(record.id);
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* One course                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One course, as the approved design's row: the verdict as a mark, the course,
 * how much of it has been attended, and the way into planning against it.
 *
 * The two marking buttons are not in the design, and they stay: recording a
 * class is the thing a student does weekly, and the only alternatives this
 * product has ever offered are retyping both totals or deleting the course.
 */
function AttendanceRow({
  record,
  name,
  onMark,
  onPlan,
}: {
  readonly record: AttendanceRecord;
  readonly name: string | null;
  readonly onMark: (outcome: ClassOutcome) => void;
  readonly onPlan: () => void;
}) {
  const attendance = calculateAttendance(record.attended, record.conducted, ruleSet);

  if (!attendance.ok) {
    return (
      <li className={styles.courseRow}>
        <span className={styles.courseMark} data-tone="unknown" aria-hidden="true">
          <Icon name="empty" size="nav" />
        </span>
        <span className={styles.courseBody}>
          <span className={styles.courseName}>{name ?? record.subjectCode}</span>
          <span className={styles.courseMeta}>{attendance.detail}</span>
        </span>
        <Button small onClick={onPlan}>
          Plan
        </Button>
      </li>
    );
  }

  const { percentage, status } = attendance.value;
  const tone = TONE_OF[status];

  return (
    <li className={styles.courseRow}>
      <span className={styles.courseMark} data-tone={tone} aria-hidden="true">
        <Icon name={STATUS_PRESENTATION[status].icon} size="nav" />
      </span>

      <span className={styles.courseBody}>
        <span className={styles.courseName}>{name ?? record.subjectCode}</span>
        <span className={`${styles.courseMeta ?? ''} ${monoClass}`}>
          {record.subjectCode} · {record.attended}/{record.conducted} classes
        </span>
      </span>

      <span className={styles.courseBar} aria-hidden="true">
        <span data-tone={tone} style={{ inlineSize: `${String(Math.min(100, percentage))}%` }} />
      </span>

      {/*
        The tooltip EXPLAINS the figure; it never carries one. The percentage,
        the counts and the verdict are all already on the row, so nothing is
        lost on a touchscreen or in a printout — what it adds is which
        threshold this subject is measured against (M9.6D §16).
      */}
      <Tooltip
        content={
          status === 'safe'
            ? `At or above the ${String(ruleSet.attendanceRequiredPct)}% requirement (22OB 3.7).`
            : status === 'dx_risk'
              ? `Below the ${String(ruleSet.attendanceDxFloorPct)}% floor: the course carries a DX and cannot be sat.`
              : `Below the ${String(ruleSet.attendanceRequiredPct)}% requirement but above the ${String(ruleSet.attendanceDxFloorPct)}% floor.`
        }
      >
        <span className={styles.coursePercent} data-tone={tone} tabIndex={0}>
          {formatPercent(percentage)}
        </span>
      </Tooltip>

      <span className={styles.courseActions}>
        {/*
          QUICK MARKING, WHERE THERE IS ROOM FOR IT. The design's row carries
          one button; this product also has to record a class, which is the
          thing a student does weekly. Below 1440px the two marks would squeeze
          the course NAME to an ellipsis, so there they live in the planner
          — one tap away, and always present there.
        */}
        <span className={styles.courseMarks}>
          <Button
            small
            aria-label={`Mark a class attended for ${record.subjectCode}`}
            onClick={() => {
              onMark('attended');
            }}
          >
            Attended
          </Button>
          <Button
            small
            aria-label={`Mark a class missed for ${record.subjectCode}`}
            onClick={() => {
              onMark('missed');
            }}
          >
            Missed
          </Button>
        </span>
        <Button small aria-label={`Plan against ${record.subjectCode}`} onClick={onPlan}>
          Plan
        </Button>
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Bunk planner                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What one course can still afford, and what happens if you spend it.
 *
 * The design opens this from the course row, and states the two figures a
 * student is really asking for: where they are now, and where the requirement
 * is. Everything below that — the projection — is this product's own, and is
 * the reason the planner exists at all.
 *
 * Every figure comes from the rules engine. This component decides nothing
 * about attendance and advises nothing: "you can miss three more" is
 * arithmetic; "you should skip tomorrow" is advice, and GradTools does not
 * give it (docs/19 §19.11).
 */
function BunkPlanner({
  record,
  onClose,
  onRemove,
  onMark,
}: {
  readonly record: AttendanceRecord | null;
  readonly onClose: () => void;
  readonly onRemove: (record: AttendanceRecord) => void;
  readonly onMark: (record: AttendanceRecord, outcome: ClassOutcome) => void;
}) {
  const [plannedClasses, setPlannedClasses] = useState('10');
  const [classesToMiss, setClassesToMiss] = useState('2');

  const attendance =
    record === null ? null : calculateAttendance(record.attended, record.conducted, ruleSet);
  const canMiss =
    record === null ? null : calculateClassesCanMiss(record.attended, record.conducted, ruleSet);
  const mustAttend =
    record === null ? null : calculateClassesMustAttend(record.attended, record.conducted, ruleSet);

  const planned = Number(plannedClasses);
  const missed = Number(classesToMiss);
  const inputsValid =
    Number.isInteger(planned) && Number.isInteger(missed) && planned >= 0 && missed >= 0;
  const missedExceedsPlanned = inputsValid && missed > planned;

  const projectedAttended = (record?.attended ?? 0) + Math.max(0, planned - missed);
  const projectedConducted = (record?.conducted ?? 0) + Math.max(0, planned);
  const projection =
    record !== null && inputsValid && !missedExceedsPlanned
      ? calculateAttendance(projectedAttended, projectedConducted, ruleSet)
      : null;

  /* If the projection lands below the threshold, how many of the remaining
     classes would need to be attended instead. Still arithmetic, not advice. */
  const recovery =
    projection?.ok === true && projection.value.status !== 'safe'
      ? calculateClassesMustAttend(projectedAttended, projectedConducted, ruleSet)
      : null;

  const safe = attendance?.ok === true && attendance.value.status === 'safe';

  return (
    <Sheet
      open={record !== null}
      onClose={onClose}
      side="bottom"
      title="Bunk planner"
      /* Not "BCS501 · BCS501": the title falls back to the code when a course
         has no name, and printing it twice reads as a bug. */
      description={
        record === null
          ? ''
          : record.subjectTitle === record.subjectCode
            ? record.subjectCode
            : `${record.subjectTitle} · ${record.subjectCode}`
      }
    >
      {record !== null && attendance?.ok === true && (
        <div className={styles.planner}>
          <div className={styles.plannerFigures}>
            <div className={styles.plannerFigure}>
              <span className={styles.plannerLabel}>Current attendance</span>
              <span className={styles.plannerValue} data-tone={TONE_OF[attendance.value.status]}>
                {formatPercent(attendance.value.percentage)}
              </span>
              <span className={styles.plannerNote}>
                {record.attended} of {record.conducted} classes
              </span>
            </div>
            <div className={styles.plannerFigure}>
              <span className={styles.plannerLabel}>Required</span>
              <span className={styles.plannerValue}>
                {formatPercent(attendance.value.requiredPct)}
              </span>
              <span className={styles.plannerNote}>University minimum, per course</span>
            </div>
          </div>

          {/* WHAT THIS COURSE CAN AFFORD, or what it would take to recover. */}
          <div className={styles.plannerVerdict} data-tone={safe ? 'safe' : 'attention'}>
            <span className={styles.plannerVerdictMark} aria-hidden="true">
              <Icon name={safe ? 'success' : 'warning'} size="medium" />
            </span>
            <div>
              <p className={styles.plannerVerdictTitle}>
                {safe && canMiss?.ok === true
                  ? canMiss.value > 0
                    ? `You can miss ${formatCount(canMiss.value, 'more class', 'more classes')}`
                    : 'You cannot miss any more classes'
                  : mustAttend?.ok === true && mustAttend.value > 0
                    ? `Attend the next ${formatCount(mustAttend.value, 'class', 'classes')} to recover`
                    : 'Attendance is below the requirement'}
              </p>
              <p className={styles.plannerVerdictBody}>
                {safe
                  ? `Attendance stays at or above ${String(attendance.value.requiredPct)}% if you do. Assumes no further classes beyond the ones counted here.`
                  : `Reaching ${String(attendance.value.requiredPct)}% is calculated from recorded classes only.`}
              </p>
            </div>
          </div>

          {/* THE PROJECTION — this product's own, and the reason to plan. */}
          <div className={styles.plannerControls}>
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
              error={
                missedExceedsPlanned ? 'Cannot miss more classes than will be held.' : undefined
              }
              onChange={(event) => {
                setClassesToMiss(event.target.value);
              }}
            />
          </div>

          {projection?.ok === true && (
            <div className={styles.plannerResult}>
              <span className={styles.plannerLabel}>Attendance would become</span>
              <span className={styles.plannerValue} data-tone={TONE_OF[projection.value.status]}>
                {formatPercent(projection.value.percentage)}
              </span>
              <span className={styles.plannerNote}>
                {String(projectedAttended)} of {String(projectedConducted)} classes ·{' '}
                {String(projection.value.requiredPct)}% required
              </span>
              <StatusPill
                tone={STATUS_PRESENTATION[projection.value.status].tone}
                icon={STATUS_PRESENTATION[projection.value.status].icon}
              >
                {STATUS_PRESENTATION[projection.value.status].label}
              </StatusPill>
              {recovery?.ok === true && recovery.value > 0 && (
                <p className={styles.plannerNote}>
                  Reaching {String(projection.value.requiredPct)}% from there would take{' '}
                  {formatCount(recovery.value, 'further class', 'further classes')} attended in a
                  row.
                </p>
              )}
              <ExplanationDisclosure explanation={projection.explanation} />
            </div>
          )}

          {/*
            RECORDING A CLASS, from the same place you plan one. Both raise
            the classes-held count, because attendance is a ratio and not a
            score — missing a class is not the same as the class not happening.
          */}
          <div className={styles.plannerMark}>
            <span className={styles.plannerLabel}>Record a class</span>
            <span className={styles.plannerMarkButtons}>
              <Button
                onClick={() => {
                  onMark(record, 'attended');
                }}
              >
                Attended
              </Button>
              <Button
                onClick={() => {
                  onMark(record, 'missed');
                }}
              >
                Missed
              </Button>
            </span>
          </div>

          <div className={styles.plannerFoot}>
            <Button
              variant="danger"
              aria-label={`Remove ${record.subjectCode}`}
              onClick={() => {
                onRemove(record);
              }}
            >
              <Icon name="trash" size="nav" />
              Stop tracking this course
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
