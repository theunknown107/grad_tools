/**
 * Route table.
 *
 * Only approved destinations exist. Syllabus is a later, individually
 * approved milestone and is absent rather than stubbed.
 */

import { Route, Routes } from 'react-router-dom';
import { AppShell, Disclaimer } from './components/AppShell.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { AnnouncementsPage } from './features/announcements/AnnouncementsPage.js';
import { NotificationsPage } from './features/announcements/NotificationsPage.js';
import { SemestersPage } from './features/semesters/SemestersPage.js';
import { AcademicsPage } from './features/academics/AcademicsPage.js';
import { AttendancePage } from './features/attendance/AttendancePage.js';
import { ResultsPage } from './features/results/ResultsPage.js';
import { ImportPage } from './features/import/ImportPage.js';
import { TimetablePage } from './features/timetable/TimetablePage.js';
import { ProfilePage } from './features/profile/ProfilePage.js';
import { SignInPage } from './features/auth/SignInPage.js';
import { AccountPage } from './features/auth/AccountPage.js';
import { FirstSyncPage } from './features/auth/FirstSyncPage.js';
import { NotFoundPage } from './features/NotFoundPage.js';
import { LandingPage } from './features/landing/LandingPage.js';

export function App() {
  return (
    /*
     * The landing page sits OUTSIDE the shell. It carries its own compact
     * navbar and its own footer (M9.6B References 15 and 16), and wrapping it
     * in the application chrome would put two navigations and two footers on
     * one page.
     *
     * `/` stays the dashboard: GradTools is local-first, so a returning student
     * lands on their own data rather than on marketing. `/welcome` is the
     * public front door. Which of the two a fresh visitor should get is a
     * product decision, recorded as OQ-051 rather than guessed at here.
     */
    <Routes>
      <Route path="/welcome" element={<LandingPage />} />
      <Route path="*" element={<ShellRoutes />} />
    </Routes>
  );
}

function ShellRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/semesters" element={<SemestersPage />} />
        <Route path="/academics" element={<AcademicsPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/results" element={<ResultsPage />} />
        {/* Automatic ingestion is the primary workflow, so it has a destination. */}
        <Route path="/import" element={<ImportPage />} />
        <Route path="/timetable" element={<TimetablePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/first-sync" element={<FirstSyncPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <Disclaimer>
        Experimental version. GradTools is an independent student project and is not affiliated
        with, endorsed by, or connected to Visvesvaraya Technological University. Academic figures
        follow the VTU 2022 regulations (22OB) and each one can show the clause it came from.
      </Disclaimer>
    </AppShell>
  );
}
