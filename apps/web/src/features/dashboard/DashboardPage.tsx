/**
 * Dashboard.
 *
 * Authority: docs/05 §5.12 · docs/03 UF-03 · M9.3 §9, §10, §11, §12, §13
 *
 * ---------------------------------------------------------------------------
 * FIVE QUESTIONS, IN THIS ORDER
 * ---------------------------------------------------------------------------
 *
 *   1. What semester am I in?          the header
 *   2. Where do I stand?               the snapshot strip
 *   3. What do I have today?           today
 *   4. What needs me?                  attention — and ONLY when it does
 *   5. What has changed?               latest
 *
 * Resources come last, as links. A question-paper list is not the point of the
 * dashboard, and before M9.3 it occupied the entire first screen on a phone.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN IS NOT
 * ---------------------------------------------------------------------------
 *
 * Not a wall of equal cards. Before M9.3 this page used seven bordered panels
 * of identical weight, which meant nothing could be more important than
 * anything else — a screen of equal boxes has no hierarchy, only boxes.
 *
 * No invented metrics: no productivity score, no streak, no projected SGPA, no
 * chart drawn from three points. Every figure is real or an em dash.
 *
 * THE ATTENTION SECTION IS ABSENT WHEN THERE IS NOTHING TO ATTEND TO. A student
 * with full attendance and no backlogs should not see a section congratulating
 * them on it (M9.3 §14).
 */

import { Link } from 'react-router-dom';
import {
  calculateAttendance,
  calculateCGPA,
  calculatePercentage,
  calculateSGPA,
  vtu2022RuleSet,
} from '@gradtools/academic-rules';
import {
  WEEKDAYS,
  type AttendanceRecord,
  type BacklogRecord,
  type SemesterResult,
  type SemesterSubject,
  type TimetableSlot,
  type Weekday,
} from '../../domain/types.js';
import { Bar, Empty, MetricStrip, Row, Rows, Skeleton } from '../../components/ui/layout.js';
import { Panel } from '../../components/ui/index.js';
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
import styles from './dashboard.module.css';

const ruleSet = vtu2022RuleSet;

function todayWeekday(): Weekday {
  const index = new Date().getDay();
  return WEEKDAYS[index === 0 ? 0 : index - 1] ?? 'Mon';
}

