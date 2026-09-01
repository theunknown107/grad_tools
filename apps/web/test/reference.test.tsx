/**
 * Reference-data frontend tests.
 *
 * Authority: M5a §22
 *
 * Covers the API repository, the loading / error / empty / retry states, and
 * the boundary that matters most in this milestone: student data must stay
 * local even though the app now talks to a server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from '../src/features/profile/ProfilePage.js';
import { AttendancePage } from '../src/features/attendance/AttendancePage.js';
import { ReferenceError, apiReferenceRepository } from '../src/repositories/reference.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const SCHEME = {
  id: 'vtu-2022',
  universityId: 'vtu',
  code: '2022',
  regulationCode: '22OB',
  name: 'VTU 2022 Scheme',
  effectiveFrom: '2022-08-01',
  effectiveTo: null,
  provenance: {
    sourceUrl: 'https://vtu.ac.in/reg.pdf',
    sourceClause: '22OB',
    verifiedAt: '2026-08-23',
    verifiedBy: 'lead',
  },
};

const BRANCH = {
  id: 'cse',
  universityId: 'vtu',
  code: 'CS',
  name: 'Computer Science and Engineering',
};

const SUBJECT = {
  id: 'sub-1',
  schemeId: 'vtu-2022',
  branchId: 'cse',
  semester: 1,
  code: 'BMATS101',
  title: 'Mathematics-I for CSE Stream',
  credits: 4,
  category: 'core',
  cieMax: 50,
  seeMax: 100,
  hasSee: true,
  moduleCount: 5,
  provenance: {
    sourceUrl: 'https://vtu.ac.in/pdf/2022syll/csesch.pdf',
    sourceClause: 'Scheme of Teaching 2022',
    verifiedAt: '2026-08-24',
    verifiedBy: 'lead',
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Routes a stubbed fetch by path so tests read as intent, not URL matching. */
function stubApi(handler: (path: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      return Promise.resolve(handler(path));
    }),
  );
}

const happyPath = (path: string): Response => {
  if (path.startsWith('/api/v1/schemes')) return jsonResponse({ data: [SCHEME] });
  if (path.startsWith('/api/v1/branches')) return jsonResponse({ data: [BRANCH] });
  if (path.startsWith('/api/v1/subjects')) return jsonResponse({ data: [SUBJECT] });
  return jsonResponse({ data: [] });
};

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

