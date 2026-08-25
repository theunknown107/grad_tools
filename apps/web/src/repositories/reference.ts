/**
 * Reference-data repository.
 *
 * Authority: M5a §12, docs/07 §The repository boundary
 *
 * This is the FIRST repository that actually crosses the network. Student
 * repositories stay local and unchanged (docs/33 §33.3): the split is the
 * point, not an accident of implementation order.
 *
 *   Reference data (public)   ->  API  ->  PostgreSQL
 *   Student data   (private)  ->  IndexedDB, and nowhere else
 *
 * Responses are parsed through the SHARED Zod contract, so a server that
 * drifts from the contract fails here with a clear error rather than causing a
 * confusing render further downstream.
 */

import {
  API_ROUTES,
  branchSchema,
  errorResponseSchema,
  listResponseSchema,
  ruleSetMetaSchema,
  schemeSchema,
  subjectSchema,
  syllabusModuleSchema,
  universitySchema,
  type Branch,
  type RuleSetMeta,
  type Scheme,
  type Subject,
  type SubjectQuery,
  type SyllabusModule,
  type University,
} from '@gradtools/shared-types';

export interface ReferenceRepository {
  listUniversities(signal?: AbortSignal): Promise<University[]>;
  listSchemes(signal?: AbortSignal): Promise<Scheme[]>;
  listBranches(signal?: AbortSignal): Promise<Branch[]>;
  listSubjects(query: SubjectQuery, signal?: AbortSignal): Promise<Subject[]>;
  /** `collegeId` selects a college-specific rule set, falling back to scheme-wide. */
  getSchemeRules(schemeId: string, collegeId?: string, signal?: AbortSignal): Promise<RuleSetMeta>;
  /** By subject **id**, not code: a code does not identify one subject (M4.1 §2). */
  listSyllabus(subjectId: string, signal?: AbortSignal): Promise<SyllabusModule[]>;
}

/**
 * A failure the UI can describe to a student.
 *
 * `kind` separates "we could not reach the server" from "the server said no",
 * because the two deserve different copy and only the first is worth a retry
 * button (docs/04 §4.6).
 */
export class ReferenceError extends Error {
  readonly kind: 'network' | 'server' | 'contract';

  constructor(kind: 'network' | 'server' | 'contract', message: string) {
    super(message);
    this.name = 'ReferenceError';
    this.kind = kind;
  }
}

/**
 * The base URL of the API.
 *
 * Public configuration only: `VITE_` variables are compiled into the browser
 * bundle, so a secret must never be read here. The database URL lives on the
 * server and the browser never sees it (M5a §13).
 */
export function apiBaseUrl(): string {
  const configured: unknown = import.meta.env.VITE_API_URL;
  return typeof configured === 'string' && configured !== ''
    ? configured.replace(/\/$/, '')
    : 'http://localhost:3001';
}

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // An aborted request is a navigation, not a failure; let the caller ignore it.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ReferenceError('network', 'Could not reach the GradTools server.');
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    throw new ReferenceError(
      'server',
      parsed.success ? parsed.data.error.message : 'The server returned an error.',
    );
  }

  return body;
}

function parseOrThrow<T>(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value) as { success: boolean; data?: T };
  if (!result.success || result.data === undefined) {
    throw new ReferenceError('contract', `The server sent unexpected ${what} data.`);
  }
  return result.data;
}

/** The real implementation. It genuinely calls Express; nothing is faked. */
export const apiReferenceRepository: ReferenceRepository = {
  async listUniversities(signal) {
    const body = await fetchJson(API_ROUTES.universities, signal);
    return parseOrThrow<{ data: University[] }>(
      listResponseSchema(universitySchema),
      body,
      'university',
    ).data;
  },

  async listSchemes(signal) {
    const body = await fetchJson(API_ROUTES.schemes, signal);
    return parseOrThrow<{ data: Scheme[] }>(listResponseSchema(schemeSchema), body, 'scheme').data;
  },

  async listBranches(signal) {
    const body = await fetchJson(API_ROUTES.branches, signal);
    return parseOrThrow<{ data: Branch[] }>(listResponseSchema(branchSchema), body, 'branch').data;
  },

  async listSubjects(query, signal) {
    const params = new URLSearchParams();
    if (query.scheme !== undefined) params.set('scheme', query.scheme);
    if (query.branch !== undefined) params.set('branch', query.branch);
    if (query.semester !== undefined) params.set('semester', String(query.semester));
    const suffix = params.toString() === '' ? '' : `?${params.toString()}`;

    const body = await fetchJson(`${API_ROUTES.subjects}${suffix}`, signal);
    return parseOrThrow<{ data: Subject[] }>(listResponseSchema(subjectSchema), body, 'subject')
      .data;
  },

  async getSchemeRules(schemeId, collegeId, signal) {
    const body = await fetchJson(API_ROUTES.schemeRules(schemeId, collegeId), signal);
    return parseOrThrow<RuleSetMeta>(ruleSetMetaSchema, body, 'rule set');
  },

  async listSyllabus(subjectId, signal) {
    const body = await fetchJson(API_ROUTES.subjectSyllabus(subjectId), signal);
    return parseOrThrow<{ data: SyllabusModule[] }>(
      listResponseSchema(syllabusModuleSchema),
      body,
      'syllabus',
    ).data;
  },
};
