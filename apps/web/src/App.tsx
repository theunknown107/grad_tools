/**
 * Route table.
 *
 * Paths are the product's established ones; labels and layout are the
 * design's. The landing page sits outside the shell (it carries its own
 * navigation and footer). `/` stays the dashboard: GradTools is local-first,
 * so a returning student lands on their own data.
 */

import { lazy, Suspense, type ComponentType } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell, Disclaimer } from './components/layout/AppShell.js';
import { PageSkeleton } from './components/ui/skeleton.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';

/*
 * Every destination but the dashboard is its own chunk: the landing route
 * stays in the first download, and the document pipeline, charts and forms
 * load when a student first opens a page that needs them.
 */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));

const AcademicsPage = page(() => import('./features/academics/AcademicsPage.js'), 'AcademicsPage');
const AnnouncementsPage = page(
  () => import('./features/announcements/AnnouncementsPage.js'),
  'AnnouncementsPage',
);
const NotificationsPage = page(
  () => import('./features/announcements/NotificationsPage.js'),
  'NotificationsPage',
);
const AttendancePage = page(
  () => import('./features/attendance/AttendancePage.js'),
  'AttendancePage',
);
const AccountPage = page(() => import('./features/auth/AccountPage.js'), 'AccountPage');
const FirstSyncPage = page(() => import('./features/auth/FirstSyncPage.js'), 'FirstSyncPage');
const SignInPage = page(() => import('./features/auth/SignInPage.js'), 'SignInPage');
const ExamsPage = page(() => import('./features/exams/ExamsPage.js'), 'ExamsPage');
const ImportPage = page(() => import('./features/import/ImportPage.js'), 'ImportPage');
const LandingPage = page(() => import('./features/landing/LandingPage.js'), 'LandingPage');
const NotFoundPage = page(() => import('./features/NotFoundPage.js'), 'NotFoundPage');
const ProfilePage = page(() => import('./features/profile/ProfilePage.js'), 'ProfilePage');
const ResultDetailPage = page(
  () => import('./features/results/ResultDetailPage.js'),
  'ResultDetailPage',
);
const ResultsPage = page(() => import('./features/results/ResultsPage.js'), 'ResultsPage');
const SemestersPage = page(() => import('./features/semesters/SemestersPage.js'), 'SemestersPage');
const TimetablePage = page(() => import('./features/timetable/TimetablePage.js'), 'TimetablePage');

export function App() {
  return (
    <Routes>
      <Route
        path="/welcome"
        element={
          <Suspense fallback={null}>
            <LandingPage />
          </Suspense>
        }
      />
      <Route path="*" element={<ShellRoutes />} />
    </Routes>
  );
}

function ShellRoutes() {
  return (
    <AppShell
      footer={
        <Disclaimer>
          Experimental version. GradTools is an independent student project and is not affiliated
          with, endorsed by, or connected to Visvesvaraya Technological University. Academic figures
          follow the VTU 2022 regulations (22OB) and each one can show the clause it came from.
        </Disclaimer>
      }
    >
      <Suspense fallback={<PageSkeleton label="Loading page" />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/semesters" element={<SemestersPage />} />
          <Route path="/academics" element={<AcademicsPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/results/:semester" element={<ResultDetailPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/exams" element={<ExamsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/first-sync" element={<FirstSyncPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
