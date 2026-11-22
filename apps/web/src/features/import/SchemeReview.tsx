import type { ParsedScheme } from '@gradtools/vtu-catalogue';
import { BookOpen, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardRows } from '../../components/ui/card.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { Row } from '../../components/ui/page.js';
import type { StudentProfileId } from '../../domain/identity.js';
import type { SchemeCourse } from '../../domain/types.js';
import { newId, nowIso } from '../../lib/id.js';
import { Recorded, ReviewCard, SaveFooter, saveFailure, type SaveState } from './ReviewCard.js';

export function SchemeReview({
  fileName,
  parsed,
  profileId,
  saved,
  onSave,
}: {
  readonly fileName: string;
  readonly parsed: ParsedScheme;
  readonly profileId: StudentProfileId;
  readonly saved: readonly SchemeCourse[];
  readonly onSave: (courses: readonly SchemeCourse[]) => void | Promise<void>;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const savedCodes = new Set(saved.map((course) => course.code));
  const replacing = parsed.courses.filter((course) => savedCodes.has(course.code)).length;

  const confirm = async (): Promise<void> => {
    if (state === 'saving' || state === 'saved') return;
    setState('saving');
    setError(null);
    try {
      await onSave(
        parsed.courses.map((course) => ({
          id: newId(),
          profileId,
          schemeYear: parsed.schemeYear,
          programme: parsed.programme,
          semester: course.semester,
          code: course.code,
          title: course.title,
          credits: course.credits,
          sourcePage: course.page,
          updatedAt: nowIso(),
        })),
      );
      setState('saved');
      toast('Data confirmed and recorded.', {
        description: `${String(parsed.courses.length)} courses and their credits are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      setState('failed');
      setError(saveFailure(cause, 'Your scheme'));
    }
  };

  if (state === 'saved') {
    return (
      <Recorded
        label="Scheme recorded"
        figures={[{ label: 'courses', value: parsed.courses.length }]}
      >
        {parsed.courses.length} courses and their credits are saved on this device. Result cards you
        import now resolve their credits from this scheme, so your SGPA and CGPA can be calculated.
      </Recorded>
    );
  }

  return (
    <ReviewCard
      label="Scheme review"
      title={
        parsed.programme === null
          ? 'Scheme of teaching'
          : `Scheme of teaching — ${parsed.programme}`
      }
      meta={
        <>
          {parsed.courses.length} courses
          {parsed.schemeYear === null ? '' : ` · ${parsed.schemeYear} scheme`}
          {parsed.semesters.length === 0
            ? ''
            : ` · semesters ${parsed.semesters.join(', ')}`} · {fileName}
        </>
      }
      badges={
        <Badge tone="info" icon={<BookOpen />}>
          Scheme
        </Badge>
      }
    >
      {parsed.courses.length === 0 && (
        <Callout tone="warning" title="No course table found.">
          A scheme states each semester as its own heading and prints the credits in the last
          column; if this file is a syllabus for one course rather than the scheme for a programme,
          it does not carry that table.
        </Callout>
      )}
      {replacing > 0 && (
        <Callout>
          {replacing} of these courses are already recorded from a scheme. Saving replaces those
          entries with the ones read here.
        </Callout>
      )}
      {parsed.courses.length > 0 && (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[3rem_7rem_1fr_5rem] gap-2 border-b border-line bg-panel px-4 py-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase sm:grid">
            <span>Sem</span>
            <span>Code</span>
            <span>Course</span>
            <span className="text-right">Credits</span>
          </div>
          <CardRows
            tabIndex={0}
            role="region"
            aria-label="Courses read from the scheme"
            className="max-h-[420px] overflow-y-auto scroll-quiet focus-visible:outline-offset-[-2px]"
          >
            {parsed.courses.map((course) => (
              <Row
                key={`${String(course.page)}-${course.code}`}
                className="gap-2 sm:grid sm:grid-cols-[3rem_7rem_1fr_5rem]"
              >
                <span className="w-9 shrink-0 font-mono text-[12px] text-ink-3">
                  S{course.semester}
                </span>
                <span className="min-w-0 flex-1 sm:contents">
                  <span className="block font-mono text-[12px] text-ink">{course.code}</span>
                  <span className="block truncate text-[13px] text-ink-2">{course.title}</span>
                </span>
                <span className="tnum shrink-0 text-right text-[13px] font-medium">
                  {course.credits} {course.credits === 1 ? 'credit' : 'credits'}
                </span>
              </Row>
            ))}
          </CardRows>
        </Card>
      )}
      {parsed.rejected.length > 0 && (
        <details className="group rounded-xl border border-line bg-raised">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-medium text-ink">
            {parsed.rejected.length} rows the scheme states no credits for
            <ChevronDown
              className="size-4 text-ink-3 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <ul className="space-y-1 border-t border-line px-4 py-3 text-[12px] text-ink-2">
            {parsed.rejected.map((rejection) => (
              <li key={`${String(rejection.page)}-${rejection.code}`}>
                <span className="font-mono font-medium text-ink">{rejection.code}</span> —{' '}
                {rejection.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <SaveFooter
        error={error}
        saving={state === 'saving'}
        disabled={parsed.courses.length === 0}
        onConfirm={() => void confirm()}
        confirmLabel={state === 'failed' ? 'Try saving again' : 'Confirm and save these credits'}
      />
    </ReviewCard>
  );
}
