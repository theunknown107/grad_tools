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
import { calculateAttendance, vtu2022RuleSet } from '@gradtools/academic-rules';
import {
  WEEKDAYS,
  type AttendanceRecord,
  type BacklogRecord,
  type ClassMark,
  type SemesterSubject,
  type TimetableSlot,
  type Weekday,
} from '../../domain/types.js';
import { markFor } from '../../domain/attendance.js';
import { Bar, Empty, MetricStrip, Row, Rows, Skeleton } from '../../components/ui/layout.js';
import { PastelCard, Rail, toneFor } from '../../components/ui/tone.js';
import { Panel } from '../../components/ui/index.js';
import { SgpaTrend, type SemesterPoint } from '../../components/SgpaTrend.js';
import { formatCount, formatGpa, formatPercent, formatTime, localDay } from '../../lib/format.js';
import {
  useAttendance,
  useBacklogs,
  useCalendars,
  useClassMarks,
  useProfile,
  useResults,
  useSemesterSubjects,
  useTimetable,
} from '../../hooks/useCollection.js';
import { currentSemester, sgpaReading, type SemesterView } from '../../domain/academics.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import type { AcademicStatistics } from '../../domain/statistics.js';
import { metricDisplay } from '../../lib/format.js';
import {
  activeCalendars,
  calendarConflicts,
  daysUntil,
  holidayOn,
  nextEvent,
  type CalendarConflict,
  type CalendarEvent,
  type SavedCalendar,
} from '../../domain/calendar-import.js';
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
  const { loading: resultsLoading } = useResults();
  const { items: timetable, loading: timetableLoading } = useTimetable();
  const { items: marks } = useClassMarks();
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: backlogs } = useBacklogs();
  const { items: calendars } = useCalendars();

  /*
   * ONE READING FOR THE WHOLE PAGE (18, 30). `buildSemesterViews` was called
   * twice in this component alone — once for the current semester and once for
   * the rail — and neither call was memoised, so both re-ran on every render.
   */
  const { statistics } = useAcademicState();

  const loading = attendanceLoading || resultsLoading || timetableLoading;
  const current = currentSemester(statistics.views);
  const semesterNumber = current?.number ?? profile?.currentSemester ?? null;
  const name = profile?.displayName?.trim();

  const thisSemester = attendance.filter(
    (record) => semesterNumber === null || record.semester === semesterNumber,
  );
  const subjectsNow = semesterSubjects.filter(
    (subject) => semesterNumber === null || subject.semester === semesterNumber,
  );

  /*
   * The calendar reaches the day view here rather than inside `Today`, so the
   * two panels that read calendar data both take it from one place and cannot
   * disagree about which calendars are in force.
   */
  const inForce = activeCalendars(calendars);
  const holiday = holidayOn(inForce, localDay());
  const conflicts = calendarConflicts(calendars);

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
          <section className={`${styles.brief ?? ''} surfaceCard`} aria-labelledby="brief-title">
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
              stats={statistics}
              attendance={thisSemester}
              subjectCount={subjectsNow.length}
            />
          </section>

          {/*
            THE REFERENCE'S SIGNATURE ROW, carrying GradTools' own content.
            Its dashboard leads with a horizontal rail of pastel course cards;
            ours leads with the semesters of the degree, which is the same
            shape of information — a set of things in progress, each with a
            status and a proportion done.
          */}
          <SemesterRail views={statistics.views} />

          <div className={styles.quietStack}>
            <Today
              timetable={timetable}
              subjects={semesterSubjects}
              holiday={holiday}
              marks={marks}
            />
            <NextDate calendars={inForce} conflicts={conflicts} />
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
  stats,
  attendance,
  subjectCount,
}: {
  /*
   * THE SHARED READING, not a local one. Every figure below used to be
   * recomputed here — a second `semesterSgpa` loop, a second `calculateCGPA`
   * call — which is how the dashboard and the degree page came to disagree
   * about what "completed" counted (Phase 7C 18).
   */
  readonly stats: AcademicStatistics;
  readonly attendance: readonly AttendanceRecord[];
  readonly subjectCount: number;
}) {
  /*
   * All eight semesters, always. A semester with no computable SGPA carries a
   * null so the chart shows it as a GAP; dropping it would let the line join
   * across a semester the student has no result for (13).
   */
  const trendPoints: readonly SemesterPoint[] = stats.trend.map((point) => ({
    semester: point.semester,
    sgpa: point.sgpa,
    state:
      point.sgpa !== null
        ? ('graded' as const)
        : stats.views.find((view) => view.number === point.semester)?.status === 'in_progress'
          ? ('in_progress' as const)
          : ('planned' as const),
  }));

  const cgpa = metricDisplay(stats.cgpa, formatGpa);
  const percentage = metricDisplay(stats.percentage, formatPercent);
  const credits = metricDisplay(stats.creditsEarned);
  const backlogs = metricDisplay(stats.backlogs);
  const latest = stats.latestSgpa.value;

  const attended = attendance.reduce((total, record) => total + record.attended, 0);
  const conducted = attendance.reduce((total, record) => total + record.conducted, 0);
  const overall = conducted > 0 ? calculateAttendance(attended, conducted, ruleSet) : null;

  return (
    <>
      <MetricStrip
        metrics={[
          /*
            NO BARE EM DASHES (1). A figure with no value says "Unavailable"
            and carries its reason underneath, because a dash cannot tell "you
            have not entered this" from "one of your courses needs review" —
            and only one of those is the student's to fix.
          */
          {
            label: 'CGPA',
            value: cgpa.value,
            ...(cgpa.note !== undefined
              ? { note: cgpa.note }
              : stats.percentage.value !== null
                ? { note: percentage.value }
                : {}),
          },
          {
            label: 'Last SGPA',
            value: latest === null ? 'Unavailable' : formatGpa(latest.sgpa),
            ...(latest !== null
              ? { note: `sem ${String(latest.semester)}` }
              : stats.latestSgpa.reason === null
                ? {}
                : { note: stats.latestSgpa.reason }),
          },
          {
            label: 'Credits earned',
            value: credits.value,
            ...(credits.note === undefined ? {} : { note: credits.note }),
          },
          {
            label: 'Passed',
            value: String(stats.outcomes.passed),
            ...(stats.outcomes.unresolved > 0
              ? { note: `${String(stats.outcomes.unresolved)} still to review` }
              : {}),
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
            /*
              A backlog count that could not be determined is NOT zero, and the
              two must not render alike — zero backlogs is the best news the
              page carries (1).
            */
            label: 'Backlogs',
            value: backlogs.value,
            ...(backlogs.note === undefined ? {} : { note: backlogs.note }),
            ...((stats.backlogs.value ?? 0) > 0 || stats.backlogsUndetermined > 0
              ? { tone: 'warning' as const }
              : {}),
          },
        ]}
      />
      {/*
        Said only when it is true and useful. A student with results but no
        usable ones needs to know WHY the figures are blank rather than being
        left with four em dashes and no explanation.
      */}
      {/*
        THE REASON, NOT A GUESS AT IT. This used to say "a grade letter may not
        be one the 2022 scheme uses", which was one possible cause stated as
        though it were the finding. The derived state knows the actual reason
        for each semester, so it says that instead (17).
      */}
      {stats.hasAnyResult && stats.semestersGraded.value === 0 && (
        <Empty action={<Link to="/results">Check your results</Link>}>
          {stats.dataQuality.notes[0] ??
            'Your saved results could not be graded yet. Open Results to see what each one needs.'}
        </Empty>
      )}
      {!stats.hasAnyResult && (
        <Empty action={<Link to="/results">Add a result</Link>}>
          No results yet, so there is no CGPA to show.
        </Empty>
      )}

      {/*
        The trend is shown only once there are at least two graded semesters.
        A "trend" through a single point is a dot, and dressing one reading up
        as a direction is exactly the invented insight docs/37 forbids.
      */}
      {(stats.semestersGraded.value ?? 0) >= 2 && (
        <Panel title="SGPA by semester" material="quiet">
          <SgpaTrend points={trendPoints} />
        </Panel>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The semester rail                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Eight semesters as the reference's pastel cards.
 *
 * REAL DATA ONLY. A semester shows the SGPA it actually has and the progress
 * its own record reports; one with nothing saved says so rather than being
 * given an invented percentage to make the row look fuller.
 */
function SemesterRail({ views }: { readonly views: readonly SemesterView[] }) {
  if (views.length === 0) return null;

  return (
    <Rail label="Semesters">
      {views.map((view, index) => {
        const done = view.status === 'completed';
        /*
          "No SGPA yet" reads as "you have not finished entering this", which
          for a semester whose subjects carry no credits is the wrong story.
          The reading says which it is (Phase 7C §13).
        */
        const reading = sgpaReading(view);
        return (
          <PastelCard
            key={view.number}
            tone={toneFor(index)}
            to="/semesters"
            pill={done ? 'Completed' : view.status === 'in_progress' ? 'In progress' : 'Planned'}
            title={`Semester ${String(view.number)}`}
            body={
              view.sgpaComputed === null
                ? view.subjectCount > 0
                  ? `${formatCount(view.subjectCount, 'subject')}. ${reading.reason ?? 'No SGPA.'}`
                  : 'No result saved yet.'
                : `SGPA ${formatGpa(view.sgpaComputed)} from ${formatCount(view.subjectCount, 'subject')}.`
            }
            {...(done ? { progress: 100 } : {})}
          />
        );
      })}
    </Rail>
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
  holiday,
  marks,
}: {
  readonly timetable: readonly TimetableSlot[];
  readonly subjects: readonly SemesterSubject[];
  /** The calendar's own holiday covering today, where it printed one (§18). */
  readonly holiday: CalendarEvent | null;
  /** What the student has already answered for today's classes (M10A.11 §35). */
  readonly marks: readonly ClassMark[];
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
      {holiday !== null ? (
        /*
         * THE CALENDAR SAID SO, and nothing else did. This appears only for a
         * row the document printed and the parser categorised as a holiday —
         * no inference from the day of the week, and no guess from a gap
         * between events (§18). The week's classes are unchanged; today simply
         * is not one of the days they happen.
         */
        <Empty>{holiday.title} — no classes today. From your academic calendar.</Empty>
      ) : slots.length === 0 ? (
        <Empty action={<Link to="/timetable">Add your timetable</Link>}>
          Nothing scheduled today.
        </Empty>
      ) : (
        <Rows>
          {slots.map((slot) => {
            const title = nameFor(slot.subjectCode, subjects);
            /*
             * WHAT DID I MARK? (§35). Read-only here: the actions live on the
             * timetable's Today, and answering the same question twice in two
             * places is how the two come to disagree.
             */
            const marked = markFor(marks, localDay(), slot.id);
            return (
              <Row
                key={slot.id}
                lead={formatTime(slot.startTime)}
                title={title ?? slot.subjectCode}
                meta={title === null ? undefined : slot.subjectCode}
                trailing={
                  [slot.room, marked === null ? null : marked.outcome]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
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
function NextDate({
  calendars,
  conflicts,
}: {
  readonly calendars: readonly SavedCalendar[];
  readonly conflicts: readonly CalendarConflict[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  /*
   * ONLY THE CALENDARS IN FORCE. Reading every saved one meant a calendar a
   * later revision had replaced kept producing events, so a student who
   * imported a corrected calendar was still shown the old date beside the new
   * one with nothing to say which was which (M10A.10 §13, §45).
   */
  /* Already narrowed to the calendars in force by the page (§13, §45). */
  const events = calendars.flatMap((calendar) => calendar.events);
  const next = nextEvent(events, today);
  if (next === null && conflicts.length === 0) return null;

  const days = next === null ? 0 : daysUntil(next, today);
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
      {conflicts.length > 0 && (
        /*
         * SHOWN, NEVER RESOLVED. Two calendars for one term disagree about a
         * date, and a reissue and a wrong upload look identical from here — so
         * the student is told rather than quietly given one of the two (§12).
         */
        <div className={styles.conflict}>
          <strong>Two calendars for this term disagree.</strong>{' '}
          {conflicts.flatMap((conflict) => conflict.differences).join('; ')}
        </div>
      )}
      {next !== null && (
        <Rows>
          <Row
            title={next.title}
            meta={
              next.endDate === null
                ? formatDay(next.startDate)
                : `${formatDay(next.startDate)} – ${formatDay(next.endDate)}`
            }
            trailing={when}
          />
        </Rows>
      )}
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
