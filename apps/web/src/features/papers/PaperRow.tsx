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
  FORMAT_LABEL,
  actionsFor,
  extractionSummary,
  isDemo,
  matchesSemester,
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
  const extraction = extractionSummary(paper);
  const mine = matchesSemester(paper, context);

  /*
   * ONLY THE FACTS THAT VARY (M9.3 §18, §29).
   *
   * `paperFacts` returns everything known, which is right for the detail page.
   * On a list it is wrong: branch and scheme are identical on every row of a
   * filtered library, so repeating them fifty times adds a wrapped line per row
   * and no information. They remain available as filters, and in full on the
   * paper's own page.
   */
  const facts = [
    paper.examSession ?? (paper.examYear === null ? null : String(paper.examYear)),
    paper.semester === null ? null : `Sem ${String(paper.semester)}`,
    paper.paperFormat === null ? null : FORMAT_LABEL[paper.paperFormat],
  ].filter((fact): fact is string => fact !== null);

  /*
   * ONE METADATA LINE, NOT FOUR (M9.3 §16, §29).
   *
   * Every row used to carry its facts, its source and its availability on
   * separate lines, so fifty papers ran to eight thousand pixels and the same
   * two sentences repeated fifty times. Provenance and availability are still
   * both stated — they are different claims and neither may be dropped
   * (M8 §6) — but they join the same line as everything else.
   */
  /*
   * Availability always; the source only when there is one to name. "Source not
   * recorded" on every row is noise, and its absence says the same thing.
   */
  const provenance = [paper.sourceName, AVAILABILITY_LABEL[paper.availability]]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <article className={styles.row} data-availability={paper.availability}>
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <h3 className={styles.code}>
            <Link to={`/papers/${paper.id}`}>{paper.subjectCode ?? paper.title}</Link>
          </h3>
          {paper.subjectTitle !== null && (
            <span className={styles.subject}>{paper.subjectTitle}</span>
          )}
          {isDemo(paper) && <span className={styles.demo}>Demo</span>}
          {mine && <StatusPill tone="accent">Your semester</StatusPill>}
        </div>

        <p className={styles.facts}>
          {facts.join(' · ')}
          {facts.length > 0 ? ' · ' : ''}
          {provenance}
          {extraction === null ? '' : ` · ${extraction}`}
        </p>
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
