/**
 * Route table.
 *
 * Only Stage 1 destinations exist. Papers, Syllabus and Notifications are
 * later, individually approved milestones and are absent rather than stubbed.
 */

import { Route, Routes } from 'react-router-dom';
import { AppShell, Disclaimer } from './components/AppShell.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { AcademicsPage } from './features/academics/AcademicsPage.js';
import { AttendancePage } from './features/attendance/AttendancePage.js';
import { ResultsPage } from './features/results/ResultsPage.js';
import { TimetablePage } from './features/timetable/TimetablePage.js';
import { ProfilePage } from './features/profile/ProfilePage.js';
import { NotFoundPage } from './features/NotFoundPage.js';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/academics" element={<AcademicsPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/timetable" element={<TimetablePage />} />
        <Route path="/profile" element={<ProfilePage />} />
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
