/**
 * OpenAPI 3.1 description of the GradTools `/api/v1` HTTP API.
 *
 * Authority: docs/10_API_SPECIFICATION.md · OpenAPI 3.1 (https://spec.openapis.org/oas/v3.1.2.html)
 *
 * ---------------------------------------------------------------------------
 * ONE SOURCE OF TRUTH, DERIVED — NOT A SECOND CONTRACT
 * ---------------------------------------------------------------------------
 *
 * Paths come from the SAME route constants the Express routers register with
 * (`API_ROUTES`, `STUDENT_ROUTES`, …), and request/response bodies come from the
 * SAME Zod schemas the handlers validate with, converted to JSON Schema by Zod 4
 * (`z.toJSONSchema`). So the document cannot drift from the implementation without
 * the drift test (`openapi.test.ts`) failing. No OpenAPI-generator dependency is
 * added; Zod 4 already emits JSON Schema (2020-12), which OpenAPI 3.1 embeds
 * directly.
 *
 * SERVER URL IS RELATIVE. No production hostname is invented (GradTools has no
 * configured production domain). The API version lives in the path (`/api/v1`),
 * and the versioning/deprecation policy is described in `info.description`.
 *
 * This document DESCRIBES the API; serving it grants no access. Every protected
 * operation keeps its real guard — the spec only states which guard applies.
 */

import { z } from 'zod';
import {
  API_ROUTES,
  SOURCE_ROUTES,
  STUDENT_ROUTES,
  SUPPORT_ROUTES,
  OPERATOR_SUPPORT_ROUTES,
  TERMS_ROUTES,
  DOCUMENT_AI_ROUTES,
  errorResponseSchema,
  ruleSetQuerySchema,
  termsAcceptanceInputSchema,
  termsAcceptanceSchema,
  profileInputSchema,
  syncPushSchema,
  supportReportInputSchema,
  supportReportSchema,
  anonymousSupportReportSchema,
  aiReviewSchema,
} from '@gradtools/shared-types';

/** Where the document is served. Public: it describes the API, it does not expose it. */
export const OPENAPI_ROUTE = '/api/v1/openapi.json';

/** `:param` (Express) → `{param}` (OpenAPI path templating). */
const tmpl = (route: string): string => route.replace(/:(\w+)/g, '{$1}');

/**
 * JSON Schema (2020-12) for a Zod schema. `unrepresentable: 'any'` degrades a
 * piece Zod cannot express (e.g. a transform) to `{}` instead of throwing, so the
 * document always builds; `io` picks the input (request) or output (response) view.
 */
const schemaOf = (schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> =>
  z.toJSONSchema(schema, { unrepresentable: 'any', io }) as Record<string, unknown>;

type Operation = Record<string, unknown>;

/** Reusable error responses, by the status codes the error handler actually emits. */
const errorRef = { $ref: '#/components/responses/Error' };
const commonErrors = {
  '400': errorRef,
  '429': errorRef,
  '500': errorRef,
};
const authedErrors = { '401': errorRef, ...commonErrors };

const op = (
  operationId: string,
  tag: string,
  summary: string,
  extra: Operation = {},
): Operation => ({ operationId, tags: [tag], summary, ...extra });

const bearer = [{ bearerAuth: [] as string[] }];
const operator = [{ operatorToken: [] as string[] }];

const jsonBody = (schema: z.ZodType, required = true) => ({
  required,
  content: { 'application/json': { schema: schemaOf(schema, 'input') } },
});
const jsonResponse = (description: string, schema?: z.ZodType) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema: schemaOf(schema, 'output') } } } : {}),
});

const idParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