describe('apiReferenceRepository', () => {
  it('calls the real API and parses the contract', async () => {
    stubApi(happyPath);
    const schemes = await apiReferenceRepository.listSchemes();
    expect(schemes).toHaveLength(1);
    expect(schemes[0]?.regulationCode).toBe('22OB');
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('passes filters as query parameters', async () => {
    const seen: string[] = [];
    stubApi((path) => {
      seen.push(path);
      return jsonResponse({ data: [SUBJECT] });
    });
    await apiReferenceRepository.listSubjects({ scheme: 'vtu-2022', branch: 'cse', semester: 1 });
    expect(seen[0]).toContain('scheme=vtu-2022');
    expect(seen[0]).toContain('branch=cse');
    expect(seen[0]).toContain('semester=1');
  });

  it('reports a network failure distinctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await expect(apiReferenceRepository.listSchemes()).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('surfaces the server error message from the standard envelope', async () => {
    stubApi(() =>
      jsonResponse(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'No published scheme with id "nope".',
            reference: 'err_1',
          },
        },
        404,
      ),
    );
    await expect(apiReferenceRepository.getSchemeRules('nope')).rejects.toMatchObject({
      kind: 'server',
      message: 'No published scheme with id "nope".',
    });
  });

  it('rejects a response that violates the contract', async () => {
    // A server that drifts from the contract must fail loudly here rather than
    // producing a confusing render downstream.
    stubApi(() => jsonResponse({ data: [{ id: 'x', nope: true }] }));
    await expect(apiReferenceRepository.listSchemes()).rejects.toBeInstanceOf(ReferenceError);
    await expect(apiReferenceRepository.listSchemes()).rejects.toMatchObject({
      kind: 'contract',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Profile screen                                                             */
/* -------------------------------------------------------------------------- */

describe('profile reference data', () => {
  it('renders branches and subjects from the server', async () => {
    stubApi(happyPath);
    renderWith(<ProfilePage />);

    expect(await screen.findByText('BMATS101')).toBeTruthy();
    expect(screen.getByText('Mathematics-I for CSE Stream')).toBeTruthy();
    const branchSelect = await screen.findByLabelText(/^branch$/i);
    expect(branchSelect.tagName).toBe('SELECT');
  });

  it('shows a loading state before data arrives', async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    renderWith(<ProfilePage />);
    expect((await screen.findAllByText(/loading/i)).length).toBeGreaterThan(0);
    release(jsonResponse({ data: [] }));
  });

  it('shows a retryable error, and states that local data is unaffected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    renderWith(<ProfilePage />);

    expect(await screen.findAllByText(/could not reach the gradtools server/i)).toBeTruthy();
    // The reassurance matters: a server outage must not read as data loss.
    expect(screen.getAllByText(/stored on this device and is unaffected/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole('button', { name: /try again/i }).length).toBeGreaterThan(0);
  });

  it('recovers when retry succeeds', async () => {
    const user = userEvent.setup();
    let shouldFail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (shouldFail) return Promise.reject(new TypeError('offline'));
        const path = (typeof input === 'string' ? input : input.toString()).replace(
          /^https?:\/\/[^/]+/,
          '',
        );
        return Promise.resolve(happyPath(path));
      }),
    );

    renderWith(<ProfilePage />);
    await screen.findAllByRole('button', { name: /try again/i });
    shouldFail = false;

    /*
     * Each reference query owns its own AsyncSection and its own retry button,
     * so recovering the screen means retrying all of them. The buttons unmount
     * as their section succeeds, so a held reference goes stale: re-query on
     * every pass instead of iterating a captured list.
     */
    for (let pass = 0; pass < 5; pass += 1) {
      const remaining = screen.queryAllByRole('button', { name: /try again/i });
      const next = remaining[0];
      if (next === undefined) break;
      await user.click(next);
    }

    await waitFor(() => {
      expect(screen.getByText('BMATS101')).toBeTruthy();
    });
  });

  it('says the data is missing rather than showing an empty table', async () => {
    stubApi((path) =>
      path.startsWith('/api/v1/subjects')
        ? jsonResponse({ data: [] })
        : jsonResponse({ data: [BRANCH] }),
    );
    renderWith(<ProfilePage />);
    expect(await screen.findByText(/no verified subjects/i)).toBeTruthy();
    expect(screen.getByText(/only publishes subject data it has verified/i)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* The privacy boundary                                                       */
/* -------------------------------------------------------------------------- */

describe('student data stays local', () => {
  it('sends no student data to the server when attendance is recorded', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    stubApi((path) => {
      calls.push(path);
      return jsonResponse({ data: [] });
    });

    const { bundle, peek } = createMemoryRepositories();
    renderWith(<AttendancePage />, { repositories: bundle });

    await user.type(screen.getByLabelText(/^subject code$/i), 'BCS304');
    await user.type(screen.getByLabelText(/^attended$/i), '45');
    await user.type(screen.getByLabelText(/^conducted$/i), '50');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await screen.findAllByText('90.0%');

    // It was stored locally...
    expect(peek.attendance()).toHaveLength(1);
    // ...and the attendance screen made no network request at all.
    expect(calls).toHaveLength(0);
  });

  it('never sends the profile to the server', async () => {
    const user = userEvent.setup();
    const requests: { path: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = (typeof input === 'string' ? input : input.toString()).replace(
          /^https?:\/\/[^/]+/,
          '',
        );
        requests.push({ path, method: init?.method ?? 'GET' });
        return Promise.resolve(happyPath(path));
      }),
    );

    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ProfilePage />, { repositories: bundle });

    await screen.findByText('BMATS101');
    await user.type(screen.getByLabelText(/^name$/i), 'Ravi');
    await user.type(screen.getByLabelText(/^usn$/i), '1XX22CS001');
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(peek.profile()?.displayName).toBe('Ravi');
    });

    // Every request was a read of public reference data. Nothing was written,
    // and no student field appears in any URL (M5a §3).
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
    expect(requests.every((r) => r.path.startsWith('/api/v1/'))).toBe(true);
    for (const request of requests) {
      expect(request.path).not.toMatch(/Ravi/i);
      expect(request.path).not.toMatch(/1XX22CS001/i);
    }
  });
});
