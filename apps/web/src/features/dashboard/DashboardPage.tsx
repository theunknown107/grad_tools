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
import { SgpaTrend, type SemesterPoint } from '../../components/SgpaTrend.js';
import { formatGpa, formatPercent, formatTime } from '../../lib/format.js';
import {
  useAttendance,
  useBacklogs,
  useCalendars,
  useProfile,
  useResults,
  useSemesters,
  useSemesterSubjects,
  useTimetable,
} from '../../hooks/useCollection.js';
import { buildSemesterViews, currentSemester, summariseBacklogs } from '../../domain/academics.js';
import { daysUntil, nextEvent } from '../../domain/calendar-import.js';
import { semesterSgpa } from '../../domain/results.js';
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
      {loading ? (
        <Skeleton rows={4} />
      ) : (
        /*
          -------------------------------------------------------------------
          M9.6F: ONE PRIMARY SURFACE, THEN QUIET ROWS
          -------------------------------------------------------------------

          The page was five glass panels of equal weight — snapshot, chart,
          today, attention, latest — so nothing led and the eye had no entry
          point. M9.6F §6 asks for "one strong glass composition + quiet rows +
          one major visualization", and that is the change:

            THE BRIEF   a single glass surface carrying the three things that
                        answer "how am I doing" — which semester this is, the
                        five figures, and the trend behind them. Context and
                        the numbers it explains now share one object instead of
                        being a header floating above two separate boxes.

            EVERYTHING  quiet. Today, Attention, Latest and Quick access are
            ELSE        hairline-separated regions over the environment. They
                        are things you scan, not things you study.

          The rail is gone. Two columns split the reading order in half and put
          "what changed" beside "where you stand" as though they were peers;
          they are not, and on a phone the split did not exist anyway.
        */
        <>
          <section className={`${styles.brief ?? ''} glassSurface`} aria-labelledby="brief-title">
            <header className={styles.briefHead}>
              <div>
                <p className={styles.eyebrow}>
                  {name !== undefined && name !== '' ? `${name} · ` : ''}
                  {profile?.branch ?? 'GradTools'}
                  {profile?.schemeId === 'vtu-2022' ? ' · 2022 scheme' : ''}
                </p>
                <h1 className={styles.title} id="brief-title">
                  {semesterNumber === null ? 'Your degree' : `Semester ${String(semesterNumber)}`}
                  {current !== null && <span className={styles.status}>In progress</span>}
                </h1>
              </div>
            </header>

            <Snapshot
              results={results}
              attendance={thisSemester}
              subjectCount={subjectsNow.length}
              outstanding={outstanding}
            />
          </section>

          <div className={styles.quietStack}>
            <Today timetable={timetable} subjects={semesterSubjects} />
            <NextDate />
            <Attention attendance={thisSemester} subjects={semesterSubjects} backlogs={backlogs} />
            <LatestAnnouncements />
            <Resources />
          </div>
        </>
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
  /*
   * `semesterSgpa` is the ONE place that decides whether a semester can be
   * graded — including the OQ-049 condition that every subject carries both a
   * grade and credits. A provisional result entered from a card shows its marks
   * on the results page and takes no part in the CGPA, rather than contributing
   * a partial average nobody could see the shape of.
   */
  const graded = results
    .map((result) => {
      const { sgpa, credits } = semesterSgpa(result, ruleSet);
      return { semester: result.semester, credits, sgpa };
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

  /*
   * All eight semesters, always — a semester with no computable SGPA carries a
   * null rather than being dropped, so the chart can show it as a GAP. Dropping
   * it would let the line join across a semester the student has no result for.
   */
  const trendPoints: readonly SemesterPoint[] = Array.from({ length: 8 }, (_, index) => {
    const semester = index + 1;
    const entry = graded.find((candidate) => candidate.semester === semester);
    return {
      semester,
      sgpa: entry?.sgpa ?? null,
      state: entry === undefined ? 'planned' : 'graded',
    };
  });

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

      {/*
        The trend is shown only once there are at least two graded semesters.
        A "trend" through a single point is a dot, and dressing one reading up
        as a direction is exactly the invented insight docs/37 forbids.
      */}
      {graded.length >= 2 && (
        <Panel title="SGPA by semester" material="quiet">
          <SgpaTrend points={trendPoints} />
        </Panel>
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
      material="quiet"
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
/* The next thing the calendar says                                           */
/* -------------------------------------------------------------------------- */

/**
 * ONE upcoming date from the imported academic calendar.
 *
 * One, not ten (M10A.7 §32, §54). The student already has a calendar; what the
 * dashboard can add is the next thing on it. A list of every date would be a
 * worse copy of the document they uploaded.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING — no calendar imported, or every date
 * on it already past. A panel that says "no upcoming dates" trains people to
 * stop reading the region, exactly as `Attention` explains.
 *
 * The countdown is computed here and stored nowhere: "in 3 days" is true for
 * one day, and a saved copy would be wrong by morning (§22).
 */
function NextDate() {
  const { items: calendars } = useCalendars();

  const today = new Date().toISOString().slice(0, 10);
  const events = calendars.flatMap((calendar) => calendar.events);
  const next = nextEvent(events, today);
  if (next === null) return null;

  const days = daysUntil(next, today);
  const when =
    days > 1
      ? `in ${String(days)} days`
      : days === 1
        ? 'tomorrow'
        : days === 0
          ? 'today'
          : 'under way';

  return (
    <Panel material="quiet" title="Next on the calendar" flush>
      <Rows>
        <Row
          title={next.title}
          meta={next.endDate === null ? formatDay(next.startDate) : `${formatDay(next.startDate)} – ${formatDay(next.endDate)}`}
          trailing={when}
        />
      </Rows>
    </Panel>
  );
}

/** `2026-09-07` as `7 Sep`. The year is noise when the date is weeks away. */
function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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
      material="quiet"
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
    /* Navigation, not an owned group — quiet, so the elevated surfaces on
       this page stay meaningful (M9.6C §7). */
    <Panel title="Go to" flush material="quiet">
      <nav className={styles.resources} aria-label="Other areas">
        {/*
          IMPORT LEADS, because giving GradTools a document is the primary way
          to get information in and typing it is the fallback (M10A.9 §1, §15).
          It is a row in a quiet list rather than a banner: the dashboard
          answers "where am I", and an upload portal would answer a question
          nobody opened it to ask (§12).
        */}
        <Link to="/import">Add academic document</Link>
        {/*
          Question papers is no longer a product feature and is no longer
          offered here. It was the FIRST link on this list, which made the one
          scrapped area the most prominent thing a student was pointed at. The
          route still exists; nothing advertises it.
        */}
        <Link to="/results">Results</Link>
        <Link to="/academics">SGPA &amp; CGPA</Link>
        <Link to="/attendance">Attendance</Link>
        <Link to="/semesters">My degree</Link>
      </nav>
    </Panel>
  );
}