/** The documented (method, path) pairs, used by the drift test to compare with the routers. */
export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, Operation>> = {};
  const add = (path: string, method: string, operation: Operation): void => {
    (paths[path] ??= {})[method] = operation;
  };

  /* ----------------------------------------------------------------- System */
  add(API_ROUTES.health, 'get', {
    ...op('getHealth', 'System', 'Liveness probe.'),
    security: [],
    responses: { '200': jsonResponse('The process is up.') },
  });
  add(API_ROUTES.ready, 'get', {
    ...op('getReadiness', 'System', 'Readiness probe (checks the database).'),
    security: [],
    responses: { '200': jsonResponse('Ready.'), '503': errorRef },
  });
  add(OPENAPI_ROUTE, 'get', {
    ...op('getOpenApi', 'System', 'This OpenAPI 3.1 document.'),
    security: [],
    responses: { '200': jsonResponse('The API description.') },
  });

  /* -------------------------------------------------------------- Reference */
  const ref = (path: string, operationId: string, summary: string, params?: unknown[]): void =>
    add(path, 'get', {
      ...op(operationId, 'Reference', summary),
      security: [],
      ...(params ? { parameters: params } : {}),
      responses: { '200': jsonResponse(summary), ...commonErrors, '404': errorRef },
    });
  ref(API_ROUTES.universities, 'listUniversities', 'List universities.');
  ref(API_ROUTES.schemes, 'listSchemes', 'List VTU schemes.');
  ref(tmpl(API_ROUTES.scheme(':id')), 'getScheme', 'Get one scheme.', [idParam('id', 'Scheme id.')]);
  ref(tmpl(API_ROUTES.schemeRules(':id')), 'getSchemeRules', 'Get a scheme’s rule set.', [
    idParam('id', 'Scheme id.'),
    { name: 'college', in: 'query', required: false, schema: schemaOf(ruleSetQuerySchema.shape.college, 'input') },
  ]);
  ref(API_ROUTES.branches, 'listBranches', 'List branches.');
  ref(API_ROUTES.colleges, 'listColleges', 'List colleges.');
  ref(API_ROUTES.subjects, 'listSubjects', 'Search subjects.', [
    { name: 'scheme', in: 'query', required: false, schema: { type: 'string' } },
    { name: 'branch', in: 'query', required: false, schema: { type: 'string' } },
    { name: 'semester', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 8 } },
  ]);
  ref(tmpl(API_ROUTES.subject(':id')), 'getSubject', 'Get one subject.', [idParam('id', 'Subject id.')]);
  ref(tmpl(API_ROUTES.subjectSyllabus(':id')), 'getSubjectSyllabus', 'Get a subject’s syllabus.', [
    idParam('id', 'Subject id.'),
  ]);
  ref(SOURCE_ROUTES.sources, 'listSources', 'List sources.');
  ref(tmpl(SOURCE_ROUTES.source(':id')), 'getSource', 'Get one source.', [idParam('id', 'Source id.')]);
  ref(SOURCE_ROUTES.documents, 'listDocuments', 'List public documents.');
  ref(tmpl(SOURCE_ROUTES.document(':id')), 'getDocument', 'Get one public document.', [
    idParam('id', 'Document id.'),
  ]);

  /* ------------------------------------------------------------ Announcements */
  add(SOURCE_ROUTES.announcements, 'get', {
    ...op('listAnnouncements', 'Announcements', 'List announcements.'),
    security: [],
    parameters: [
      { name: 'category', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
      { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
    ],
    responses: { '200': jsonResponse('A page of announcements.'), ...commonErrors },
  });
  add('/api/v1/announcements/filters', 'get', {
    ...op('getAnnouncementFilters', 'Announcements', 'The available announcement filters.'),
    security: [],
    responses: { '200': jsonResponse('Filter options.'), ...commonErrors },
  });
  add(tmpl(SOURCE_ROUTES.announcement(':id')), 'get', {
    ...op('getAnnouncement', 'Announcements', 'Get one announcement.'),
    security: [],
    parameters: [idParam('id', 'Announcement id.')],
    responses: { '200': jsonResponse('The announcement.'), ...commonErrors, '404': errorRef },
  });

  /* ---------------------------------------------------------------- Account */
  add(STUDENT_ROUTES.me, 'get', {
    ...op('getMe', 'Account', 'The signed-in account: identity, profile, onboarding and terms state.'),
    security: bearer,
    responses: {
      '200': jsonResponse('Identity, profile, `onboarded`, `termsCurrentVersion`, and this account’s acceptance of it (or null).'),
      ...authedErrors,
    },
  });
  add(STUDENT_ROUTES.me, 'delete', {
    ...op('deleteMe', 'Account', 'Delete the account and its synced data.'),
    security: bearer,
    responses: { '200': jsonResponse('Deleted.'), ...authedErrors },
  });
  add(TERMS_ROUTES.acceptance, 'post', {
    ...op('acceptTerms', 'Account', 'Record acceptance of the current Terms & Conditions version.'),
    security: bearer,
    requestBody: jsonBody(termsAcceptanceInputSchema),
    responses: {
      '201': jsonResponse('The recorded acceptance (idempotent).', termsAcceptanceSchema),
      ...authedErrors,
    },
  });
  add(STUDENT_ROUTES.meProfile, 'put', {
    ...op('putProfile', 'Account', 'Create or update the student profile. All fields optional.'),
    security: bearer,
    requestBody: jsonBody(profileInputSchema),
    responses: { '200': jsonResponse('The saved profile.'), ...authedErrors },
  });
  add(STUDENT_ROUTES.meSync, 'get', {
    ...op('getSync', 'Account', 'Pull the account’s synced records.'),
    security: bearer,
    responses: { '200': jsonResponse('The account’s records.'), ...authedErrors },
  });
  add(STUDENT_ROUTES.meSync, 'post', {
    ...op('pushSync', 'Account', 'Push a batch of local records (bounded; see MAX_SYNC_PUSH_RECORDS).'),
    security: bearer,
    requestBody: jsonBody(syncPushSchema),
    responses: { '200': jsonResponse('Per-record outcomes (applied / conflict / rejected).'), '413': errorRef, ...authedErrors },
  });
  add(STUDENT_ROUTES.meExport, 'get', {
    ...op('exportMe', 'Account', 'Export all of the account’s data.'),
    security: bearer,
    responses: { '200': jsonResponse('The account’s data.'), ...authedErrors },
  });
  add(STUDENT_ROUTES.meNotifications, 'get', {
    ...op('listNotifications', 'Account', 'Notifications created for this account.'),
    security: bearer,
    responses: { '200': jsonResponse('The notifications.'), ...authedErrors },
  });
  add(STUDENT_ROUTES.meNotificationsStream, 'get', {
    ...op('streamNotifications', 'Account', 'Server-sent events doorbell for new notifications.'),
    security: bearer,
    responses: { '200': { description: 'A `text/event-stream` of notification events.' }, ...authedErrors },
  });
  add(tmpl(STUDENT_ROUTES.meNotification), 'patch', {
    ...op('updateNotification', 'Account', 'Update one notification’s state (e.g. read).'),
    security: bearer,
    parameters: [idParam('id', 'Notification id.')],
    responses: { '200': jsonResponse('The updated notification.'), ...authedErrors, '404': errorRef },
  });
  add(STUDENT_ROUTES.meNotificationsRead, 'post', {
    ...op('readAllNotifications', 'Account', 'Mark every notification read.'),
    security: bearer,
    responses: { '200': jsonResponse('Done.'), ...authedErrors },
  });
  add(DOCUMENT_AI_ROUTES.extract, 'post', {
    ...op('extractDocument', 'Account', 'Read an academic document with the optional AI reader. Rate-limited more strictly than the baseline.'),
    security: bearer,
    requestBody: {
      required: true,
      content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary', description: 'The document bytes (image/PDF).' } } },
    },
    responses: {
      '200': jsonResponse('The extracted, review-ready result.', aiReviewSchema),
      '413': errorRef,
      '503': errorRef,
      ...authedErrors,
    },
  });

  /* ---------------------------------------------------------------- Support */
  add(SUPPORT_ROUTES.anonymousReport, 'post', {
    ...op('createAnonymousSupportReport', 'Support', 'File a problem report without signing in. Returns an Incident ID only.'),
    security: [],
    requestBody: jsonBody(supportReportInputSchema),
    responses: { '201': jsonResponse('The Incident ID.', anonymousSupportReportSchema), ...commonErrors },
  });
  add(SUPPORT_ROUTES.reports, 'get', {
    ...op('listSupportReports', 'Support', 'List the caller’s own problem reports.'),
    security: bearer,
    responses: { '200': jsonResponse('The caller’s reports.'), ...authedErrors },
  });
  add(SUPPORT_ROUTES.reports, 'post', {
    ...op('createSupportReport', 'Support', 'File a problem report as the signed-in user.'),
    security: bearer,
    requestBody: jsonBody(supportReportInputSchema),
    responses: { '201': jsonResponse('The report, with a Support ID.', supportReportSchema), ...authedErrors },
  });

  /* --------------------------------------------------------------- Operator */
  const opSec = (path: string, method: string, operationId: string, summary: string, params?: unknown[]): void =>
    add(path, method, {
      ...op(operationId, 'Operator', summary),
      security: operator,
      ...(params ? { parameters: params } : {}),
      responses: { '200': jsonResponse(summary), '401': errorRef, '403': errorRef, ...commonErrors, '404': errorRef },
    });
  opSec(OPERATOR_SUPPORT_ROUTES.overview, 'get', 'getOperatorOverview', 'Operations dashboard: counts and top error codes.');
  opSec(tmpl(OPERATOR_SUPPORT_ROUTES.user), 'get', 'getOperatorUser', 'A user’s recent events and reports, by Support ID.', [
    idParam('supportId', 'Support ID.'),
  ]);
  opSec(tmpl(OPERATOR_SUPPORT_ROUTES.incident), 'get', 'getOperatorIncident', 'One incident’s safe detail.', [
    idParam('incidentId', 'Incident ID.'),
  ]);
  opSec(OPERATOR_SUPPORT_ROUTES.security, 'get', 'getOperatorSecurity', 'Security-relevant events for review.');

  return {
    openapi: '3.1.0',
    info: {
      title: 'GradTools API',
      version: '1.0.0',
      description:
        'HTTP API for GradTools. Local-first: the app works without an account, and ' +
        'these endpoints are used only when a student signs in and opts into cloud sync.\n\n' +
        '**Versioning.** The surface is versioned in the path (`/api/v1`). `/api/v1` is ' +
        'stable; a breaking change ships under a new prefix (`/api/v2`) and `/api/v1` ' +
        'remains supported for at least 6 months after (docs/10 §10.1). No operation is ' +
        'deprecated today.\n\n' +
        '**Errors.** Every error shares one envelope — see the `Error` schema.\n\n' +
        '**Rate limits.** `/api/v1/*` responses carry IETF `RateLimit` / `RateLimit-Policy` ' +
        'headers (draft-7); a 429 adds `Retry-After` (seconds).',
    },
    servers: [{ url: '/', description: 'Relative to the API origin (no fixed production host).' }],
    tags: [
      { name: 'System', description: 'Health and this document.' },
      { name: 'Reference', description: 'Public VTU reference data.' },
      { name: 'Announcements', description: 'Public announcements.' },
      { name: 'Account', description: 'The signed-in student (bearer token required).' },
      { name: 'Support', description: 'Problem reports.' },
      { name: 'Operator', description: 'Operator-only support tooling (operator token).' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The session access token.' },
        operatorToken: { type: 'http', scheme: 'bearer', description: 'The configured OPERATOR_TOKEN.' },
      },
      schemas: { Error: schemaOf(errorResponseSchema, 'output') },
      responses: {
        Error: {
          description: 'Error envelope: `{ error: { code, message, details?, reference, incidentId? } }`.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  };
}
