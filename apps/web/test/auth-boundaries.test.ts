/**
 * What an account does, and what it deliberately does not do.
 *
 * Authority: docs/11 §11.13-11.14 · docs/25 §25.16 · M9 §22.17
 *
 * Two boundaries meet here and neither may drift:
 *
 *  - an ACCOUNT syncs the student's cloud records, and says truthfully which
 *    sign-in methods a build can actually perform;
 *  - the ATTENDANCE ledger, the date overrides and the remote observations are
 *    device-local in this phase, and signing in does not change that.
 *
 * The second is not a detail of the sync code: it is the boundary the whole
 * v1 attendance model rests on (domain/attendance). A future change that adds
 * `attendanceLedger` to the synced collections would reintroduce the two-writer
 * aggregate model those tests exist to prevent, so the allowlist is asserted
 * here as data rather than left to reading.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * Resolved from the package root rather than from `import.meta.url`: under the
 * jsdom environment the module URL is not a file: URL at all.
 */
/*
 * The web package's root, whichever directory the runner was started in: the
 * project root when the whole suite runs, `apps/web` when this file does.
 */
const WEB_ROOT = existsSync(resolve(process.cwd(), 'apps/web/src'))
  ? resolve(process.cwd(), 'apps/web')
  : process.cwd();
const from = (path: string): string => resolve(WEB_ROOT, path);
const SYNC = from('src/features/auth/useSync.ts');

/** The collection names in `useSync.COLLECTIONS`, read from the source. */
async function syncedCollections(): Promise<string[]> {
  const source = await readFile(SYNC, 'utf8');
  const block = /const COLLECTIONS = \[(.*?)\] as const;/s.exec(source);
  if (block === null) throw new Error('COLLECTIONS is no longer declared as a literal');
  return [...(block[1] as string).matchAll(/\['([a-zA-Z]+)',/g)].map((match) => match[1] as string);
}

describe('what an account syncs', () => {
  it('syncs exactly the cloud-backed student collections', async () => {
    expect(await syncedCollections()).toEqual([
      'semesters',
      'semesterSubjects',
      'results',
      'attendance',
      'timetable',
      'backlogs',
    ]);
  });

  /*
   * G and H of the M9 boundary: per-class history and date-specific schedule
   * changes stay on the device in this phase. This is the staged model the
   * account screen states in words; here it is stated as data.
   */
  it.each(['attendanceLedger', 'timetableOverrides', 'remoteSnapshots'])(
    'never puts %s in the synced collections',
    async (collection) => {
      expect(await syncedCollections()).not.toContain(collection);
    },
  );

  it('keeps the attendance row itself out of a v1 device’s push', async () => {
    const source = await readFile(SYNC, 'utf8');
    /*
     * Both halves of the rule, asserted where they live: nothing collected for
     * publishing, and no tombstone for what is no longer collected. The
     * behaviour is proven in sync-attendance.test.tsx against a fake server;
     * this is the guard against either line being quietly dropped.
     */
    expect(source).toMatch(/if \(collection === 'attendance' && ledgerAuthoritative\(version\)\)/);
    expect(source).toMatch(
      /ledgerAuthoritative\(version\) && candidate\.collection === 'attendance'/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Provider truthfulness                                                      */
/* -------------------------------------------------------------------------- */

describe('what the app says about a sign-in method', () => {
  /*
   * Google and Apple exist in code and are enabled per project in the
   * provider's dashboard. Where a build's project has not enabled one, the
   * student must be told that — not "something went wrong", which invites them
   * to keep pressing a button that cannot work yet (docs/25 §25.16).
   */
  it('says a method is unavailable rather than blaming the student', async () => {
    const source = await readFile(from('src/repositories/cloud/supabase.ts'), 'utf8');
    expect(source).toContain('provider is not enabled');
    expect(source).toContain('not available for this build yet');
  });

  it('claims nowhere in the UI that a provider has been verified', async () => {
    const source = await readFile(from('src/features/auth/SignInPage.tsx'), 'utf8');
    /*
     * Scoped to claims ABOUT a provider. "GradTools works without one" is a
     * true statement about the product and must not trip this.
     */
    expect(source).not.toMatch(/(google|apple)[^.]{0,40}(verified|tested|confirmed)/i);
    expect(source).not.toMatch(/(verified|tested)[^.]{0,40}(google|apple)/i);
  });
});
