/**
 * Persisting support events and reports (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * Every write here goes through an ALLOWLIST. A caller hands over a subject and
 * a small set of named operational fields; nothing else reaches the database.
 * There is no path that serialises a request body, a document, an AI response,
 * a token or academic data, because no function here accepts one.
 *
 * Recording is best-effort: `recordEventSafe` never throws, so a telemetry
 * failure can never break the student operation that triggered it, nor turn one
 * error into two.
 */

import type { Logger } from 'pino';
import type {
  AppErrorCode,
  SupportCategory,
  SupportContext,
  SupportEventType,
  SupportReport,
  SupportReportStatus,
  SupportSeverity,
} from '@gradtools/shared-types';
import { SECURITY_EVENT_TYPES } from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import { newIncidentId, supportIdFor } from './id.js';

/** The safe JSON bag kept out of first-class columns. Allowlisted by construction. */
type SafeBag = Record<string, string | number | boolean>;

function safeMetadata(context: SupportContext | undefined): SafeBag {
  if (context === undefined) return {};
  const bag: SafeBag = {};
  if (context.online !== undefined) bag.online = context.online;
  if (context.osFamily !== undefined) bag.osFamily = context.osFamily;
  if (context.browserFamily !== undefined) bag.browserFamily = context.browserFamily;
  if (context.stage !== undefined) bag.stage = context.stage;
  if (context.buildId !== undefined) bag.buildId = context.buildId;
  return bag;
}

export interface EventInput {
  readonly eventType: SupportEventType;
  readonly severity?: SupportSeverity;
  /** The verified auth subject, or undefined for a pre-session failure. */
  readonly subject?: string | undefined;
  /** When set, this event IS an incident and carries this id. */
  readonly incidentId?: string;
  readonly requestId?: string | undefined;
  readonly route?: string | undefined;
  readonly httpStatus?: number | undefined;
  readonly errorCode?: AppErrorCode | undefined;
  readonly platform?: string | undefined;
  readonly appVersion?: string | undefined;
  readonly metadata?: SafeBag;
}

/**
 * Inserts one event. `support_id` is derived here from the subject (or a fixed
 * anonymous handle when there is no session), so a caller can never set it to
 * someone else's.
 */
export async function recordEvent(sql: Sql, input: EventInput): Promise<void> {
  const severity: SupportSeverity =
    input.severity ??
    ((SECURITY_EVENT_TYPES as readonly string[]).includes(input.eventType) ? 'security' : 'info');
  const supportId = input.subject === undefined ? 'GT-00000000' : supportIdFor(input.subject);

  await sql`
    INSERT INTO support_events (
      incident_id, support_id, auth_user_id, event_type, severity,
      request_id, route, http_status, error_code, platform, app_version, metadata_safe
    ) VALUES (
      ${input.incidentId ?? null}, ${supportId}, ${input.subject ?? null}, ${input.eventType},
      ${severity}, ${input.requestId ?? null}, ${input.route ?? null}, ${input.httpStatus ?? null},
      ${input.errorCode ?? null}, ${input.platform ?? null}, ${input.appVersion ?? null},
      ${sql.json(input.metadata ?? {})}
    )
  `;
}

/** Never throws. A telemetry failure logs a reference and is otherwise swallowed. */
export async function recordEventSafe(sql: Sql, input: EventInput, log?: Logger): Promise<void> {
  try {
    await recordEvent(sql, input);
  } catch (error) {
    log?.warn({ err: error, eventType: input.eventType }, 'support event not recorded');
  }
}

/**
 * Records an incident (a reportable error) and returns its Incident ID, so the
 * error handler can hand it back to the client. Best-effort: on a telemetry
 * failure it still returns an id, so the student always has something to quote.
 */
export async function createIncident(
  sql: Sql,
  input: Omit<EventInput, 'incidentId' | 'severity'> & { severity?: SupportSeverity },
  log?: Logger,
): Promise<string> {
  const incidentId = newIncidentId();
  await recordEventSafe(sql, { ...input, incidentId, severity: input.severity ?? 'error' }, log);
  return incidentId;
}

export interface ReportInput {
  readonly subject: string;
  readonly category: SupportCategory;
  readonly description?: string | undefined;
  readonly context?: SupportContext | undefined;
}

/**
 * Creates a student problem report. The owner is the VERIFIED subject the
 * caller passes from the session — never a value from the request body. Also
 * writes a matching USER_REPORT event so the report shows up in the operator's
 * event stream.
 */
export async function createReport(sql: Sql, input: ReportInput): Promise<SupportReport> {
  const incidentId = newIncidentId();
  const supportId = supportIdFor(input.subject);
  const context = input.context;

  const [row] = await sql<{ created_at: Date }[]>`
    INSERT INTO support_reports (incident_id, support_id, auth_user_id, category, description, context_safe)
    VALUES (
      ${incidentId}, ${supportId}, ${input.subject}, ${input.category},
      ${input.description ?? null}, ${sql.json(safeContext(context))}
    )
    RETURNING created_at
  `;

  await recordEventSafe(sql, {
    eventType: 'USER_REPORT',
    severity: 'info',
    subject: input.subject,
    incidentId,
    requestId: context?.requestId,
    route: context?.route,
    httpStatus: context?.httpStatus,
    errorCode: context?.errorCode,
    platform: context?.platform,
    appVersion: context?.appVersion,
    metadata: { category: input.category, ...safeMetadata(context) },
  });

  return {
    incidentId,
    supportId,
    category: input.category,
    status: 'open',
    createdAt: (row?.created_at ?? new Date()).toISOString(),
  };
}

/** The full safe context stored on a report row (columns + allowlisted bag). */
function safeContext(context: SupportContext | undefined): SafeBag {
  if (context === undefined) return {};
  const bag = safeMetadata(context);
  if (context.route !== undefined) bag.route = context.route;
  if (context.httpStatus !== undefined) bag.httpStatus = context.httpStatus;
  if (context.errorCode !== undefined) bag.errorCode = context.errorCode;
  if (context.requestId !== undefined) bag.requestId = context.requestId;
  if (context.platform !== undefined) bag.platform = context.platform;
  if (context.appVersion !== undefined) bag.appVersion = context.appVersion;
  if (context.incidentId !== undefined) bag.relatedIncidentId = context.incidentId;
  return bag;
}

interface ReportRow {
  incident_id: string;
  support_id: string;
  category: SupportCategory;
  status: SupportReportStatus;
  created_at: Date;
}

/** The caller's own reports. Scoped by the verified subject, never by the body. */
export async function listOwnReports(sql: Sql, subject: string): Promise<SupportReport[]> {
  const rows = await sql<ReportRow[]>`
    SELECT incident_id, support_id, category, status, created_at
    FROM support_reports
    WHERE auth_user_id = ${subject}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return rows.map((row) => ({
    incidentId: row.incident_id,
    supportId: row.support_id,
    category: row.category,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  }));
}
