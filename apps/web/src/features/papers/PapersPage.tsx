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
import { EmptyState, Notice, Panel, SelectField, TextField } from '../../components/ui/index.js';
import { PageHeader } from '../../components/AppShell.js';
import {
  usePaperContext,
  usePaperFilters,
  usePapers,
  useSortedPapers,
} from '../../hooks/usePapers.js';
import { FORMAT_LABEL, schemeLabel } from '../../domain/papers.js';
import { PaperRow } from './PaperRow.js';
import styles from './papers.module.css';

export function PapersPage() {
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('all');
  const [scheme, setScheme] = useState('all');
  const [semester, setSemester] = useState('all');
  const [year, setYear] = useState('all');
  const [format, setFormat] = useState('all');
  const [sort, setSort] = useState('newest');

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

      <Panel title="Find a paper">
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
            Matches the subject code, the subject name, the paper title and the sitting. Plain text
            matching — no interpretation.
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
            <SelectField
              label="Subject"
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value);
              }}
            >
              <option value="all">All subjects</option>
              {filters.subjects.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.title === null ? option.code : `${option.code} — ${option.title}`}
                </option>
              ))}
            </SelectField>
          )}

          {filters !== null && filters.semesters.length > 1 && (
            <SelectField
              label="Semester"
              value={semester}
              onChange={(event) => {
                setSemester(event.target.value);
              }}
            >
              <option value="all">All semesters</option>
              {filters.semesters.map((option) => (
                <option key={option} value={String(option)}>
                  Semester {option}
                </option>
              ))}
            </SelectField>
          )}

          {filters !== null && filters.schemes.length > 1 && (
            <SelectField
              label="Scheme"
              value={scheme}
              onChange={(event) => {
                setScheme(event.target.value);
              }}
            >
              <option value="all">All schemes</option>
              {filters.schemes.map((option) => (
                <option key={option} value={option}>
                  {schemeLabel(option)}
                </option>
              ))}
            </SelectField>
          )}

          {filters !== null && filters.years.length > 1 && (
            <SelectField
              label="Year"
              value={year}
              onChange={(event) => {
                setYear(event.target.value);
              }}
            >
              <option value="all">All years</option>
              {filters.years.map((option) => (
                <option key={option} value={String(option)}>
                  {option}
                </option>
              ))}
            </SelectField>
          )}

          {filters !== null && filters.formats.length > 1 && (
            <SelectField
              label="Format"
              value={format}
              onChange={(event) => {
                setFormat(event.target.value);
              }}
            >
              <option value="all">All formats</option>
              {filters.formats.map((option) => (
                <option key={option} value={option}>
                  {FORMAT_LABEL[option]}
                </option>
              ))}
            </SelectField>
          )}

          <SelectField
            label="Sort"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
            }}
          >
            <option value="newest">Newest sitting first</option>
            <option value="oldest">Oldest sitting first</option>
            <option value="recently_added">Recently added</option>
          </SelectField>
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

      {error !== null ? (
        <Notice tone="warning">
          {error}{' '}
          <button type="button" className={styles.linkButton} onClick={reload}>
            Try again
          </button>
        </Notice>
      ) : loading ? (
        <p className={styles.loading}>Loading papers…</p>
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
