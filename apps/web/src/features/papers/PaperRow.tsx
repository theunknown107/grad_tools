/**
 * One paper in the library list.
 *
 * Authority: docs/28 §28.12 · M8 §12, §13, §23
 *
 * DENSE, NOT DECORATIVE. A student scanning for one paper reads the code, the
 * sitting and whether they can open it — so those are the three things this row
 * shows first, and nothing competes with them (M8 §23, §33).
 *
 * EVERY FIELD SHOWN IS A FIELD THAT EXISTS. Absent metadata is absent from the
 * row rather than rendered as a placeholder (M8 §12).
 */

import { Link } from 'react-router-dom';
import type { QuestionPaper } from '@gradtools/shared-types';
import { StatusPill } from '../../components/ui/index.js';
import { ExternalLinkIcon } from '../../components/icons.js';
import {
  AVAILABILITY_LABEL,
  actionsFor,
  extractionSummary,
  isDemo,
  matchesSemester,
  paperFacts,
  type PaperContext,
} from '../../domain/papers.js';
import styles from './papers.module.css';

/** The host of a link, so a student sees where it goes before following it. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the original site';
  }
}

export function PaperRow({
  paper,
  context,
}: {
  readonly paper: QuestionPaper;
  readonly context: PaperContext;
}) {
  const actions = actionsFor(paper);
  const facts = paperFacts(paper);
  const extraction = extractionSummary(paper);
  const mine = matchesSemester(paper, context);

  return (
    <article className={styles.row} data-availability={paper.availability}>
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          {/*
            The code is the heading because it is what a student searches for.
            When no code was recorded the title takes its place rather than a
            placeholder standing in for it.
          */}
          <h3 className={styles.code}>
            <Link to={`/papers/${paper.id}`}>{paper.subjectCode ?? paper.title}</Link>
          </h3>
          {isDemo(paper) && <span className={styles.demo}>Demo data</span>}
          {mine && <StatusPill tone="accent">Your semester</StatusPill>}
        </div>

        {paper.subjectTitle !== null && <p className={styles.subject}>{paper.subjectTitle}</p>}
        {paper.subjectCode !== null && <p className={styles.paperTitle}>{paper.title}</p>}

        {facts.length > 0 && <p className={styles.facts}>{facts.join(' · ')}</p>}

        <p className={styles.provenance}>
          {/*
            SOURCE IS ATTRIBUTION; AVAILABILITY IS PERMISSION (M8 §6, §13). They
            are printed as two separate statements because they answer different
            questions, and a badge showing only the first invites a reader to
            assume the second.
          */}
          <span>Source: {paper.sourceName ?? 'Not recorded'}</span>
          <span className={styles.availability}>{AVAILABILITY_LABEL[paper.availability]}</span>
        </p>

        {extraction !== null && <p className={styles.extraction}>{extraction}</p>}
      </div>

      <div className={styles.rowActions}>
        {actions.canOpenHere && (
          <Link className={styles.open} to={`/papers/${paper.id}`}>
            Open
          </Link>
        )}
        {!actions.canOpenHere && actions.canOpenOriginal && paper.sourceUrl !== null && (
          /*
            LEAVING GRADTOOLS IS OBVIOUS (M8 §13, §15). The host is named, the
            link opens in a new tab and says so, and `nofollow` keeps GradTools
            from lending its standing to a page it has not vouched for.
          */
          <a
            className={styles.external}
            href={paper.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            <ExternalLinkIcon size={14} aria-hidden="true" />
            {hostOf(paper.sourceUrl)}
            <span className={styles.visuallyHidden}> (opens in a new tab)</span>
          </a>
        )}
        {actions.unavailableReason !== null && (
          <span className={styles.unavailable}>{actions.unavailableReason}</span>
        )}
      </div>
    </article>
  );
}
