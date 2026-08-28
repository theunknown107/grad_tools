/**
 * Dashboard.
 *
 * Authority: docs/03 UF-03, docs/05 §Anti-patterns, M3 continuation §13.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN IS NOT
 * ---------------------------------------------------------------------------
 * Not a wall of cards. Not one giant number per box. No invented metrics —
 * no "productivity score", no streaks, no gauges without meaning, no chart
 * drawn from three data points.
 *
 * Every region shows either the student's real data or an honest empty state
 * with exactly one action. The empty dashboard is the FIRST experience for
 * every new visitor and is designed as a real screen, not an afterthought.
 *
 * Structure: header -> academic overview -> today/next -> quick actions.
 */

import { Link } from 'react-router-dom';
import {
  calculateAttendance,
  calculateCGPA,
  calculateClass,
  calculatePercentage,
  calculateSGPA,
  vtu2022RuleSet,
} from '@gradtools/academic-rules';
import {
  WEEKDAYS,
  type AttendanceRecord,
  type SemesterResult,
  type TimetableSlot,
  type Weekday,
} from '../../domain/types.js';
import { ChevronRight } from '../../components/icons.js';
import {
  buttonClassName,
  EmptyState,
  Panel,
  StatusPill,
  statusIcons,
  type PillTone,
} from '../../components/ui/index.js';
import { formatGpa, formatPercent, formatTime } from '../../lib/format.js';
import {
  useAttendance,
  useBacklogs,
  useProfile,
  useResults,
  useSemesters,
  useSemesterSubjects,
  useTimetable,
} from '../../hooks/useCollection.js';
import { buildSemesterViews, currentSemester, summariseBacklogs } from '../../domain/academics.js';
import { LatestAnnouncements } from '../announcements/AnnouncementsPage.js';
import { RecentPapers } from '../papers/PapersPage.js';
import styles from './dashboard.module.css';

const ruleSet = vtu2022RuleSet;

function todayWeekday(): Weekday {
  const index = new Date().getDay();
  return WEEKDAYS[index === 0 ? 0 : index - 1] ?? 'Mon';
}

