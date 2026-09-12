/**
 * Getting a snapshot: the only step in the pipeline that the law touches.
 *
 * Authority: Phase 7B.3 §5, §19, §113, §114 · docs/41
 *
 * ---------------------------------------------------------------------------
 * TWO IMPLEMENTATIONS, ONE INTERFACE, AND ONLY ONE OF THEM IS BUILT
 * ---------------------------------------------------------------------------
 *
 * `acquireFixture` reads a snapshot from disk. `acquireLive` asks the source
 * registry and, today, is always refused — `terms_status` is `unknown` for all
 * six families and the CHECK constraint will not let it be otherwise until
 * somebody reviews VTU's terms of use and records what they found.
 *
 * That refusal is not a stub. It is the behaviour §113 requires a test to
 * prove, and it is what makes the rest of this directory honest: everything
 * downstream is exercised in full by fixtures, so the day permission exists the
 * change is a registry row, not a rewrite (§114).
 *
 * ---------------------------------------------------------------------------
 * FOUR WAYS TO NOT GET A SNAPSHOT, AND THEY ARE DIFFERENT
 * ---------------------------------------------------------------------------
 *
 *   unauthorized   we are not allowed to ask
 *   failed         we asked and got nothing (or could not open the file)
 *   malformed      we got something and it is not a snapshot
 *
 * Collapsing these into "error" is how a monitoring system ends up reporting
 * that a source is quiet when it is actually forbidden.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { acquisitionMode } from '../sources/acquire.js';
import type { Snapshot, SourceFamily } from './run.js';

/** The registry id each family is registered under (docs/41). */
export const FAMILY_SOURCE_ID: Readonly<Record<SourceFamily, string>> = {
  administration: 'vtu-administration',
  examination: 'vtu-examination',
  academic_calendar: 'vtu-academic-calendar',
  ug_scheme_syllabus: 'vtu-scheme-syllabus',
  pg_scheme_syllabus: 'vtu-pg-scheme-syllabus',
  regulations: 'vtu-regulations',
};

export const SOURCE_FAMILIES = Object.keys(FAMILY_SOURCE_ID) as readonly SourceFamily[];

export type AcquisitionFailure = 'unauthorized' | 'failed' | 'malformed';

export type AcquisitionOutcome =
  | { readonly ok: true; readonly snapshot: Snapshot; readonly from: string }
  | { readonly ok: false; readonly failure: AcquisitionFailure; readonly detail: string };

/**
 * The shape of a snapshot file.
 *
 * Strict on purpose: an unknown key is a fixture that has drifted from the code
 * that reads it, and silently ignoring it is how a test passes while testing
 * something else. `.strict()` turns that into a `malformed` outcome with the
 * offending key named.
 */
const audienceSchema = z
  .object({
    scheme: z.string().nullable(),
    programme: z.string().nullable(),
    branch: z.string().nullable(),
    department: z.string().nullable(),
    stream: z.string().nullable(),
    college: z.string().nullable(),
    semester: z.number().int().min(1).max(10).nullable(),
    courses: z.array(z.string()),
    examCycle: z.string().nullable(),
    unresolvedScope: z.boolean(),
  })
  .strict();

const itemSchema = z
  .object({
    externalId: z.string().min(1),
    url: z.string().url(),
    title: z.string().min(1),
    body: z.string(),
    publishedAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    supersedes: z.string().nullable(),
    audience: audienceSchema,
  })
  .strict();

const snapshotSchema = z
  .object({
    family: z.enum([
      'administration',
      'examination',
      'academic_calendar',
      'ug_scheme_syllabus',
      'pg_scheme_syllabus',
      'regulations',
    ]),
    capturedAt: z.string(),
    note: z.string(),
    items: z.array(itemSchema),
  })
  .strict();

/** Where the committed fixtures live. Resolved from this file, not from cwd. */
export function fixtureDirectory(): URL {
  return new URL('../../fixtures/monitor/', import.meta.url);
}

/**
 * A snapshot from disk.
 *
 * This opens no socket and consults no registry, because reading a file a
 * developer committed is not an access to vtu.ac.in and pretending otherwise
 * would make the fixture suite unrunnable for no gain.
 */
export async function acquireFixture(
  family: SourceFamily,
  version: string,
  directory: URL = fixtureDirectory(),
): Promise<AcquisitionOutcome> {
  const file = new URL(`${family}.${version}.json`, directory);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    return {
      ok: false,
      failure: 'failed',
      detail: `Could not read ${fileURLToPath(file)}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      failure: 'malformed',
      detail: `${fileURLToPath(file)} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = snapshotSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      failure: 'malformed',
      detail:
        first === undefined
          ? `${fileURLToPath(file)} is not a snapshot.`
          : `${fileURLToPath(file)}: ${first.path.join('.')} — ${first.message}`,
    };
  }

  /*
   * THE FILE NAME IS NOT THE AUTHORITY ON WHAT IS IN IT. A snapshot that
   * declares a different family than its name is a mistake worth refusing,
   * because the family decides which registry row the item is attributed to.
   */
  if (result.data.family !== family) {
    return {
      ok: false,
      failure: 'malformed',
      detail: `${fileURLToPath(file)} declares family "${result.data.family}" but is filed under "${family}".`,
    };
  }

  return {
    ok: true,
    from: fileURLToPath(file),
    snapshot: { family, items: result.data.items },
  };
}

/**
 * A snapshot from the live source, if the registry allows it.
 *
 * It does not, for any of the six, and this function is deliberately written so
 * that the refusal comes BEFORE any fetch code rather than instead of it. There
 * is no `fetch` below the gate because there is nothing to fetch yet; when
 * there is, it goes here, after this check, and the check does not move.
 *
 * §113: a test asserts this refuses. If someone makes it stop refusing without
 * the registry saying so, that test fails.
 */
export async function acquireLive(
  sql: Sql | null,
  family: SourceFamily,
): Promise<AcquisitionOutcome> {
  const sourceId = FAMILY_SOURCE_ID[family];
  const mode = await acquisitionMode(sql, sourceId);
  if (mode.mode === 'supplied') {
    return { ok: false, failure: 'unauthorized', detail: mode.detail };
  }

  /*
   * Reached only if the registry says all four gates pass. Nothing implements
   * it, and inventing a fetch here to make the branch look finished would be
   * building the one thing this phase is forbidden to build (§2).
   */
  return {
    ok: false,
    failure: 'failed',
    detail:
      `The registry permits fetching "${sourceId}", and no live adapter is implemented for the ` +
      `${family} family. Supply a snapshot instead.`,
  };
}
