/**
 * The question-paper library.
 *
 * Authority: docs/28 §28.12 · docs/17 §17.13 · M8 §2, §9, §10, §23, §33
 *
 * ---------------------------------------------------------------------------
 * SEARCH FIRST
 * ---------------------------------------------------------------------------
 * A student arrives knowing which paper they want. The search box is the first
 * control, the filters are compact and secondary, and the results are dense
 * rows rather than a grid of cards — this is a finding tool, not a gallery
 * (M8 §23, §33).
 *
 * NOTHING HERE IS RANKED BY IMPORTANCE. The order is the student's own
 * semester first, then the most recent sitting, and that is the whole of it
 * (M8 §11, §46).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Notice, Panel, TextField } from '../../components/ui/index.js';
import { Select } from '../../components/ui/Select.js';
import { IslandTabs } from '../../components/ui/IslandTabs.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { PageHeader } from '../../components/AppShell.js';
import {
  useQuestionSearch,
  usePaperContext,
  usePaperFilters,
  usePapers,
  useSortedPapers,
} from '../../hooks/usePapers.js';
import { FORMAT_LABEL, schemeLabel } from '../../domain/papers.js';
import { PaperRow } from './PaperRow.js';
import { QuestionResults } from './QuestionResults.js';
import styles from './papers.module.css';

export function PapersPage() {
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('all');
  const [scheme, setScheme] = useState('all');
  const [semester, setSemester] = useState('all');
  const [year, setYear] = useState('all');
  const [format, setFormat] = useState('all');
  const [sort, setSort] = useState('newest');

  /*
   * ONE SEARCH BOX, TWO THINGS TO FIND (M10B §35). "Which papers exist" and
   * "where has this been asked" are the same act with different results, so
   * they share the box and the filters rather than becoming two screens with
   * two search fields a student has to choose between before typing.
   */
  const [mode, setMode] = useState<'papers' | 'questions'>('papers');

  const filters = usePaperFilters();
  const context = usePaperContext();
  const { items, total, loading, error, reload } = usePapers({
    search,
    subject,
    scheme,
    semester,
    year,
    format,
    sort,
  });
  const papers = useSortedPapers(items);

  /*
   * Called on every render, not only in question mode: a hook cannot be
   * conditional. The cost of the extra request is one small query against
   * reference data, and switching modes is then instant rather than showing a
   * spinner for something the page could already have had.
   */
  const questions = useQuestionSearch({ search, subject, semester, year });

  /*
   * The suggestion, not a filter (M8 §26). A student's semester decides what is
   * offered as a shortcut and what sorts first; it never decides what the
   * library contains, and the control that applies it can be undone in one
   * click.
   */
  const suggestion =
    context.currentSemester !== null && semester === 'all' ? context.currentSemester : null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Question papers"
        subtitle="Past papers in one place. GradTools shows them; it does not issue them."
      />

      {/*
        -------------------------------------------------------------------
        M9.6F: THE LIBRARY IS TWO VIEWS, NOT A PANEL WITH A RADIOGROUP
        -------------------------------------------------------------------

        Papers and Questions are genuinely different content — one lists
        documents, the other lists sentences pulled out of them — which is what
        justifies tabs rather than a filter. The mode switch is now the first
        thing on the page and carries live counts, so the library says how much
        it holds before you type anything.

        Replacing the radiogroup was a real trade and worth naming: radios gave
        arrow-key navigation and a spoken group name for free. IslandTabs
        provides both (WAI-ARIA tabs: arrows move, only the selected tab is
        tabbable, the tablist is named), so nothing was lost — and the tabs
        carry counts, which the radios could not.
      */}
      <div className={styles.modeBar}>
        <IslandTabs
          label="Search for"
          value={mode}
          controlsPanel={false}
          onChange={(id) => {
            setMode(id as 'papers' | 'questions');
          }}
          tabs={[
            { id: 'papers', label: 'Papers', ...(total > 0 ? { count: total } : {}) },
            {
              id: 'questions',
              label: 'Questions',
              ...(questions.total > 0 ? { count: questions.total } : {}),
            },
          ]}
        />
      </div>

      <Panel title={mode === 'papers' ? 'Find a paper' : 'Find a question'}>
        <div className={styles.search}>
          <TextField
            label="Search"
            icon="search"
            placeholder="Subject code, subject name, or year"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <p className={styles.searchNote}>
            {mode === 'papers'
              ? 'Matches the subject code, the subject name, the paper title and the sitting. Plain text matching — no interpretation.'
              : 'Matches the text GradTools read from the paper, and the question number. Plain text matching — no interpretation.'}
          </p>
        </div>

        <div className={styles.filters}>
          {/*
            EVERY CONTROL IS BUILT FROM WHAT THE LIBRARY ACTUALLY HOLDS (M8 §10).
            A filter with one possible value is not offered at all, because a
            control that cannot change the result teaches a student that the
            filters do nothing.
          */}
          {filters !== null && filters.subjects.length > 1 && (
            <Select
              label="Subject"
              icon="papers"
              value={subject}
              onChange={setSubject}
              options={[
                { value: 'all', label: 'All subjects' },
                ...filters.subjects.map((option) => ({
                  value: option.code,
                  label: option.code,
                  // The title goes in the hint line rather than the label, so
                  // the codes stay in a scannable column instead of every row
                  // starting at a different width.
                  ...(option.title === null ? {} : { hint: option.title }),
                })),
              ]}
            />
          )}

          {filters !== null && filters.semesters.length > 1 && (
            <Select
              label="Semester"
              icon="degree"
              value={semester}
              onChange={setSemester}
              options={[
                { value: 'all', label: 'All semesters' },
                ...filters.semesters.map((option) => ({
                  value: String(option),
                  label: `Semester ${String(option)}`,
                })),
              ]}
            />
          )}

          {filters !== null && filters.schemes.length > 1 && (
            <Select
              label="Scheme"
              icon="results"
              value={scheme}
              onChange={setScheme}
              options={[
                { value: 'all', label: 'All schemes' },
                ...filters.schemes.map((option) => ({ value: option, label: schemeLabel(option) })),
              ]}
            />
          )}

          {filters !== null && filters.years.length > 1 && (
            <Select
              label="Year"
              value={year}
              onChange={setYear}
              options={[
                { value: 'all', label: 'All years' },
                ...filters.years.map((option) => ({
                  value: String(option),
                  label: String(option),
                })),
              ]}
            />
          )}

          {/*
            PAPER-ONLY CONTROLS. Format and Sort shape the paper listing and do
            nothing to a question search, and a control that does nothing is
            worse than a missing one — it teaches a student that the filters are
            unreliable.
          */}
          {mode === 'papers' && filters !== null && filters.formats.length > 1 && (
            <Select
              label="Format"
              value={format}
              onChange={setFormat}
              options={[
                { value: 'all', label: 'All formats' },
                ...filters.formats.map((option) => ({
                  value: option,
                  label: FORMAT_LABEL[option],
                })),
              ]}
            />
          )}

          {mode === 'papers' && (
            <Select
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'newest', label: 'Newest sitting first' },
                { value: 'oldest', label: 'Oldest sitting first' },
                { value: 'recently_added', label: 'Recently added' },
              ]}
            />
          )}
        </div>

        {suggestion !== null && (
          <p className={styles.suggestion}>
            You are in semester {suggestion}.{' '}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setSemester(String(suggestion));
              }}
            >
              Show only semester {suggestion}
            </button>
          </p>
        )}
      </Panel>

      {mode === 'questions' ? (
        <Panel title="Questions" flush>
          <QuestionResults
            results={questions.items}
            total={questions.total}
            loading={questions.loading}
            error={questions.error}
            searched={search !== '' || subject !== 'all' || semester !== 'all' || year !== 'all'}
          />
        </Panel>
      ) : error !== null ? (
        <Notice tone="warning">
          {error}{' '}
          <button type="button" className={styles.linkButton} onClick={reload}>
            Try again
          </button>
        </Notice>
      ) : loading ? (
        /*
         * A skeleton SHAPED LIKE THE ROWS it replaces (M9.6D §31). The bare
         * "Loading papers…" line was one line tall, so the list snapped down
         * the page when 50 rows arrived. Six placeholder rows hold the space.
         */
        <Skeleton lines={6} height="42px" radius="md" label="Loading papers" />
      ) : papers.length === 0 ? (
        <EmptyState>
          {search === '' && subject === 'all' && semester === 'all' && year === 'all'
            ? 'No papers in the library yet. Papers appear here once a source is connected or an operator adds one.'
            : 'No paper matches those filters. Try a different subject, year or search term.'}
        </EmptyState>
      ) : (
        /*
          ONE MODULE, FIFTY ROWS (M9.5.1 §4).
          Fifty bordered cards would be eight thousand pixels of decoration —
          but the answer to that is not fifty rows floating on the page ground,
          which is what it was. The reference's list is a single bordered
          surface with dense rows and hairlines inside it, and that costs one
          border for the whole library rather than fifty.
        */
        <Panel
          title="Results"
          flush
          action={
            <span className={styles.count}>
              {papers.length === total
                ? `${String(total)} paper${total === 1 ? '' : 's'}`
                : `Showing ${String(papers.length)} of ${String(total)}`}
            </span>
          }
        >
          <ul className={styles.list}>
            {papers.map((paper) => (
              <li key={paper.id}>
                <PaperRow paper={paper} context={context} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/**
 * The dashboard's compact library section.
 *
 * A FEW ROWS AND A WAY IN (M8 §24). The dashboard belongs to the student's
 * current semester and their academics; papers are a resource on it, not the
 * subject of it.
 */
export function RecentPapers() {
  const context = usePaperContext();
  const { items, loading, error } = usePapers({ sort: 'recently_added' }, 4);
  const papers = useSortedPapers(items);

  // A dashboard is not the place to report that a secondary resource is
  // unreachable; the library page says so properly when a student goes there.
  if (error !== null || (!loading && papers.length === 0)) return null;

  return (
    <Panel
      title="Question papers"
      action={
        <Link className={styles.viewAll} to="/papers">
          Browse all
        </Link>
      }
    >
      {loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <ul className={styles.compactList}>
          {papers.map((paper) => (
            <li key={paper.id}>
              <PaperRow paper={paper} context={context} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
