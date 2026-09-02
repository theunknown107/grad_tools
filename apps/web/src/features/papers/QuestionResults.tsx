/**
 * Question search results.
 *
 * Authority: docs/18 (M10B) · M10B §4, §23, §25, §34, §36, §37, §38
 *
 * ---------------------------------------------------------------------------
 * EXTRACTED TEXT IS NOT THE PAPER
 * ---------------------------------------------------------------------------
 *
 * Every row here is machine output from a scan. In the local corpus half the
 * current questions have no text at all, most are unreviewed, and the ones that
 * survive routinely carry OCR damage — dropped words, mangled mathematics,
 * instruction lines that read like questions. Presenting that as if it were the
 * paper would be the single most misleading thing this product could do
 * (M10B §4, §5).
 *
 * So each row states where it came from and how much it can be trusted, and the
 * caveats are part of the row rather than a footnote under the list. A student
 * who wants the actual question can open the paper, and the row says so.
 *
 * NO PREDICTION, ANYWHERE (M10B §14). Nothing here counts how often something
 * appeared, ranks a question by importance, or suggests what an exam will
 * contain. The corpus cannot support any of it, and frequency would not license
 * it even if it could.
 */

import { Link } from 'react-router-dom';
import type { QuestionSearchResult } from '@gradtools/shared-types';
import { Icon } from '../../components/icons.js';
import { StatusPill } from '../../components/ui/index.js';
import { Empty, LoadError, Rows, Skeleton } from '../../components/ui/layout.js';
import styles from './papers.module.css';

/**
 * How much the parser trusted its own reading of the page.
 *
 * A WORKFLOW STATE, NOT A SCORE (M10B §26). There is no ground truth for this
 * corpus, so any percentage would be invented. `high` is deliberately silent:
 * marking every row would make the marks wallpaper and leave the ones that
 * matter no louder than the rest.
 */
function ConfidenceMark({ result }: { readonly result: QuestionSearchResult }) {
  if (result.isReviewed) {
    return <StatusPill tone="success">Checked by a person</StatusPill>;
  }
  if (result.confidence === 'review_required' || result.needsReview) {
    return <StatusPill tone="warning">Needs checking</StatusPill>;
  }
  if (result.confidence === 'low') {
    return <StatusPill tone="warning">Low confidence</StatusPill>;
  }
  return null;
}

function QuestionRow({ result }: { readonly result: QuestionSearchResult }) {
  const provenance = [
    result.subjectCode,
    result.examSession ?? (result.examYear === null ? null : String(result.examYear)),
    /*
     * LABELLED. The parser stores a module as a bare "4", and printed between
     * a sitting and a mark count it reads as a stray digit — found by looking
     * at the populated screen, not by a test (M10B.1 §13).
     */
    result.module === null ? null : `Module ${result.module}`,
    result.marks === null ? null : `${String(result.marks)} marks`,
    /*
     * Named BOTH ways (M10B.2 §18). OCR text and text lifted from a digital
     * PDF are not equally trustworthy, and until now only the scan was
     * labelled — so a native result was identified by the absence of a mark,
     * which is not something a reader can notice. Neither phrase claims
     * accuracy; they say where the characters came from.
     */
    result.extractionSource === 'ocr' ? 'from a scan' : 'from the PDF text',
  ].filter((part): part is string => part !== null && part !== '');

  return (
    <li className={styles.questionRow} data-source={result.extractionSource}>
      <div className={styles.questionHead}>
        {result.questionNumber !== null && (
          <span className={styles.questionNumber}>{result.questionNumber}</span>
        )}
        <ConfidenceMark result={result} />
      </div>

      {/*
        Rendered as TEXT. React escapes it, and nothing here interprets markup,
        follows a URL out of it or lets it reach a template (M10B §8, §41).
      */}
      <p className={styles.questionText}>{result.text}</p>

      <p className={styles.questionMeta}>
        {provenance.join(' · ')}
        {provenance.length > 0 ? ' · ' : ''}
        <Link to={`/papers/${result.documentId}`}>Open the paper</Link>
      </p>
    </li>
  );
}

export function QuestionResults({
  results,
  total,
  loading,
  error,
  searched,
}: {
  readonly results: readonly QuestionSearchResult[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: string | null;
  /** Whether the student has narrowed anything yet. */
  readonly searched: boolean;
}) {
  if (error !== null) {
    return <LoadError>{error}</LoadError>;
  }
  if (loading) {
    return <Skeleton rows={4} />;
  }
  if (results.length === 0) {
    return (
      <Empty>
        {searched
          ? 'No extracted question matches that. Only papers GradTools has processed are searchable, and a scan that produced no readable text cannot be found this way.'
          : 'Search to find a question across the papers GradTools has processed.'}
      </Empty>
    );
  }

  return (
    <>
      <p className={styles.count}>
        {results.length === total
          ? `${String(total)} question${total === 1 ? '' : 's'}`
          : `Showing ${String(results.length)} of ${String(total)}`}
      </p>

      {/*
        Said ONCE, above the list, not repeated on every row (M9.3 §13). It is
        true of every result, and a caveat printed thirty times becomes
        something a student learns to scroll past.
      */}
      <p className={styles.questionCaveat}>
        <Icon name="info" size="small" />
        This text was read from the paper by machine and most of it has not been checked by a
        person. Mathematics and non-English text are often damaged. Open the paper for the real
        wording.
      </p>

      <Rows>
        {results.map((result) => (
          <QuestionRow key={result.id} result={result} />
        ))}
      </Rows>
    </>
  );
}
