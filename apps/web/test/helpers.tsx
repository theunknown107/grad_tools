/**
 * Test helpers.
 *
 * The in-memory repository bundle below is the practical proof that the
 * repository boundary (src/repositories/types.ts) is real: the entire storage
 * layer is swapped for tests by changing one provider prop, with no component
 * aware of it. The same seam later accepts an API-backed bundle.
 */

import { render, type RenderResult } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type {
  AttendanceRecord,
  BacklogRecord,
  ClassMark,
  DayOverride,
  LedgerEntry,
  RemoteSnapshot,
  SemesterRecord,
  SemesterResult,
  SchemeCourse,
  SemesterSubject,
  StudentProfile,
  TimetableSlot,
} from '../src/domain/types.js';
import type { SavedCalendar } from '../src/domain/calendar-import.js';
import type { SavedTimetable } from '../src/domain/timetable-import.js';
import type { SavedExamTimetable, StoredExamEvent } from '../src/domain/exam-import.js';
import type { NotificationPreferences, NotificationRecord } from '../src/domain/notifications.js';
import type { RepositoryBundle } from '../src/repositories/types.js';
import { RepositoryProvider } from '../src/repositories/context.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { Toaster } from '../src/components/ui/feedback.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';

export interface MemorySeed {
  profile?: StudentProfile | null;
  attendance?: AttendanceRecord[];
  results?: SemesterResult[];
  timetable?: TimetableSlot[];
  semesters?: SemesterRecord[];
  semesterSubjects?: SemesterSubject[];
  backlogs?: BacklogRecord[];
  calendars?: SavedCalendar[];
  classMarks?: ClassMark[];
  attendanceLedger?: LedgerEntry[];
  timetableOverrides?: DayOverride[];
  remoteSnapshots?: RemoteSnapshot[];
  schemeCourses?: SchemeCourse[];
  examTimetables?: SavedExamTimetable[];
  examEvents?: StoredExamEvent[];
  timetableImports?: SavedTimetable[];
  notificationState?: NotificationRecord[];
  notificationPreferences?: NotificationPreferences | null;
}

function listRepo<T extends { readonly id: string }>(initial: T[]) {
  let items = [...initial];
  return {
    async list() {
      return [...items];
    },
    async upsert(item: T) {
      const index = items.findIndex((candidate) => candidate.id === item.id);
      items = index === -1 ? [...items, item] : items.map((c, i) => (i === index ? item : c));
    },
    async remove(id: string) {
      items = items.filter((candidate) => candidate.id !== id);
    },
    peek: () => items,
  };
}

export function createMemoryRepositories(seed: MemorySeed = {}) {
  let profile = seed.profile ?? null;
  const attendance = listRepo<AttendanceRecord>(seed.attendance ?? []);
  const results = listRepo<SemesterResult>(seed.results ?? []);
  const timetable = listRepo<TimetableSlot>(seed.timetable ?? []);
  const semesters = listRepo<SemesterRecord>(seed.semesters ?? []);
  const semesterSubjects = listRepo<SemesterSubject>(seed.semesterSubjects ?? []);
  const backlogs = listRepo<BacklogRecord>(seed.backlogs ?? []);
  const calendars = listRepo<SavedCalendar>(seed.calendars ?? []);
  const classMarks = listRepo<ClassMark>(seed.classMarks ?? []);
  const attendanceLedger = listRepo<LedgerEntry>(seed.attendanceLedger ?? []);
  const timetableOverrides = listRepo<DayOverride>(seed.timetableOverrides ?? []);
  const remoteSnapshots = listRepo<RemoteSnapshot>(seed.remoteSnapshots ?? []);
  const schemeCourses = listRepo<SchemeCourse>(seed.schemeCourses ?? []);
  const timetableImports = listRepo<SavedTimetable>(seed.timetableImports ?? []);
  const examTimetables = listRepo<SavedExamTimetable>(seed.examTimetables ?? []);
  const examEvents = listRepo<StoredExamEvent>(seed.examEvents ?? []);
  let notificationState: NotificationRecord[] = [...(seed.notificationState ?? [])];
  let notificationPreferences: NotificationPreferences | null =
    seed.notificationPreferences ?? null;

  const bundle: RepositoryBundle = {
    profile: {
      async get() {
        return profile;
      },
      async save(next) {
        profile = next;
      },
      async clear() {
        profile = null;
      },
    },
    attendance,
    results,
    timetable,
    semesters,
    semesterSubjects,
    backlogs,
    calendars,
    timetableImports,
    classMarks,
    attendanceLedger,
    timetableOverrides,
    remoteSnapshots,
    schemeCourses,
    examTimetables,
    examEvents,
    notifications: {
      async listStates() {
        return notificationState;
      },
      async saveStates(records) {
        notificationState = [...records];
      },
      async getPreferences() {
        return notificationPreferences;
      },
      async savePreferences(preferences) {
        notificationPreferences = preferences;
      },
    },
  };

  return {
    bundle,
    peek: {
      profile: () => profile,
      attendance: attendance.peek,
      results: results.peek,
      timetable: timetable.peek,
      semesters: semesters.peek,
      semesterSubjects: semesterSubjects.peek,
      backlogs: backlogs.peek,
      calendars: calendars.peek,
      timetableImports: timetableImports.peek,
      classMarks: classMarks.peek,
      attendanceLedger: attendanceLedger.peek,
      timetableOverrides: timetableOverrides.peek,
      remoteSnapshots: remoteSnapshots.peek,
      schemeCourses: schemeCourses.peek,
      examTimetables: examTimetables.peek,
      examEvents: examEvents.peek,
      notificationState: () => notificationState,
      notificationPreferences: () => notificationPreferences,
    },
  };
}

export function renderWith(
  ui: ReactElement,
  options: { repositories?: RepositoryBundle; route?: string } = {},
): RenderResult {
  const { repositories = createMemoryRepositories().bundle, route = '/' } = options;
  return render(
    <MemoryRouter initialEntries={[route]}>
      <RepositoryProvider repositories={repositories}>
        {/*
          THE PROVIDERS THE SHELL ALWAYS SUPPLIES: appearance, tooltips and toasts.
          A page rendered bare in a test gets the same tree the browser does.
        */}
        <ThemeProvider>
          <TooltipProvider>
            {ui}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </RepositoryProvider>
    </MemoryRouter>,
  );
}

/**
 * Picks an option from a Radix Select: open the trigger named `label`, then
 * press the option named `option`. Radix renders its list in a portal, so the
 * option is found on the whole screen rather than inside the trigger.
 */
export async function choose(label: RegExp | string, option: RegExp | string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}
