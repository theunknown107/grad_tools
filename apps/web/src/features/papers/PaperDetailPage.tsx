/**
 * One question paper.
 *
 * Authority: docs/17 §17.13 · docs/28 §28.12 · M8 §14, §20, §22, §35, §48
 *
 * ---------------------------------------------------------------------------
 * THE VIEWER IS THE BROWSER'S
 * ---------------------------------------------------------------------------
 * A hosted paper is shown in an `<iframe>` pointing at the file route, which
 * means page navigation, zoom, search, print and rotation all come from the
 * viewer the reader already knows how to use. GradTools renders no PDF itself
 * and ships no PDF library (M8 §14, §35) — reimplementing that is months of
 * work to arrive somewhere worse.
 *
 * WHAT A LINK-ONLY PAPER GETS INSTEAD is a sentence and a link. The file is not
 * fetched, framed or proxied: GradTools does not have it, and quietly pulling
 * it through the server would make the app a proxy for material whose rights
 * nobody established (M8 §15).
 */

import { Link, useParams } from 'react-router-dom';
import { Notice, Panel, StatusPill } from '../../components/ui/index.js';
import { PageHeader } from '../../components/AppShell.js';
import { Icon } from '../../components/icons.js';
import { apiBaseUrl } from '../../repositories/reference.js';
import { SOURCE_ROUTES } from '@gradtools/shared-types';
import { usePaper, usePaperContext } from '../../hooks/usePapers.js';
import {
  AVAILABILITY_LABEL,
  FORMAT_LABEL,
  actionsFor,
  extractionSummary,
  isDemo,
  matchesSemester,
  schemeLabel,
} from '../../domain/papers.js';
import { hostOf } from './PaperRow.js';
import styles from './papers.module.css';

/** A field is shown when it has a value. Absent metadata stays absent (M8 §12). */
function Fact({ label, value }: { readonly label: string; readonly value: string | null }) {
  if (value === null) return null;
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function PaperDetailPage() {
  const { id } = useParams();
  const { paper, loading, error } = usePaper(id);
  const context = usePaperContext();

  if (loading) return <p className={styles.loading}>Loading paper…</p>;

  if (paper === null) {
    return (
      <div className={styles.page}>
        <PageHeader title="Paper" subtitle="This paper is not in the library." />
        <Notice tone="warning">
          {error ?? 'That paper is not in the library.'}{' '}
          <Link to="/papers">Back to question papers</Link>
        </Notice>
      </div>
    );
  }

  const actions = actionsFor(paper);
  const extraction = extractionSummary(paper);
  const fileUrl = `${apiBaseUrl()}${SOURCE_ROUTES.questionPaperFile(paper.id)}`;

  return (
    <div className={styles.page}>
      <PageHeader
        title={paper.subjectCode ?? paper.title}
        subtitle={paper.subjectTitle ?? paper.title}
      />

      <div className={styles.detailTags}>
        {isDemo(paper) && <span className={styles.demo}>Demo data</span>}
        {matchesSemester(paper, context) && <StatusPill tone="accent">Your semester</StatusPill>}
        <StatusPill tone={paper.availability === 'host' ? 'success' : 'neutral'}>
          {AVAILABILITY_LABEL[paper.availability]}
        </StatusPill>
      </div>

      <Panel title="About this paper">
        <dl className={styles.facts2}>
          <Fact label="Paper" value={paper.title} />
          <Fact label="Subject code" value={paper.subjectCode} />
          <Fact label="Subject" value={paper.subjectTitle} />
          <Fact
            label="Scheme"
            value={paper.schemeId === null ? null : schemeLabel(paper.schemeId)}
          />
          <Fact label="Branch" value={paper.branchName} />
          <Fact
            label="Semester"
            value={paper.semester === null ? null : `Semester ${String(paper.semester)}`}
          />
          <Fact label="Sitting" value={paper.examSession} />
          <Fact label="Year" value={paper.examYear === null ? null : String(paper.examYear)} />
          <Fact
            label="Format"
            value={paper.paperFormat === null ? null : FORMAT_LABEL[paper.paperFormat]}
          />
          <Fact label="Pages" value={paper.pageCount === null ? null : String(paper.pageCount)} />
          {/*
            PROVENANCE AND PERMISSION, PRINTED SEPARATELY (M8 §6). "Source: X"
            says who published it. "Availability" says what GradTools may do
            with it. Neither implies the other.
          */}
          <Fact label="Source" value={paper.sourceName} />
          <Fact label="Availability" value={AVAILABILITY_LABEL[paper.availability]} />
        </dl>
      </Panel>

      {extraction !== null && (
        <Panel title="Question structure">
          <p className={styles.extraction}>{extraction}</p>
          {/*
            STRUCTURAL, NOT SEMANTIC — and said out loud (M8 §20, §48). A parser
            found where the questions start and stop. Nobody has confirmed it
            read them correctly, and no accuracy figure is shown because none
            was measured.
          */}
          <p className={styles.note}>
            Found by reading the paper&rsquo;s layout, not its meaning. The structure has not been
            checked by a person
            {paper.needsReview === true ? ' and this paper was flagged for review' : ''}.
            {paper.parserVersion !== null && ` Parser: ${paper.parserVersion}.`}
            {paper.extractionSource !== null &&
              ` Read from ${paper.extractionSource === 'ocr' ? 'a scan, using OCR' : 'the file’s own text'}.`}
          </p>
        </Panel>
      )}

      {actions.canOpenHere ? (
        <Panel title="The paper">
          <div className={styles.viewerActions}>
            <a className={styles.open} href={fileUrl} target="_blank" rel="noopener noreferrer">
              Open in a new tab
              <span className={styles.visuallyHidden}> (opens in a new tab)</span>
            </a>
            {actions.canOpenOriginal && paper.sourceUrl !== null && (
              <a
                className={styles.external}
                href={paper.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                <Icon name="external" size="small" />
                Original on {hostOf(paper.sourceUrl)}
                <span className={styles.visuallyHidden}> (opens in a new tab)</span>
              </a>
            )}
          </div>
          {/*
            `title` is what a screen reader announces for the frame, and the
            link above is the way out for anyone whose browser will not show a
            PDF inline — a viewer with no fallback is a dead end.
          */}
          <iframe className={styles.viewer} src={fileUrl} title={`${paper.title} (PDF)`} />
        </Panel>
      ) : actions.canOpenOriginal && paper.sourceUrl !== null ? (
        <Panel title="Where to read it">
          <p className={styles.note}>
            GradTools does not have a copy of this paper. It is available from the original source.
          </p>
          <a
            className={styles.open}
            href={paper.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            <Icon name="external" size="small" />
            Open the original on {hostOf(paper.sourceUrl)}
            <span className={styles.visuallyHidden}> (opens in a new tab)</span>
          </a>
        </Panel>
      ) : (
        <Notice tone="warning">
          {actions.unavailableReason ?? 'This paper is not available.'}
        </Notice>
      )}

      <p className={styles.note}>
        <Link className={styles.backLink} to="/papers">
          <Icon name="arrowLeft" size="small" />
          Back to question papers
        </Link>
      </p>
    </div>
  );
}