/** The subject's real name, or its code when nobody has entered one. */
function nameFor(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
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
  const semesterNumber = current?.number ?? profile?.currentSemester ?? null;
  const name = profile?.displayName?.trim();

  const thisSemester = attendance.filter(
    (record) => semesterNumber === null || record.semester === semesterNumber,
  );
  const subjectsNow = semesterSubjects.filter(
    (subject) => semesterNumber === null || subject.semester === semesterNumber,
  );
  const outstanding = summariseBacklogs(backlogs).outstanding;

  return (
    <div className={styles.page}>
      {/*
        THE SEMESTER IS THE CONTEXT, not the student's name. A student knows who
        they are; what they open the app to check is where they are (M9.3 §11).
      */}
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          {name !== undefined && name !== '' ? `${name} · ` : ''}
          {profile?.branch ?? 'GradTools'}
          {profile?.schemeId === 'vtu-2022' ? ' · 2022 scheme' : ''}
        </p>
        <h1 className={styles.title}>
          {semesterNumber === null ? 'Your degree' : `Semester ${String(semesterNumber)}`}
          {current !== null && <span className={styles.status}>In progress</span>}
        </h1>
      </header>

      {loading ? (
        <Skeleton rows={4} />
      ) : (
        /*
          TWO COLUMNS ON A DESKTOP (M9.5 §Dashboard).
          The main column is what the student came to read, in order: where they
          stand, what is today, what needs attention. The rail beside it holds
          the two things that are true whether or not they read them — what
          changed, and where else they can go. Below 1024px it collapses to one
          column and the rail follows, because on a phone "beside" does not
          exist and the reading order is all there is.
        */
        <div className={styles.layout}>
          <div className={styles.column}>
            <Snapshot
              results={results}
              attendance={thisSemester}
              subjectCount={subjectsNow.length}
              outstanding={outstanding}
            />
            <Today timetable={timetable} subjects={semesterSubjects} />
            <Attention attendance={thisSemester} subjects={semesterSubjects} backlogs={backlogs} />
          </div>

          <aside className={styles.rail} aria-label="Elsewhere in GradTools">
            <LatestAnnouncements />
            <Resources />
          </aside>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Where the student stands                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Four figures, in one strip.
 *
 * CGPA and the last SGPA are the two numbers a student actually quotes; the
 * attendance figure is the one that changes weekly. All four are computed by
 * `@gradtools/academic-rules` — nothing here re-implements a formula (M9.3 §44).
 */
function Snapshot({
  results,
  attendance,
  subjectCount,
  outstanding,
}: {
  readonly results: readonly SemesterResult[];
  readonly attendance: readonly AttendanceRecord[];
  readonly subjectCount: number;
  readonly outstanding: number;
}) {
  const graded = results
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
        semester: result.semester,
        credits: result.subjects.reduce((total, subject) => total + subject.credits, 0),
        sgpa: sgpa.ok ? sgpa.value : null,
      };
    })
    .filter((entry) => entry.sgpa !== null && entry.credits > 0);

  const cgpa = calculateCGPA(
    graded.map((entry) => ({
      credits: entry.credits,
      sgpa: entry.sgpa as number,
      semester: entry.semester,
    })),
    ruleSet,
  );
  const percentage = cgpa.ok ? calculatePercentage(cgpa.value, ruleSet) : null;
  const latest = [...graded].sort((a, b) => b.semester - a.semester)[0];

  const attended = attendance.reduce((total, record) => total + record.attended, 0);
  const conducted = attendance.reduce((total, record) => total + record.conducted, 0);
  const overall = conducted > 0 ? calculateAttendance(attended, conducted, ruleSet) : null;

  return (
    <>
      <MetricStrip
        metrics={[
          {
            label: 'CGPA',
            value: cgpa.ok ? formatGpa(cgpa.value) : '—',
            ...(percentage?.ok === true ? { note: formatPercent(percentage.value) } : {}),
          },
          {
            label: 'Last SGPA',
            value:
              latest?.sgpa === undefined || latest.sgpa === null ? '—' : formatGpa(latest.sgpa),
            ...(latest === undefined ? {} : { note: `sem ${String(latest.semester)}` }),
          },
          {
            label: 'Attendance',
            value: overall?.ok === true ? formatPercent(overall.value.percentage) : '—',
            ...(overall?.ok === true && overall.value.status !== 'safe'
              ? {
                  tone:
                    overall.value.status === 'dx_risk' ? ('danger' as const) : ('warning' as const),
                }
              : {}),
          },
          {
            /* The semester's shape, per M9.3 §11. */
            label: 'Subjects',
            value: subjectCount === 0 ? '—' : String(subjectCount),
          },
          {
            label: 'Backlogs',
            value: String(outstanding),
            ...(outstanding > 0 ? { tone: 'warning' as const } : {}),
          },
        ]}
      />
      {/*
        Said only when it is true and useful. A student with results but no
        usable ones needs to know WHY the figures are blank rather than being
        left with four em dashes and no explanation.
      */}
      {results.length > 0 && graded.length === 0 && (
        <Empty action={<Link to="/results">Check your results</Link>}>
          Your saved results could not be graded — a grade letter may not be one the 2022 scheme
          uses.
        </Empty>
      )}
      {results.length === 0 && (
        <Empty action={<Link to="/results">Add a result</Link>}>
          No results yet, so there is no CGPA to show. {subjectCount > 0 ? '' : ''}
        </Empty>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Today                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The day's classes, as a timeline.
 *
 * The time leads because that is what a student scans for. The subject NAME is
 * shown, not only its code — `BCS502` means nothing at a glance and
 * "Computer Networks" means everything (M9.3 §12).
 */
function Today({
  timetable,
  subjects,
}: {
  readonly timetable: readonly TimetableSlot[];
  readonly subjects: readonly SemesterSubject[];
}) {
  const day = todayWeekday();
  const slots = timetable
    .filter((slot) => slot.day === day)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  /*
   * The next class that has not finished yet. Compared as "HH:MM" strings,
   * which sort correctly because the format is zero-padded and 24-hour — no
   * date arithmetic, and no timezone to get wrong.
   *
   * `undefined` once the day is over, and then nothing is highlighted, which is
   * the honest answer at 9pm.
   */
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nextSlot = slots.find((slot) => slot.endTime > clock);

  return (
    <Panel
      title={`Today · ${day}`}
      flush
      action={
        <Link className={styles.quietLink} to="/timetable">
          Full week
        </Link>
      }
    >
      {slots.length === 0 ? (
        <Empty action={<Link to="/timetable">Add your timetable</Link>}>
          Nothing scheduled today.
        </Empty>
      ) : (
        <Rows>
          {slots.map((slot) => {
            const title = nameFor(slot.subjectCode, subjects);
            return (
              <Row
                key={slot.id}
                lead={formatTime(slot.startTime)}
                title={title ?? slot.subjectCode}
                meta={title === null ? undefined : slot.subjectCode}
                trailing={slot.room ?? undefined}
                current={slot.id === nextSlot?.id}
              />
            );
          })}
        </Rows>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Attention                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The things that need doing something about.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING. A section headed "Attention" that says
 * "all clear" is a section that trains students to ignore the heading, so on a
 * good week this simply is not on the page (M9.3 §14).
 *
 * Which subjects are short is decided by the rules engine, never by a threshold
 * written in this file.
 */
function Attention({
  attendance,
  subjects,
  backlogs,
}: {
  readonly attendance: readonly AttendanceRecord[];
  readonly subjects: readonly SemesterSubject[];
  readonly backlogs: readonly BacklogRecord[];
}) {
  /*
   * Which subjects are short is the rules engine's verdict, never a threshold
   * written here. `dx_risk` outranks `below_requirement`, and both sort worst
   * first so the subject in most trouble leads (M9.3 §44).
   */
  const short = attendance
    .flatMap((record) => {
      const verdict = calculateAttendance(record.attended, record.conducted, ruleSet);
      if (!verdict.ok || verdict.value.status === 'safe') return [];
      return [{ record, verdict: verdict.value }];
    })
    .sort((a, b) => a.verdict.percentage - b.verdict.percentage);

  const outstanding = backlogs.filter((backlog) => backlog.status !== 'cleared');

  if (short.length === 0 && outstanding.length === 0) return null;

  return (
    <Panel
      title="Needs attention"
      tone="attention"
      flush
      action={
        short.length > 0 ? (
          <Link className={styles.quietLink} to="/attendance">
            All subjects
          </Link>
        ) : undefined
      }
    >
      <Rows>
        {short.map(({ record, verdict }) => {
          const title = nameFor(record.subjectCode, subjects);
          return (
            <Row
              key={record.id}
              title={title ?? record.subjectCode}
              meta={
                <>
                  {title === null ? '' : `${record.subjectCode} · `}
                  {record.attended}/{record.conducted} classes
                </>
              }
              trailing={
                <span className={styles.attendanceCell}>
                  <span data-tone={verdict.status === 'dx_risk' ? 'danger' : 'warning'}>
                    {formatPercent(verdict.percentage)}
                  </span>
                  <Bar
                    value={verdict.percentage}
                    tone={verdict.status === 'dx_risk' ? 'danger' : 'warning'}
                    label={title ?? record.subjectCode}
                  />
                </span>
              }
            />
          );
        })}
        {outstanding.map((backlog) => (
          <Row
            key={backlog.id}
            title={backlog.subjectTitle}
            meta={`${backlog.subjectCode} · from semester ${String(backlog.originSemester)}`}
            trailing="Backlog"
          />
        ))}
      </Rows>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Resources                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where to go next.
 *
 * Links, not a feature-card row (M9.3 §16). These are destinations a student
 * already knows exist; they need a way in, not an advertisement.
 */
function Resources() {
  return (
    <Panel title="Go to" flush>
      <nav className={styles.resources} aria-label="Other areas">
        <Link to="/papers">Question papers</Link>
        <Link to="/results">Results</Link>
        <Link to="/academics">SGPA &amp; CGPA</Link>
        <Link to="/attendance">Attendance</Link>
        <Link to="/semesters">My degree</Link>
      </nav>
    </Panel>
  );
}
