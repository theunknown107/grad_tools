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
import { markClass, type ClassOutcome } from '../../domain/attendance.js';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill, PastelCard, Rail } from '../../components/ui/tone.js';
import { Icon } from '../../components/icons.js';
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
import { Bar, MetricStrip, Row, Rows } from '../../components/ui/layout.js';
import { Tooltip } from '../../components/ui/Tooltip.js';
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
 */
function OverallStanding({ items }: { readonly items: readonly AttendanceRecord[] }) {
  const attended = items.reduce((total, record) => total + record.attended, 0);
  const conducted = items.reduce((total, record) => total + record.conducted, 0);
  if (conducted === 0) return null;

  const overall = calculateAttendance(attended, conducted, ruleSet);
  if (!overall.ok) return null;

  const { percentage, status } = overall.value;
  const atRisk = items.filter((record) => {
    const verdict = calculateAttendance(record.attended, record.conducted, ruleSet);
    return verdict.ok && verdict.value.status !== 'safe';
  }).length;

  return (
    <section className={`${styles.standing ?? ''} surfaceCard`} aria-label="Overall attendance">
      <MetricStrip
        metrics={[
          {
            label: 'Overall',
            value: formatPercent(percentage),
            ...(status === 'safe'
              ? {}
              : { tone: status === 'dx_risk' ? ('danger' as const) : ('warning' as const) }),
          },
          { label: 'Attended', value: String(attended) },
          { label: 'Held', value: String(conducted) },
          {
            label: 'Below 85%',
            value: String(atRisk),
            ...(atRisk > 0 ? { tone: 'warning' as const } : {}),
          },
        ]}
      />
      <p className={styles.standingNote}>
        {/*
          The pooled figure is NOT what the regulation checks — 22OB 3.7 is per
          course — so saying only "you are at 82%" would be reassuring and
          wrong. The sentence names which figure this is and points at the one
          that actually decides.
        */}
        Pooled across every course you track. The requirement is applied <strong>per course</strong>{' '}
        (22OB 3.7), so the rows below are what decide whether you can sit each exam.
      </p>
    </section>
  );
}

export function AttendancePage() {
  const { items, loading, save, remove } = useAttendance();
  const { profile } = useProfile();
  /** The record as it was before the last mark, so one tap can be taken back. */
  const [undo, setUndo] = useState<{ record: AttendanceRecord; label: string } | null>(null);

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
        pills={
          items.length === 0 ? undefined : (
            <>
              <MetaPill>{formatCount(items.length, 'course')}</MetaPill>
              <MetaPill>{String(ruleSet.attendanceRequiredPct)}% required</MetaPill>
            </>
          )
        }
      />

      {/*
        Per-course attendance as the reference's feature cards. The tone is the
        VERDICT, not a rotation: a course that is safe takes the progress tone
        and one that is not takes the attention tone, which is the semantic
        mapping the tones were defined for. The bar is the real percentage.
      */}
      {items.length > 0 && (
        <Rail label="Attendance by course">
          {items.map((record) => {
            const verdict = calculateAttendance(record.attended, record.conducted, ruleSet);
            const pct = verdict.ok ? verdict.value.percentage : null;
            const safe = verdict.ok && verdict.value.status === 'safe';
            return (
              <PastelCard
                key={record.id}
                tone={safe ? 'lime' : 'peach'}
                pill={record.subjectCode}
                title={pct === null ? 'Not countable' : formatPercent(pct)}
                body={`${String(record.attended)} of ${String(record.conducted)} classes attended.`}
                {...(pct === null ? {} : { progress: pct })}
              />
            );
          })}
        </Rail>
      )}

      <div className={styles.stack}>
        {/*
          -------------------------------------------------------------------
          M9.6F: LEAD WITH THE ANSWER, NOT WITH A FORM
          -------------------------------------------------------------------

          The first thing on this page was "Add a course" — a data-entry form —
          and the figures a student actually opened the page for were below it.
          The question this page exists to answer is "can I miss this class",
          and the overall standing is the first half of that answer.

          So: the standing leads, the courses follow, and adding a course moves
          into a disclosure at the end. Entry is something you do once per
          semester; reading is something you do weekly.
        */}
        {items.length > 0 ? <OverallStanding items={items} /> : null}

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

        {loading ? null : items.length === 0 ? (
          <Panel title="Your courses" flush>
            <EmptyState>
              No courses added yet. Add the courses you are taking this semester and GradTools will
              show how many classes you can still miss.
            </EmptyState>
          </Panel>
        ) : (
          <Panel
            title="Your courses"
            flush
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
                  onMark={(outcome) => {
                    /*
                     * The previous record is kept, not recomputed. Undo by
                     * subtracting would happily take a count below zero if it
                     * were ever reached twice, and an irreversible counter with
                     * a mis-tappable button is worse than no button at all.
                     */
                    setUndo({ record, label: record.subjectCode });
                    void save(markClass(record, outcome));
                  }}
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
          </Panel>
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
  onMark,
  onRemove,
}: {
  readonly record: AttendanceRecord;
  readonly name: string | null;
  readonly onMark: (outcome: ClassOutcome) => void;
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
            <Icon name="trash" size="nav" />
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
          {/*
            The tooltip EXPLAINS the figure; it never carries one. The
            percentage, the counts and the advice are all already on the row,
            so nothing is lost on a touchscreen or in a printout — what it adds
            is which threshold this subject is measured against (M9.6D §16).
          */}
          <Tooltip
            content={
              status === 'safe'
                ? 'At or above the 85% attendance requirement (22OB 4.3).'
                : status === 'dx_risk'
                  ? 'Below the 75% floor: the course carries a DX and must be repeated (22OB 6.2).'
                  : 'Below the 85% requirement but above the 75% floor (22OB 4.3).'
            }
          >
            <span className={styles.rowPercent} data-tone={tone} tabIndex={0}>
              {formatPercent(percentage)}
            </span>
          </Tooltip>
          <Bar value={percentage} tone={tone} label={`${name ?? record.subjectCode} attendance`} />
          {/*
            THE ACTION THIS PAGE IS OPENED FOR. Before this the only ways to
            change a count were retyping both totals in the form above or
            deleting the course, so recording five classes after a day of
            lectures meant retyping five codes and ten numbers.

            Two buttons, because a class was attended or it was not, and both
            raise the classes-held count — attendance is a ratio, not a score.
          */}
          <span className={styles.rowActions}>
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
    /*
     * Quiet: the planner answers a question about the courses above it, so it
     * is subordinate to them rather than their equal (ui §7).
     */
    return (
      <Panel title="Bunk planner" material="quiet" flush>
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
    <Panel title="Bunk planner" material="quiet" flush>
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
