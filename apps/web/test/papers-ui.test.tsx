/**
 * The question-paper library screens.
 *
 * Authority: docs/28 §28.12 · M8 §12, §13, §17, §22, §23, §40
 *
 * SYNTHETIC CONTENT ONLY. Every paper below is invented, and one fixture is
 * deliberately hostile so the rendering path is proven rather than assumed.
 *
 * The tests that matter most here are the negative ones: a blocked paper must
 * offer nothing, a link paper must never offer to open locally, and a field
 * nobody recorded must not appear at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import type { QuestionPaper } from '@gradtools/shared-types';
import { Route, Routes } from 'react-router-dom';
import { PapersPage } from '../src/features/papers/PapersPage.js';
import { PaperDetailPage } from '../src/features/papers/PaperDetailPage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { StudentProfile } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function paper(overrides: Partial<QuestionPaper> = {}): QuestionPaper {
  return {
    id: 'paper-1',
    title: 'Fourth semester examination, June/July 2025',
    subjectId: null,
    subjectCode: 'BCS403',
    subjectTitle: 'Database Management Systems',
    schemeId: 'vtu-2022',
    branchId: 'cse',
    branchName: 'Computer Science and Engineering',
    semester: 4,
    examYear: 2025,
    examSession: 'June/July 2025',
    paperFormat: 'descriptive',
    pageCount: 4,
    sourceId: 'demo-question-papers',
    sourceName: 'Demo University (synthetic)',
    sourceUrl: null,
    availability: 'host',
    rightsStatus: 'permitted',
    questionCount: null,
    mcqItemCount: null,
    extractionSource: null,
    parserVersion: null,
    needsReview: null,
    addedAt: '2026-08-01T00:00:00+05:30',
    ...overrides,
  };
}

function profile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id: profileId,
    authUserId: null,
    displayName: null,
    usn: null,
    collegeName: 'Demo Engineering College',
    schemeId: 'vtu-2022',
    branch: 'Computer Science and Engineering',
    currentSemester: 4,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Serves the library API and records every URL that was requested. */
function mockLibrary(items: QuestionPaper[]) {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);

      if (url.includes('/question-papers/filters')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              subjects: [
                { code: 'BCS403', title: 'Database Management Systems' },
                { code: 'BCS401', title: null },
              ],
              schemes: ['vtu-2022'],
              branches: [{ id: 'cse', name: 'Computer Science and Engineering' }],
              semesters: [3, 4],
              years: [2025, 2024],
              formats: ['descriptive', 'mcq'],
              sources: [{ id: 'demo-question-papers', name: 'Demo University (synthetic)' }],
            }),
        } as Response);
      }

      // A by-id request: /question-papers/<id> with no query string.
      const byId = /\/question-papers\/([^/?]+)$/.exec(url);
      if (byId !== null) {
        const found = items.find((item) => item.id === byId[1]);
        return Promise.resolve({
          ok: found !== undefined,
          status: found === undefined ? 404 : 200,
          json: () => Promise.resolve(found ?? null),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: items, total: items.length, limit: 50, offset: 0 }),
      } as Response);
    }),
  );
  return requests;
}

/**
 * The detail page reads its id from the route, so it needs a matching route
 * rather than a bare render — without one `useParams` is empty and the page
 * waits for an id that never arrives.
 */
