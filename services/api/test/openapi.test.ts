/**
 * The published OpenAPI 3.1 contract (agent-readiness slice).
 *
 * DB-independent: the document is static, so these run without Postgres. They
 * prove the endpoint serves it, the document is structurally valid OpenAPI 3.1,
 * operationIds are unique, the documented paths track the real route constants
 * (drift guard), the Zod request constraints flow through, auth and the typed
 * error envelope are documented, and no production host or secret leaks in.
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  TERMS_ROUTES,
  STUDENT_ROUTES,
  SUPPORT_ROUTES,
  OPERATOR_SUPPORT_ROUTES,
  API_ROUTES,
  MAX_SYNC_PUSH_RECORDS,
} from '@gradtools/shared-types';
import { buildOpenApiDocument, OPENAPI_ROUTE } from '../src/http/openapi.js';

type Operation = { operationId?: unknown; responses?: unknown; security?: unknown };

const doc = buildOpenApiDocument();
const paths = doc.paths as Record<string, Record<string, Operation>>;

/** Walk a dotted path (no segment here contains a dot). Returns `unknown`, undefined if absent. */
const get = (root: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], root);

describe('OpenAPI endpoint', () => {
  it('serves the document as JSON with a 200', async () => {
    const app = express();
    app.get(OPENAPI_ROUTE, (_req, res) => res.json(doc));
    const res = await request(app).get(OPENAPI_ROUTE);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.1.0');
  });
});

describe('OpenAPI document', () => {
  it('is structurally valid OpenAPI 3.1', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(typeof get(doc, 'info.title')).toBe('string');
    expect(typeof get(doc, 'info.version')).toBe('string');
    expect(Object.keys(paths).length).toBeGreaterThan(10);
    for (const [path, methods] of Object.entries(paths)) {
      expect(path.startsWith('/')).toBe(true);
      for (const operation of Object.values(methods)) {
        expect(typeof operation.operationId).toBe('string');
        expect(operation.responses).toBeTruthy();
      }
    }
  });

  it('has unique operationIds', () => {
    const ids = Object.values(paths).flatMap((m) =>
      Object.values(m).map((o) => String(o.operationId)),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every $ref resolves to a defined component', () => {
    const refs: string[] = [];
    JSON.stringify(doc, (key: string, value: unknown) => {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      return value;
    });
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(get(doc, ref.replace(/^#\//, '').replace(/\//g, '.')), `unresolved ${ref}`).toBeTruthy();
    }
  });

  it('tracks the real route constants (drift guard)', () => {
    expect(paths[TERMS_ROUTES.acceptance]?.post).toBeTruthy();
    expect(paths[STUDENT_ROUTES.me]?.get).toBeTruthy();
    expect(paths[STUDENT_ROUTES.me]?.delete).toBeTruthy();
    expect(paths[STUDENT_ROUTES.meSync]?.post).toBeTruthy();
    expect(paths[SUPPORT_ROUTES.anonymousReport]?.post).toBeTruthy();
    expect(paths[SUPPORT_ROUTES.reports]?.get).toBeTruthy();
    expect(paths[API_ROUTES.schemes]?.get).toBeTruthy();
    expect(paths[OPERATOR_SUPPORT_ROUTES.overview]?.get).toBeTruthy();
    // Path-templated routes are converted from :param to {param}.
    expect(paths['/api/v1/schemes/{id}']?.get).toBeTruthy();
  });

  it('represents the Zod request constraints', () => {
    const version = get(
      doc,
      `paths.${TERMS_ROUTES.acceptance}.post.requestBody.content.application/json.schema.properties.version`,
    ) as { maxLength?: number };
    expect(version.maxLength).toBe(40); // from termsAcceptanceInputSchema.version.max(40)
    const records = get(
      doc,
      `paths.${STUDENT_ROUTES.meSync}.post.requestBody.content.application/json.schema.properties.records`,
    ) as { maxItems?: number };
    expect(records.maxItems).toBe(MAX_SYNC_PUSH_RECORDS); // the Zod .max() bound flows through
  });

  it('documents authentication accurately per operation', () => {
    expect(paths[STUDENT_ROUTES.me]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(paths[SUPPORT_ROUTES.anonymousReport]?.post?.security).toEqual([]); // public
    expect(paths[OPERATOR_SUPPORT_ROUTES.overview]?.get?.security).toEqual([{ operatorToken: [] }]);
    expect(get(doc, 'components.securitySchemes.bearerAuth.scheme')).toBe('bearer');
    expect(get(doc, 'components.securitySchemes.operatorToken.scheme')).toBe('bearer');
  });

  it('documents the typed error envelope matching buildErrorBody', () => {
    const errorProps = get(doc, 'components.schemas.Error.properties.error.properties') as Record<
      string,
      { enum?: string[] }
    >;
    expect(Object.keys(errorProps).sort()).toEqual(
      ['code', 'details', 'incidentId', 'message', 'reference'].sort(),
    );
    const required = get(doc, 'components.schemas.Error.properties.error.required') as string[];
    expect(required).toContain('code');
    expect(required).toContain('message');
    expect(required).toContain('reference');
    expect(errorProps.code?.enum).toContain('RATE_LIMITED');
    expect(get(doc, 'components.responses.Error')).toBeTruthy();
  });

  it('invents no production host and leaks no secret', () => {
    expect(doc.servers).toEqual([
      { url: '/', description: 'Relative to the API origin (no fixed production host).' },
    ]);
    const blob = JSON.stringify(doc);
    expect(blob).not.toMatch(/https?:\/\/[a-z0-9.-]+\.(com|app|dev|io|co|net)/i);
    expect(blob).not.toMatch(/sk_(test|live)_|OPERATOR_TOKEN=|Bearer\s+[A-Za-z0-9._-]{10}/);
  });
});
