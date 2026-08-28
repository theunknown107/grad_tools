/**
 * The question-paper library, fetched.
 *
 * Authority: docs/12 §12.13 · M8 §25, §27
 *
 * NO STUDENT CONTEXT IS SENT (M8 §25). The request carries filters and a search
 * term and nothing else — no branch, no semester, no profile, not even
 * optionally. The library the server returns is the public library, identical
 * for every visitor; which of it matters to this student is decided here, from
 * data that never leaves the device.
 *
 * The search term is the one thing a student types, so it is debounced rather
 * than sent on every keystroke: fewer requests, and fewer partial words
 * reaching a server log that has no reason to see them (M8 §27).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SOURCE_ROUTES,
  type QuestionPaper,
  type QuestionPaperFilters,
} from '@gradtools/shared-types';
import { apiBaseUrl } from '../repositories/reference.js';
import { useProfile, useSemesters } from './useCollection.js';
import { buildSemesterViews, currentSemester } from '../domain/academics.js';
import { sortForStudent, type PaperContext } from '../domain/papers.js';

/** Long enough that a typed word is one request, short enough to feel instant. */
const SEARCH_DEBOUNCE_MS = 250;

export interface PaperQuery {
  readonly search?: string;
  readonly subject?: string;
  readonly scheme?: string;
  readonly branch?: string;
  readonly semester?: string;
  readonly year?: string;
  readonly format?: string;
  readonly sort?: string;
}

export interface PapersState {
  readonly items: readonly QuestionPaper[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

export function usePapers(query: PaperQuery, limit = 50): PapersState {
  const [items, setItems] = useState<readonly QuestionPaper[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  // Only the search is debounced. A filter is one deliberate act, and delaying
  // it would make the controls feel broken.
  const [debouncedSearch, setDebouncedSearch] = useState(query.search ?? '');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(query.search ?? '');
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query.search]);

  const params = useMemo(() => {
    const search = new URLSearchParams();
    const put = (key: string, value: string | undefined) => {
      if (value !== undefined && value !== '' && value !== 'all') search.set(key, value);
    };
    put('search', debouncedSearch);
    put('subject', query.subject);
    put('scheme', query.scheme);
    put('branch', query.branch);
    put('semester', query.semester);
    put('year', query.year);
    put('format', query.format);
    put('sort', query.sort);
    search.set('limit', String(limit));
    return search.toString();
  }, [
    debouncedSearch,
    query.subject,
    query.scheme,
    query.branch,
    query.semester,
    query.year,
    query.format,
    query.sort,
    limit,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${apiBaseUrl()}${SOURCE_ROUTES.questionPapers}?${params}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { data: QuestionPaper[]; total: number };
      })
      .then((body) => {
        if (cancelled) return;
        setItems(body.data);
        setTotal(body.total);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // A library that cannot be reached says so. An empty list would read as
        // "there are no papers", which is a different and wrong answer.
        setError('Could not reach the GradTools server.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params, token]);

  const reload = useCallback(() => {
    setToken((n) => n + 1);
  }, []);

  return { items, total, loading, error, reload };
}

/** One paper. `null` while loading, and after a paper that does not exist. */
export function usePaper(id: string | undefined): {
  paper: QuestionPaper | null;
  loading: boolean;
  error: string | null;
} {
  const [paper, setPaper] = useState<QuestionPaper | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${apiBaseUrl()}${SOURCE_ROUTES.questionPaper(id)}`)
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as QuestionPaper;
      })
      .then((body) => {
        if (cancelled) return;
        setPaper(body);
        // A missing paper is not a broken server. Said differently, because a
        // private or blocked paper is deliberately indistinguishable from one
        // that never existed (M8 §29).
        if (body === null) setError('That paper is not in the library.');
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not reach the GradTools server.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { paper, loading, error };
}

/** The filter values the library can actually offer (M8 §10). */
export function usePaperFilters(): QuestionPaperFilters | null {
  const [filters, setFilters] = useState<QuestionPaperFilters | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBaseUrl()}${SOURCE_ROUTES.questionPaperFilters}`)
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((body) => {
        if (!cancelled) setFilters(body as QuestionPaperFilters | null);
      })
      .catch(() => {
        // A library without filter controls is still a usable library. This
        // failure degrades the page rather than breaking it.
        if (!cancelled) setFilters(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return filters;
}

/**
 * What the device knows about the student, for ordering the library.
 *
 * The semester comes from the degree first and the profile second, for the same
 * reason as everywhere else: a semester marked in progress is maintained, while
 * the profile field is a number typed once.
 */
export function usePaperContext(): PaperContext {
  const { profile } = useProfile();
  const { items: semesters } = useSemesters();

  return useMemo(() => {
    const inProgress = currentSemester(buildSemesterViews(semesters, []));
    return {
      schemeId: profile?.schemeId ?? null,
      // The library matches branches by id; the profile stores a name, so a
      // branch is not matched locally at all rather than matched wrongly.
      branchId: null,
      currentSemester: inProgress?.number ?? profile?.currentSemester ?? null,
    };
  }, [profile, semesters]);
}

/** The library, ordered for whoever is looking. Pure, local, and reversible. */
export function useSortedPapers(papers: readonly QuestionPaper[]): QuestionPaper[] {
  const context = usePaperContext();
  return useMemo(() => sortForStudent(papers, context), [papers, context]);
}
