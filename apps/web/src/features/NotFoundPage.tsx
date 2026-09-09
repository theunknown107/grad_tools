/**
 * 404 — product-native, not a dead end.
 *
 * Authority: Figma Make `pages/Misc.tsx` · docs/04 §4.3
 *
 * The approved design centres a compass mark with the code set beside it, says
 * plainly that the route is not part of the student's record, and offers the
 * three ways out: the dashboard, the search, and back. No page header, because
 * a page that does not exist has no title to announce.
 */

import { Link } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import { buttonClassName } from '../components/ui/index.js';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <div className={styles.mark}>
        <span className={styles.badge} aria-hidden="true">
          <Icon name="compass" size="large" />
        </span>
        {/* The code itself, set small and askew beside the mark. */}
        <span className={styles.code} aria-hidden="true">
          404
        </span>
      </div>
      <h1 className={styles.title}>This page isn&rsquo;t in your record</h1>
      <p className={styles.body}>
        The route you followed doesn&rsquo;t exist in GradTools. It may have moved, or the link was
        mistyped.
      </p>
      <div className={styles.actions}>
        <Link to="/" className={buttonClassName('primary')}>
          Go to dashboard
        </Link>
        <Link to="/results" className={buttonClassName()}>
          Results
        </Link>
        <Link to="/academics" className={buttonClassName('ghost')}>
          SGPA &amp; CGPA
        </Link>
      </div>
    </div>
  );
}
