/**
 * Mark today — the phone's floating action.
 *
 * The one task done several times a day, one tap from every screen. It is the
 * Attendance page's own Today list (`DayView`), in a bottom sheet: the same
 * data, the same marking path (`useMarkClass`, through DayView), the same
 * scheme gate. Nothing here calculates or writes on its own.
 */

import type { SemesterSubject } from '../../domain/types.js';
import { BottomSheet } from '../../components/ui/sheet.js';
import { SchemeNotice, useSchemeRules } from '../../hooks/useSchemeRules.js';
import {
  useSemesterSubjects,
  useTimetable,
  useTimetableOverrides,
} from '../../hooks/useCollection.js';
import { useNow, useTodayLabel } from '../../hooks/useNow.js';
import { DayView, NowLine } from './DayView.js';

function subjectName(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
}

export function QuickMarkSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Mark today" className="md:hidden">
      {open && <QuickMarkBody />}
    </BottomSheet>
  );
}

function QuickMarkBody() {
  const rules = useSchemeRules();
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: timetable } = useTimetable();
  const { items: overrides } = useTimetableOverrides();
  const now = useNow();
  const label = useTodayLabel();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Mark today</h2>
        <p className="text-[13px] text-ink-3">Each class, one tap. Undo is in the confirmation.</p>
      </div>
      {!rules.builtIn ? (
        <SchemeNotice rules={rules} what="Attendance requirements" />
      ) : (
        <>
          <NowLine date={label.date} clock={label.clock} />
          <DayView
            date={now.today}
            time={now.time}
            slots={timetable}
            overrides={overrides}
            titleFor={(code) => subjectName(code, semesterSubjects)}
            showTiming
            emptyTitle={timetable.length === 0 ? 'No timetable yet' : 'Nothing on today'}
            emptyDescription={
              timetable.length === 0
                ? 'Import or enter your weekly timetable and today’s classes appear here, ready to mark.'
                : 'Your timetable has no classes for today.'
            }
          />
        </>
      )}
    </div>
  );
}
