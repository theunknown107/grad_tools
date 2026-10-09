/**
 * Operator-only read models over support data (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * These see ACROSS users, which is why support data lives in the server-only
 * reference database rather than behind per-user RLS. Every shape returned here
 * is safe operator telemetry: Support IDs, event types, error codes, routes,
 * statuses, counts. No academic content, tokens or student free-text identity.
 * The internal `auth_user_id` is never returned — the Support ID is the handle.
 */

import type { Sql } from '../db/client.js';

export interface SupportEventView {
  readonly incidentId: string | null;
  readonly supportId: string;
  readonly eventType: string;
  readonly severity: string;
  readonly occurredAt: string;
  readonly requestId: string | null;
  readonly route: string | null;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly platform: string | null;
  readonly appVersion: string | null;
  readonly metadata: Record<string, unknown>;
}

interface EventRow {
  incident_id: string | null;
  support_id: string;
  event_type: string;
  severity: string;
  occurred_at: Date;
  request_id: string | null;
  route: string | null;
  http_status: number | null;
  error_code: string | null;
  platform: string | null;
  app_version: string | null;
  metadata_safe: Record<string, unknown>;
}

const toView = (row: EventRow): SupportEventView => ({
  incidentId: row.incident_id,
  supportId: row.support_id,
  eventType: row.event_type,
  severity: row.severity,
  occurredAt: row.occurred_at.toISOString(),
  requestId: row.request_id,
  route: row.route,
  httpStatus: row.http_status,
  errorCode: row.error_code,
  platform: row.platform,
  appVersion: row.app_version,
  metadata: row.metadata_safe,
});

/** The compact global operations dashboard (Phase 12). Tables, not charts. */
export async function overview(sql: Sql): Promise<{
  readonly windows: { readonly lastHour: number; readonly last24h: number };
  readonly counts: Record<string, number>;
  readonly topErrorCodes: { code: string; count: number; lastSeen: string }[];
}> {
  const [totals] = await sql<
    {
      last_hour: string;
      last_24h: string;
      api_5xx: string;
      rate_limited: string;
      sync_failed: string;
      import_failed: string;
      ai_failed: string;
      native_failed: string;
      security: string;
    }[]
  >`
    SELECT
      count(*) FILTER (WHERE occurred_at >= now() - interval '1 hour')          AS last_hour,
      count(*) FILTER (WHERE occurred_at >= now() - interval '24 hours')        AS last_24h,
      count(*) FILTER (WHERE event_type = 'API_5XX')                            AS api_5xx,
      count(*) FILTER (WHERE event_type IN ('API_RATE_LIMITED','RATE_LIMIT_TRIGGERED')) AS rate_limited,
      count(*) FILTER (WHERE event_type = 'SYNC_FAILED')                        AS sync_failed,
      count(*) FILTER (WHERE event_type = 'IMPORT_FAILED')                      AS import_failed,
      count(*) FILTER (WHERE event_type IN ('AI_EXTRACTION_FAILED','AI_UNAVAILABLE')) AS ai_failed,
      count(*) FILTER (WHERE event_type IN ('APP_RUNTIME_ERROR','NATIVE_CALLBACK_FAILED')) AS native_failed,
      count(*) FILTER (WHERE severity = 'security')                             AS security
    FROM support_events
    WHERE occurred_at >= now() - interval '24 hours'
  `;

  const codes = await sql<{ error_code: string; count: string; last_seen: Date }[]>`
    SELECT error_code, count(*) AS count, max(occurred_at) AS last_seen
    FROM support_events
    WHERE error_code IS NOT NULL AND occurred_at >= now() - interval '24 hours'
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 20
  `;

  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    windows: { lastHour: n(totals?.last_hour), last24h: n(totals?.last_24h) },
    counts: {
      api5xx: n(totals?.api_5xx),
      rateLimited: n(totals?.rate_limited),
      syncFailed: n(totals?.sync_failed),
      importFailed: n(totals?.import_failed),
      aiFailed: n(totals?.ai_failed),
      nativeFailed: n(totals?.native_failed),
      security: n(totals?.security),
    },
    topErrorCodes: codes.map((c) => ({
      code: c.error_code,
      count: Number(c.count),
      lastSeen: c.last_seen.toISOString(),
    })),
  };
}

/** A user, found by Support ID: their recent events and reports (Phase 11). */
export async function userBySupportId(
  sql: Sql,
  supportId: string,
): Promise<{
  readonly supportId: string;
  readonly lastSeen: string | null;
  readonly platforms: string[];
  readonly appVersions: string[];
  readonly events: SupportEventView[];
  readonly reports: {
    incidentId: string;
    category: string;
    status: string;
    createdAt: string;
  }[];
} | null> {
  const events = await sql<EventRow[]>`
    SELECT incident_id, support_id, event_type, severity, occurred_at, request_id,
           route, http_status, error_code, platform, app_version, metadata_safe
    FROM support_events
    WHERE support_id = ${supportId}
    ORDER BY occurred_at DESC
    LIMIT 100
  `;
  const reports = await sql<
    { incident_id: string; category: string; status: string; created_at: Date }[]
  >`
    SELECT incident_id, category, status, created_at
    FROM support_reports
    WHERE support_id = ${supportId}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  if (events.length === 0 && reports.length === 0) return null;

  const platforms = [
    ...new Set(events.map((e) => e.platform).filter((p): p is string => p !== null)),
  ];
  const versions = [
    ...new Set(events.map((e) => e.app_version).filter((v): v is string => v !== null)),
  ];
  return {
    supportId,
    lastSeen: events[0]?.occurred_at.toISOString() ?? null,
    platforms,
    appVersions: versions,
    events: events.map(toView),
    reports: reports.map((r) => ({
      incidentId: r.incident_id,
      category: r.category,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    })),
  };
}

/** One incident's safe detail, plus the events around it for the same user. */
export async function incident(
  sql: Sql,
  incidentId: string,
): Promise<{
  readonly event: SupportEventView;
  readonly report: { category: string; status: string; description: string | null } | null;
  readonly related: SupportEventView[];
} | null> {
  const [event] = await sql<EventRow[]>`
    SELECT incident_id, support_id, event_type, severity, occurred_at, request_id,
           route, http_status, error_code, platform, app_version, metadata_safe
    FROM support_events
    WHERE incident_id = ${incidentId}
    LIMIT 1
  `;
  if (event === undefined) return null;

  const [report] = await sql<{ category: string; status: string; description: string | null }[]>`
    SELECT category, status, description FROM support_reports WHERE incident_id = ${incidentId}
  `;
  const related = await sql<EventRow[]>`
    SELECT incident_id, support_id, event_type, severity, occurred_at, request_id,
           route, http_status, error_code, platform, app_version, metadata_safe
    FROM support_events
    WHERE support_id = ${event.support_id} AND incident_id IS DISTINCT FROM ${incidentId}
    ORDER BY occurred_at DESC
    LIMIT 20
  `;
  return { event: toView(event), report: report ?? null, related: related.map(toView) };
}

/** Recent security-relevant events for operator review (Phase 13). */
export async function security(sql: Sql): Promise<SupportEventView[]> {
  const rows = await sql<EventRow[]>`
    SELECT incident_id, support_id, event_type, severity, occurred_at, request_id,
           route, http_status, error_code, platform, app_version, metadata_safe
    FROM support_events
    WHERE severity = 'security' AND occurred_at >= now() - interval '7 days'
    ORDER BY occurred_at DESC
    LIMIT 200
  `;
  return rows.map(toView);
}
