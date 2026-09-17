/**
 * Exam timetable — the papers that apply to this student, from examination
 * time tables they added. GradTools does not download them.
 */

import { CalendarClock, FilePlus2, Info } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { EmptyState } from '../../components/ui/feedback.js';
import { Metric, MetricGrid } from '../../components/ui/metric.js';
import { PageHeader, Row, RowText } from '../../components/ui/page.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { examRelevance, type ExamAudience, type ExamRelevance } from '../../domain/exam-import.js';
import {
  useBacklogs,
  useExamEvents,
  useExamTimetables,
  useProfile,
  useSemesterSubjects,
} from '../../hooks/useCollection.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatTime } from '../../lib/format.js';

function label(relevance: ExamRelevance): { text: string; tone: Tone } {
  if (relevance === 'enrolled') return { text: 'Your paper', tone: 'accent' };
  if (relevance === 'backlog') return { text: 'Backlog paper', tone: 'warning' };
  return { text: 'Not identified', tone: 'neutral' };
}

function dateParts(iso: string): { day: string; month: string; weekday: string } {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { day: iso, month: '', weekday: '' };
  return {
    day: String(date.getDate()),
    month: date.toLocaleDateString('en-GB', { month: 'short' }),
    weekday: date.toLocaleDateString('en-GB', { weekday: 'short' }),
  };
}