export function DashboardPage() {
  const { profile } = useProfile();
  const { items: attendance, loading: attendanceLoading } = useAttendance();
  const { items: results, loading: resultsLoading } = useResults();
  const { items: timetable, loading: timetableLoading } = useTimetable();
  const { items: semesters } = useSemesters();
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: backlogs } = useBacklogs();

  const loading = attendanceLoading || resultsLoading || timetableLoading;
  const current = currentSemester(buildSemesterViews(semesters, results));
  const greeting = profile?.displayName?.trim();

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {greeting !== undefined && greeting !== '' ? greeting : 'Your semester'}
        </h1>
        <p className={styles.subtitle}>
          {typeof profile?.currentSemester === 'number'
            ? `Semester ${String(profile.currentSemester)} · VTU 2022 scheme`
            : 'VTU 2022 scheme'}
          {typeof profile?.branch === 'string' && profile.branch !== ''
            ? ` · ${profile.branch}`
            : ''}
        </p>
      </header>

      {loading ? (
        <p className={styles.loading}>Loading your data…</p>
      ) : (
        <div className={styles.stack}>
          {/*
            THE CURRENT SEMESTER IS THE PRIMARY CONTEXT (M6 §11). What a student
            opens the app for is the semester they are in; the history is one
            click away and does not need to lead.
          */}
          {current !== null && (
            <CurrentSemesterPanel
              semesterNumber={current.number}
              subjectCount={
                semesterSubjects.filter((subject) => subject.semester === current.number).length
              }
              attendance={attendance.filter((record) => record.semester === current.number)}
              backlogsOutstanding={summariseBacklogs(backlogs).outstanding}
            />
          )}
          {/* What is new, above the standing figures: a student opens the app
              to find out what has happened (M7 §25). */}
          <LatestAnnouncements />
          {/* A resource on the dashboard, not the subject of it (M8 §24). */}
          <RecentPapers />
          <AcademicOverview results={results} />
          <AttendanceConcerns attendance={attendance} />
          <TodaySchedule timetable={timetable} />
          <QuickActions />
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The semester the student is in                                             */
/* -------------------------------------------------------------------------- */

/**
 * The current semester, in four figures a student actually acts on.
 *
 * NOT FOUR GIANT CARDS (docs/05 anti-patterns). A dense row, and every figure
 * is either real or an em dash — an SGPA does not exist until the semester ends,
 * and showing a hopeful number there would be the worst kind of invention.
 */
function CurrentSemesterPanel({
  semesterNumber,
  subjectCount,
  attendance,
  backlogsOutstanding,
}: {
  readonly semesterNumber: number;
  readonly subjectCount: number;
  readonly attendance: readonly AttendanceRecord[];
  readonly backlogsOutstanding: number;
}) {
  const attended = attendance.reduce((total, record) => total + record.attended, 0);
  const conducted = attendance.reduce((total, record) => total + record.conducted, 0);
  const overall = conducted > 0 ? calculateAttendance(attended, conducted, ruleSet) : null;

  return (
    <Panel
      title={`Semester ${String(semesterNumber)} · In progress`}
      flush
      action={
        <Link to="/semesters" className={buttonClassName('secondary')}>
          My degree
        </Link>
      }
    >
      <dl className={styles.statRow}>
        <div className={styles.stat}>
          <dt>Attendance</dt>
          <dd className={styles.statValue}>
            {overall !== null && overall.ok ? formatPercent(overall.value.percentage) : '—'}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt>Subjects</dt>
          <dd className={styles.statValue}>{subjectCount === 0 ? '—' : subjectCount}</dd>
        </div>
        <div className={styles.stat}>
          <dt>SGPA</dt>
          {/* Not known until the semester has a result. Never estimated. */}
          <dd className={styles.statValue}>—</dd>
        </div>
        <div className={styles.stat}>
          <dt>Backlogs</dt>
          <dd className={styles.statValue}>{backlogsOutstanding}</dd>
        </div>
      </dl>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Academic overview — a dense row, not three giant cards                     */
/* -------------------------------------------------------------------------- */

function AcademicOverview({ results }: { results: readonly SemesterResult[] }) {
  if (results.length === 0) {
    return (
      <Panel title="Academic overview" flush>
        <EmptyState
          action={
            <Link to="/results" className={buttonClassName('primary')}>
              Add a result
            </Link>
          }
        >
          No results saved yet. Add a semester result and your CGPA, percentage and class appear
          here.
        </EmptyState>
      </Panel>
    );
  }

  const semesters = results.map((result) => {
    const computed = calculateSGPA(
      result.subjects.map((subject) => ({
        credits: subject.credits,
        gradeLetter: subject.gradeLetter,
        subjectCode: subject.subjectCode,
      })),
      ruleSet,
    );
    return {
      credits: result.subjects.reduce((total, subject) => total + subject.credits, 0),
      sgpa: computed.ok ? computed.value : 0,
      semester: result.semester,
      ok: computed.ok,
    };
  });

  const usable = semesters.filter((entry) => entry.ok && entry.credits > 0);
  const cgpa = calculateCGPA(
    usable.map((entry) => ({
      credits: entry.credits,
      sgpa: entry.sgpa,
      semester: entry.semester,
    })),
    ruleSet,
  );
  const percentage = cgpa.ok ? calculatePercentage(cgpa.value, ruleSet) : null;
  const classBand = percentage?.ok === true ? calculateClass(percentage.value, ruleSet) : null;
  const totalCredits = usable.reduce((total, entry) => total + entry.credits, 0);

  return (
    <Panel title="Academic overview" flush>
      <dl className={styles.statRow}>
        <div className={styles.stat}>
          <dt>CGPA</dt>
          <dd className={styles.statValue}>{cgpa.ok ? formatGpa(cgpa.value) : '—'}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Percentage</dt>
          <dd className={styles.statValue}>
            {percentage?.ok === true ? formatPercent(percentage.value) : '—'}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt>Credits</dt>
          <dd className={styles.statValue}>{String(totalCredits)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Semesters</dt>
          <dd className={styles.statValue}>{String(usable.length)}</dd>
        </div>
      </dl>
      {classBand?.ok === true && (
        <div className={styles.statFooter}>
          <StatusPill tone="accent">{classBand.value.label}</StatusPill>
          <span className={styles.statFooterNote}>
            Provisional. Class equivalence applies on completing the programme (22OB 6.8).
          </span>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Attendance concerns — only what needs attention                            */
/* -------------------------------------------------------------------------- */

function AttendanceConcerns({ attendance }: { attendance: readonly AttendanceRecord[] }) {
  if (attendance.length === 0) {
    return (
      <Panel title="Attendance" flush>
        <EmptyState
          action={
            <Link to="/attendance" className={buttonClassName('primary')}>
              Add attendance
            </Link>
          }
        >
          Nothing tracked yet. Add your courses and GradTools shows how many classes you can still
          miss.
        </EmptyState>
      </Panel>
    );
  }

  const evaluated = attendance
    .map((record) => {
      const result = calculateAttendance(record.attended, record.conducted, ruleSet);
      return result.ok ? { record, outcome: result.value } : null;
    })
    .filter((entry) => entry !== null);

  const needsAttention = evaluated.filter((entry) => entry.outcome.status !== 'safe');
  const shown = needsAttention.length > 0 ? needsAttention : evaluated;

  return (
    <Panel
      title="Attendance"
      action={
        <Link to="/attendance" className={styles.panelLink}>
          All courses
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      }
      flush
    >
      {needsAttention.length === 0 && (
        <p className={styles.allClear}>
          All {String(evaluated.length)} courses are at or above{' '}
          {String(ruleSet.attendanceRequiredPct)}%.
        </p>
      )}
      <ul className={styles.list}>
        {shown.slice(0, 4).map(({ record, outcome }) => {
          const tone: PillTone =
            outcome.status === 'safe'
              ? 'success'
              : outcome.status === 'below_requirement'
                ? 'warning'
                : 'danger';
          const icon =
            outcome.status === 'safe'
              ? statusIcons.safe
              : outcome.status === 'below_requirement'
                ? statusIcons.below
                : statusIcons.risk;
          const label =
            outcome.status === 'safe'
              ? 'Safe'
              : outcome.status === 'below_requirement'
                ? 'Below requirement'
                : 'DX risk';

          return (
            <li className={styles.listRow} key={record.id}>
              <span className={styles.listCode}>{record.subjectCode}</span>
              <span className={styles.listValue}>{formatPercent(outcome.percentage)}</span>
              <StatusPill tone={tone} icon={icon}>
                {label}
              </StatusPill>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Today                                                                      */
/* -------------------------------------------------------------------------- */

function TodaySchedule({ timetable }: { timetable: readonly TimetableSlot[] }) {
  const today = todayWeekday();
  const todaySlots = timetable
    .filter((slot) => slot.day === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <Panel
      title={`Today · ${today}`}
      action={
        <Link to="/timetable" className={styles.panelLink}>
          Full week
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      }
      flush
    >
      {timetable.length === 0 ? (
        <EmptyState
          action={
            <Link to="/timetable" className={buttonClassName('primary')}>
              Add your timetable
            </Link>
          }
        >
          No timetable yet. Add your weekly classes to see what is on today.
        </EmptyState>
      ) : todaySlots.length === 0 ? (
        <p className={styles.allClear}>No classes scheduled for {today}.</p>
      ) : (
        <ul className={styles.list}>
          {todaySlots.map((slot) => (
            <li className={styles.listRow} key={slot.id}>
              <span className={styles.listTime}>{formatTime(slot.startTime)}</span>
              <span className={styles.listCode}>{slot.subjectCode}</span>
              {slot.room !== null && <span className={styles.listMeta}>{slot.room}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick actions                                                              */
/* -------------------------------------------------------------------------- */

function QuickActions() {
  const actions = [
    { to: '/academics', label: 'Calculate SGPA', hint: 'One semester' },
    { to: '/academics', label: 'Calculate CGPA', hint: 'Across semesters' },
    { to: '/attendance', label: 'Plan a bunk', hint: 'What if I miss classes?' },
    { to: '/results', label: 'Add a result', hint: 'Semester grade card' },
  ];

  return (
    <Panel title="Quick actions" flush>
      <ul className={styles.actionList}>
        {actions.map((action) => (
          <li key={action.label}>
            <Link to={action.to} className={styles.actionLink}>
              <span className={styles.actionLabel}>{action.label}</span>
              <span className={styles.actionHint}>{action.hint}</span>
              <ChevronRight size={16} aria-hidden="true" className={styles.actionChevron} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
