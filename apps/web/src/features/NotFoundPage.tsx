/** 404 — offers the common destinations rather than a dead end (docs/04 §4.3). */

import { Link } from 'react-router-dom';
import { PageHeader } from '../components/AppShell.js';
import { buttonClassName } from '../components/ui/index.js';

export function NotFoundPage() {
  return (
    <>
      <PageHeader
        title="Page not found"
        subtitle="That page does not exist in this experimental version."
      />
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Link to="/" className={buttonClassName('primary')}>
          Dashboard
        </Link>
        <Link to="/academics" className={buttonClassName()}>
          SGPA &amp; CGPA
        </Link>
        <Link to="/attendance" className={buttonClassName()}>
          Attendance
        </Link>
      </div>
    </>
  );
}