function daysFrom(today: string, iso: string): number {
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

export function ExamsPage() {
  const { profile } = useProfile();
  const timetables = useExamTimetables();
  const events = useExamEvents();
  const planned = useSemesterSubjects();
  const backlogs = useBacklogs();

  const audience = useMemo<ExamAudience>(
    () => ({
      scheme: profile?.schemeId === 'vtu-2022' ? '2022' : null,
      semester: profile?.currentSemester ?? null,
      enrolled: planned.items
        .filter((subject) => subject.semester === profile?.currentSemester)
        .map((subject) => subject.code),
      backlog: backlogs.items
        .filter((record) => record.status !== 'cleared')
        .map((record) => record.subjectCode),
    }),
    [profile?.schemeId, profile?.currentSemester, planned.items, backlogs.items],
  );
  const mine = useMemo(
    () =>
      events.items
        .map((event) => ({ event, relevance: examRelevance(event, audience) }))
        .filter((entry) => entry.relevance !== 'not_applicable')
        .sort((a, b) => a.event.examDate.localeCompare(b.event.examDate)),
    [events.items, audience],
  );

  if (timetables.loading || events.loading) return <PageSkeleton label="Loading your exams" />;

  const today = new Date().toISOString().slice(0, 10);
  const ahead = mine.filter((entry) => entry.event.examDate >= today);
  const past = mine.filter((entry) => entry.event.examDate < today);
  const next = ahead[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Examinations"
        title="Exam timetable"
        description="From the examination time tables you have added. GradTools does not fetch them."
        actions={
          <Button asChild variant="primary" icon={<FilePlus2 />}>
            <Link to="/import">Add a timetable</Link>
          </Button>
        }
      />

      {timetables.items.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No exam time table added yet"
          description="Add the examination time table your university published and the papers that apply to you appear here. GradTools is not permitted to download it for you, so it has to come from a copy you already hold."
          actions={
            <Button asChild variant="primary">
              <Link to="/import">Add a document</Link>
            </Button>
          }
        />
      ) : mine.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="Nothing here applies to you"
          description={`${timetables.items.length === 1 ? 'The time table you added covers' : `The ${String(timetables.items.length)} time tables you added cover`} schemes or semesters other than yours. Check your profile has the right scheme and semester, or add the time table for yours.`}
          actions={
            <Button asChild>
              <Link to="/profile?section=academic">Check your profile</Link>
            </Button>
          }
        />
      ) : (
        <>
          <MetricGrid>
            <Metric
              label="Papers ahead"
              value={ahead.length}
              sub={ahead.length === 0 ? 'All behind you' : undefined}
            />
            <Metric
              label="Next paper"
              value={
                next === undefined
                  ? 'None'
                  : daysFrom(today, next.event.examDate) === 0
                    ? 'Today'
                    : `${String(daysFrom(today, next.event.examDate))}d`
              }
              state={next === undefined ? 'unavailable' : 'resolved'}
              emphasis={
                next !== undefined && daysFrom(today, next.event.examDate) <= 2
                  ? 'warning'
                  : undefined
              }
              sub={next?.event.printed}
            />
            <Metric
              label="Backlog papers"
              value={mine.filter((entry) => entry.relevance === 'backlog').length}
            />
            <Metric label="Already sat" value={past.length} />
          </MetricGrid>

          <Card className="overflow-hidden">
            <CardHeader
              icon={<CalendarClock className="text-ink-2" aria-hidden="true" />}
              title={ahead.length === 0 ? 'No papers still to sit' : 'Still to sit'}
            />
            {ahead.length === 0 ? (
              <EmptyState
                compact
                icon={<CalendarClock />}
                title="Every paper here is behind you"
                description="The exams on the time tables you added have all taken place."
              />
            ) : (
              <CardRows>
                {ahead.map(({ event, relevance }) => {
                  const pill = label(relevance);
                  const parts = dateParts(event.examDate);
                  const soon = daysFrom(today, event.examDate) <= 2;
                  return (
                    <Row
                      key={`${event.examDate}-${event.printed}-${String(event.semester)}`}
                      className="gap-4 px-5"
                    >
                      <time
                        dateTime={event.examDate}
                        className={cn(
                          'grid w-12 shrink-0 place-items-center rounded-lg border py-1.5 text-center',
                          soon
                            ? 'border-warning/40 bg-warning-weak text-warning'
                            : 'border-line bg-panel',
                        )}
                      >
                        <span className="text-[10px] font-medium uppercase">{parts.month}</span>
                        <span className="tnum text-lg leading-none font-semibold">{parts.day}</span>
                      </time>
                      <RowText
                        title={event.printed}
                        meta={
                          [
                            event.weekday ?? parts.weekday,
                            event.startTime === null
                              ? event.session
                              : `${formatTime(event.startTime)}–${formatTime(event.endTime ?? event.startTime)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ') || undefined
                        }
                      />
                      <Badge tone={pill.tone}>{pill.text}</Badge>
                    </Row>
                  );
                })}
              </CardRows>
            )}
          </Card>

          {past.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader
                title="Already sat"
                action={<Badge>{formatCount(past.length, 'paper')}</Badge>}
              />
              <CardRows>
                {past.map(({ event }) => (
                  <Row key={`${event.examDate}-${event.printed}-past`} className="px-5 opacity-80">
                    <span className="w-24 shrink-0 font-mono text-[11px] text-ink-3">
                      {event.examDate}
                    </span>
                    <RowText title={event.printed} meta={event.weekday ?? undefined} />
                  </Row>
                ))}
              </CardRows>
            </Card>
          )}
        </>
      )}

      {timetables.items.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Where this came from" />
          <CardRows>
            {timetables.items.map((document) => (
              <Row key={document.id} className="px-5">
                <span className="w-24 shrink-0 font-mono text-[11px] text-ink-3">
                  {document.importedAt.slice(0, 10)}
                </span>
                <RowText
                  title={document.fileName ?? 'Examination time table'}
                  meta={
                    [
                      document.examCycle,
                      document.publicationState === null
                        ? null
                        : `${document.publicationState} publication`,
                      formatCount(document.eventCount, 'exam'),
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                />
                {document.notification !== null && (
                  <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">
                    {document.notification}
                  </span>
                )}
              </Row>
            ))}
          </CardRows>
          <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-[12px] text-ink-3">
            <Info className="size-3.5 shrink-0" aria-hidden="true" /> You added these. GradTools
            does not download examination time tables, so nothing here updates on its own.
          </p>
        </Card>
      )}
    </div>
  );
}
