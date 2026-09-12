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

import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/icons.js';
import { useOpenSearch } from '../components/GlobalSearch.js';
import { Button, buttonClassName } from '../components/ui/index.js';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  const navigate = useNavigate();
  const openSearch = useOpenSearch();

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
      {/*
        THE DESIGN'S THREE WAYS OUT: the dashboard, the search, and back.
        These were the dashboard, Results and SGPA & CGPA — two arbitrary
        destinations in place of the two general answers. A route that does not
        exist is answered by looking for what you meant, or by returning to
        where you were; neither is a guess about which page you wanted.
      */}
      <div className={styles.actions}>
        <Link to="/" className={buttonClassName('primary')}>
          <Icon name="dashboard" size="nav" />
          Go to dashboard
        </Link>
        {/* Null when this page is rendered outside the shell, which owns the
            palette. Then there is nothing to open, so nothing is offered. */}
        {openSearch !== null && (
          <Button onClick={openSearch}>
            <Icon name="search" size="nav" />
            Search
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            navigate(-1);
          }}
        >
          <Icon name="arrowLeft" size="nav" />
          Back
        </Button>
      </div>
    </div>
  );
}