function renderDetail({ route }: { route: string }) {
  return renderWith(
    <Routes>
      <Route path="/papers/:id" element={<PaperDetailPage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The list                                                                   */
/* -------------------------------------------------------------------------- */

describe('the library list', () => {
  it('shows the code, the subject and the sitting', async () => {
    mockLibrary([paper()]);
    renderWith(<PapersPage />);

    const code = await screen.findByRole('link', { name: 'BCS403' });
    const row = code.closest('article') as HTMLElement;

    expect(within(row).getByText('Database Management Systems')).toBeTruthy();
    /*
     * The facts line carries only what VARIES between rows (M9.3 §29). Branch
     * and scheme are identical across a filtered library, so repeating them on
     * every row cost a wrapped line and told a student nothing; they remain on
     * the paper's own page and as filters.
     */
    const facts = within(row).getByText(/June\/July 2025/);
    expect(facts.textContent).toContain('Sem 4');
    expect(facts.textContent).toContain('Descriptive');
    expect(facts.textContent).not.toContain('Computer Science and Engineering');
  });

  /* SYNTHETIC CONTENT SAYS SO, from the record's own source (M8 §18). */
  it('labels demo papers as demo data', async () => {
    mockLibrary([paper()]);
    renderWith(<PapersPage />);
    expect(await screen.findByText('Demo')).toBeTruthy();
  });

  it('does not label a paper from a real source as demo data', async () => {
    mockLibrary([paper({ sourceId: 'a-real-source', sourceName: 'A College' })]);
    renderWith(<PapersPage />);

    await screen.findByRole('link', { name: 'BCS403' });
    expect(screen.queryByText('Demo')).toBeNull();
  });

  /*
   * PROVENANCE AND PERMISSION ARE TWO STATEMENTS (M8 §6, §13). A row that
   * showed only the source would invite the reader to assume the second from
   * the first.
   */
  it('shows the source and the availability as separate facts', async () => {
    mockLibrary([paper()]);
    renderWith(<PapersPage />);

    const row = (await screen.findByRole('link', { name: 'BCS403' })).closest(
      'article',
    ) as HTMLElement;

    /*
     * PROVENANCE AND PERMISSION ARE STILL TWO CLAIMS (M8 §6) — they simply share
     * the facts line now instead of occupying two of their own.
     */
    const facts = within(row).getByText(/Demo University \(synthetic\)/);
    expect(facts.textContent).toContain('Demo University (synthetic)');
    expect(facts.textContent).toContain('Available here');
  });

  it('offers Open for a hosted paper', async () => {
    mockLibrary([paper({ availability: 'host' })]);
    renderWith(<PapersPage />);
    expect(await screen.findByRole('link', { name: 'Open' })).toBeTruthy();
  });

  /* A link paper leaves GradTools, visibly (M8 §13, §15). */
  it('offers the original host for a link paper, never a local Open', async () => {
    mockLibrary([
      paper({ availability: 'link', sourceUrl: 'https://example.org/papers/bcs403.pdf' }),
    ]);
    renderWith(<PapersPage />);

    const link = await screen.findByRole('link', { name: /example\.org/ });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
  });

  /* Absent metadata is absent, not a placeholder (M8 §12). */
  it('shows nothing at all for fields nobody recorded', async () => {
    mockLibrary([paper({ examYear: null, examSession: null, semester: null, subjectTitle: null })]);
    renderWith(<PapersPage />);

    const row = (await screen.findByRole('link', { name: 'BCS403' })).closest(
      'article',
    ) as HTMLElement;

    expect(within(row).queryByText(/Semester/)).toBeNull();
    expect(within(row).queryByText('Unknown')).toBeNull();
    expect(within(row).queryByText('—')).toBeNull();
  });

  it('marks a paper from the student’s own semester', async () => {
    mockLibrary([paper({ semester: 4 })]);
    renderWith(<PapersPage />, {
      repositories: createMemoryRepositories({ profile: profile({ currentSemester: 4 }) }).bundle,
    });

    expect(await screen.findByText('Your semester')).toBeTruthy();
  });

  /*
   * THE SEMESTER IS A SUGGESTION, NOT A FILTER (M8 §26). Every paper is still
   * listed; the student is offered a shortcut they can decline.
   */
  it('suggests the student’s semester without applying it', async () => {
    mockLibrary([paper({ semester: 4 }), paper({ id: 'p2', semester: 7, subjectCode: 'BCS701' })]);
    renderWith(<PapersPage />, {
      repositories: createMemoryRepositories({ profile: profile({ currentSemester: 4 }) }).bundle,
    });

    await screen.findByRole('link', { name: 'BCS403' });
    // The other semester is still there.
    expect(screen.getByRole('link', { name: 'BCS701' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show only semester 4/ })).toBeTruthy();
  });

  it('reports an unreachable library rather than showing an empty one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    renderWith(<PapersPage />);

    expect(await screen.findByText(/Could not reach the GradTools server/)).toBeTruthy();
    expect(screen.queryByText(/No papers in the library yet/)).toBeNull();
  });

  it('says the library is empty when it is', async () => {
    mockLibrary([]);
    renderWith(<PapersPage />);
    expect(await screen.findByText(/No papers in the library yet/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Search and filters                                                         */
/* -------------------------------------------------------------------------- */

describe('finding a paper', () => {
  /* NO STUDENT CONTEXT IS EVER SENT (M8 §25). */
  it('never puts the student’s profile in a request', async () => {
    const requests = mockLibrary([paper()]);
    renderWith(<PapersPage />, {
      repositories: createMemoryRepositories({ profile: profile() }).bundle,
    });

    await screen.findByRole('link', { name: 'BCS403' });

    for (const url of requests) {
      expect(url).not.toMatch(/usn|profile|branch=|college/i);
    }
  });

  it('sends the search term to the API, debounced', async () => {
    const requests = mockLibrary([paper()]);
    renderWith(<PapersPage />);

    await screen.findByRole('link', { name: 'BCS403' });
    await userEvent.type(screen.getByLabelText('Search'), 'BCS403');

    await waitFor(() => {
      expect(requests.some((url) => url.includes('search=BCS403'))).toBe(true);
    });
    // One request per settled term, not one per keystroke.
    expect(requests.filter((url) => url.includes('search=')).length).toBeLessThan(6);
  });

  /*
   * M9.6B replaced the native <select> with a listbox combobox, so these three
   * now drive the control the way a person does — open it, then read or choose
   * a row. The ASSERTIONS are unchanged: same values offered, same query
   * parameter sent, same prohibition on a sort that claims importance.
   */
  it('offers only the filter values the library actually holds', async () => {
    mockLibrary([paper()]);
    renderWith(<PapersPage />);

    const subject = await screen.findByRole('combobox', { name: /subject/i });
    await userEvent.click(subject);

    const options = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    expect(options[0]).toContain('All subjects');
    expect(options.join(' ')).toContain('BCS403');
    expect(options.join(' ')).toContain('BCS401');
    expect(options).toHaveLength(3);
  });

  it('sends a chosen filter as a query parameter', async () => {
    const requests = mockLibrary([paper()]);
    renderWith(<PapersPage />);

    await screen.findByRole('link', { name: 'BCS403' });
    await userEvent.click(await screen.findByRole('combobox', { name: /semester/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Semester 4' }));

    await waitFor(() => {
      expect(requests.some((url) => url.includes('semester=4'))).toBe(true);
    });
  });

  /* Nothing on this screen claims a paper is important (M8 §11, §46). */
  it('offers no sort that claims importance', async () => {
    mockLibrary([paper()]);
    renderWith(<PapersPage />);

    await userEvent.click(await screen.findByRole('combobox', { name: /sort/i }));
    const labels = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.join(' ')).not.toMatch(/important|useful|likely|recommended|popular/i);
  });
});

/* -------------------------------------------------------------------------- */
/* The detail page                                                            */
/* -------------------------------------------------------------------------- */

describe('one paper', () => {
  it('shows the metadata that exists and omits the rest', async () => {
    mockLibrary([paper({ id: 'p1', pageCount: null, examSession: null })]);
    renderDetail({ route: '/papers/p1' });

    expect(await screen.findAllByText('Database Management Systems')).not.toHaveLength(0);
    expect(screen.getByText('Subject code')).toBeTruthy();
    expect(screen.queryByText('Pages')).toBeNull();
    expect(screen.queryByText('Sitting')).toBeNull();
  });

  it('embeds the browser’s own viewer for a hosted paper', async () => {
    mockLibrary([paper({ id: 'p1', availability: 'host' })]);
    const { container } = renderDetail({ route: '/papers/p1' });

    await screen.findByRole('link', { name: /Open in a new tab/ });
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toContain('/question-papers/p1/file');
    // A frame with no accessible name is unusable with a screen reader.
    expect(frame?.getAttribute('title')).toBeTruthy();
  });

  /*
   * A LINK PAPER IS NEVER FRAMED OR FETCHED (M8 §15). The page says GradTools
   * does not have it and points at the source.
   */
  it('shows a link paper as a link and never frames it', async () => {
    mockLibrary([
      paper({ id: 'p1', availability: 'link', sourceUrl: 'https://example.org/p.pdf' }),
    ]);
    const { container } = renderDetail({ route: '/papers/p1' });

    expect(await screen.findByText(/GradTools does not have a copy/)).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link', { name: /example\.org/ })).toBeTruthy();
  });

  /* A blocked paper offers nothing to open, anywhere (M8 §17). */
  it('offers no way to open a blocked paper', async () => {
    mockLibrary([
      paper({ id: 'p1', availability: 'blocked', sourceUrl: 'https://example.org/p.pdf' }),
    ]);
    const { container } = renderDetail({ route: '/papers/p1' });

    expect(await screen.findByText('This paper is not available.')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('link', { name: /Open/ })).toBeNull();
  });

  it('says plainly when a paper is not in the library', async () => {
    mockLibrary([]);
    renderDetail({ route: '/papers/missing' });
    expect(await screen.findAllByText(/not in the library/)).not.toHaveLength(0);
  });

  /*
   * STRUCTURAL, NOT SEMANTIC, AND SAID SO (M8 §20, §48). The count is a fact
   * about the file; the sentence beside it is what stops the count from
   * reading as a guarantee.
   */
  it('shows the question count with its caveat, and no accuracy figure', async () => {
    mockLibrary([
      paper({
        id: 'p1',
        questionCount: 10,
        mcqItemCount: 0,
        parserVersion: 'positional-v2',
        extractionSource: 'native',
        needsReview: true,
      }),
    ]);
    renderDetail({ route: '/papers/p1' });

    expect(await screen.findByText('10 questions found')).toBeTruthy();
    const caveat = screen.getByText(/not its meaning/);
    expect(caveat.textContent).toMatch(/has not been checked by a person/);
    expect(caveat.textContent).toMatch(/flagged for review/);
    expect(caveat.textContent).not.toMatch(/\d+%|accura|verified/i);
  });

  it('shows no structure panel when no parser has run', async () => {
    mockLibrary([paper({ id: 'p1', questionCount: null })]);
    renderDetail({ route: '/papers/p1' });

    await screen.findAllByText('Database Management Systems');
    expect(screen.queryByText('Question structure')).toBeNull();
  });

  /* Untrusted text is TEXT. It came from a PDF, not from a template. */
  it('renders a hostile title as text rather than markup', async () => {
    mockLibrary([
      paper({
        id: 'p1',
        subjectCode: null,
        subjectTitle: '<img src=x onerror="alert(1)">',
        title: '<script>alert(1)</script>',
      }),
    ]);
    const { container } = renderDetail({ route: '/papers/p1' });

    // Escaped in every place it appears, which is the point.
    expect(await screen.findAllByText('<script>alert(1)</script>')).not.toHaveLength(0);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
