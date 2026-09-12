/**
 * The examination time table.
 *
 * Authority: Phase 7B.2 §25–§29 · docs/40 (source audit)
 *
 * ---------------------------------------------------------------------------
 * FOUR WAYS TO HAVE NO EXAMS, AND THEY ARE NOT THE SAME (§28)
 * ---------------------------------------------------------------------------
 *
 * "You have no exams" is the one sentence this page must never say by
 * accident, because a student reads it as permission to stop revising. So:
 *
 *   nothing supplied      no document has been uploaded at all
 *   nothing applicable    documents exist; none of their columns is yours
 *   unresolved            your column has exams whose course nobody can name
 *   all sat               your exams exist and are in the past
 *
 * Each says something different and each is written out.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE SYNCHRONISES WITH VTU
 * ---------------------------------------------------------------------------
 *
 * GradTools is not permitted to fetch vtu.ac.in (docs/40), so this page shows
 * documents the student uploaded and says so. It must never imply freshness it
 * cannot have — there is no "last checked", because nothing checks.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/AppShell.js';
import { Icon } from '../../components/icons.js';
import {
  EmptyState,
  Panel,
  StatusPill,
  buttonClassName,
  monoClass,
} from '../../components/ui/index.js';
import { Rows, Row } from '../../components/ui/layout.js';
import { examRelevance, type ExamAudience, type ExamRelevance } from '../../domain/exam-import.js';
import {
  useBacklogs,
  useExamEvents,
  useExamTimetables,
  useProfile,
  useSemesterSubjects,
} from '../../hooks/useCollection.js';
import { formatTime } from '../../lib/format.js';
import styles from './exams.module.css';

/** Today, as the device reckons it, for deciding what is still ahead. */
const today = () => new Date().toISOString().slice(0, 10);

function label(relevance: ExamRelevance): { text: string; tone: 'accent' | 'neutral' | 'warning' } {
  if (relevance === 'enrolled') return { text: 'Your paper', tone: 'accent' };
  if (relevance === 'backlog') return { text: 'Backlog paper', tone: 'warning' };
  return { text: 'Not identified', tone: 'neutral' };
}

export function ExamsPage() {
  const { profile } = useProfile();
  const timetables = useExamTimetables();
  const events = useExamEvents();
  const planned = useSemesterSubjects();
  const backlogs = useBacklogs();

  /*
   * WHAT THE STUDENT IS, from their own record rather than from anything
   * hardcoded (§19). A profile that does not say leaves the field null, and a
   * null matches nothing rather than everything.
   */
  const audience = useMemo<ExamAudience>(
    () => ({
      scheme: profile?.schemeId === 'vtu-2022' ? '2022' : null,
      semester: profile?.currentSemester ?? null,
      /* What they are taking, from their own semester plan. */
      enrolled: planned.items
        .filter((subject) => subject.semester === profile?.currentSemester)
        .map((subject) => subject.code),
      /*
       * And what they still owe. A cleared backlog is not owed, so it does not
       * make an earlier semester's paper theirs (§20).
       */
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

  const now = today();
  const ahead = mine.filter((entry) => entry.event.examDate >= now);
  const past = mine.filter((entry) => entry.event.examDate < now);
  const loading = timetables.loading || events.loading;

  return (
    <>
      {/* Every other page names its area above the title; this one did not. */}
      <PageHeader
        eyebrow="Examinations"
        title="Exam time table"
        subtitle="From the examination time tables you have added. GradTools does not fetch them."
      />

      {loading ? null : timetables.items.length === 0 ? (
        <Panel title="Your exams" flush>
          <EmptyState title="No exam time table added yet" icons={['papers']}>
            Add the examination time table your university published and the papers that apply to
            you appear here. GradTools is not permitted to download it for you, so it has to come
            from a copy you already hold.
            <div className={styles.emptyAction}>
              <Link className={buttonClassName('primary')} to="/import">
                Add a document
              </Link>
            </div>
          </EmptyState>
        </Panel>
      ) : mine.length === 0 ? (
        <Panel title="Your exams" flush>
          {/*
            DOCUMENTS EXIST AND NONE OF THEM IS YOURS. Not the same as having
            no exams, and the difference is the whole reason this branch is
            separate: one means "nothing is scheduled", the other means "what
            you added was for somebody else".
          */}
          <EmptyState title="Nothing here applies to you" icons={['papers']}>
            {timetables.items.length === 1
              ? 'The time table you added'
              : `The ${String(timetables.items.length)} time tables you added`}{' '}
            {timetables.items.length === 1 ? 'covers' : 'cover'} schemes or semesters other than
            yours. Check your profile says the right scheme and semester, or add the time table for
            yours.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel title={ahead.length === 0 ? 'No papers still to sit' : 'Still to sit'} flush>
            {ahead.length === 0 ? (
              <EmptyState title="Every paper here is behind you" icons={['papers']}>
                The exams on the time tables you added have all taken place.
              </EmptyState>
            ) : (
              <Rows>
                {ahead.map(({ event, relevance }) => {
                  const pill = label(relevance);
                  return (
                    <Row
                      key={`${event.examDate}-${event.printed}-${String(event.semester)}`}
                      lead={event.examDate}
                      title={event.printed}
                      meta={
                        [
                          event.weekday,
                          event.startTime === null
                            ? event.session
                            : `${formatTime(event.startTime)}–${formatTime(event.endTime ?? event.startTime)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ') || undefined
                      }
                      trailing={<StatusPill tone={pill.tone}>{pill.text}</StatusPill>}
                    />
                  );
                })}
              </Rows>
            )}
          </Panel>

          {past.length > 0 && (
            <Panel title="Already sat">
              <Rows>
                {past.map(({ event }) => (
                  <Row
                    key={`${event.examDate}-${event.printed}-past`}
                    lead={event.examDate}
                    title={event.printed}
                    meta={event.weekday ?? undefined}
                  />
                ))}
              </Rows>
            </Panel>
          )}
        </>
      )}

      {timetables.items.length > 0 && (
        <Panel title="Where this came from">
          {/*
            PROVENANCE, AND AN HONEST ABSENCE OF FRESHNESS (§22, §29). Every
            line names a document the student handed over. There is no "last
            checked" because nothing checks.
          */}
          <Rows>
            {timetables.items.map((document) => (
              <Row
                key={document.id}
                lead={document.importedAt.slice(0, 10)}
                title={document.fileName ?? 'Examination time table'}
                meta={
                  [
                    document.examCycle,
                    document.publicationState === null
                      ? null
                      : `${document.publicationState} publication`,
                    `${String(document.eventCount)} ${document.eventCount === 1 ? 'exam' : 'exams'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                trailing={
                  document.notification === null ? undefined : (
                    <span className={monoClass}>{document.notification}</span>
                  )
                }
              />
            ))}
          </Rows>
          <p className={styles.note}>
            <Icon name="info" size="nav" /> You added these. GradTools does not download
            examination time tables, so nothing here updates on its own.
          </p>
        </Panel>
      )}
    </>
  );
}
