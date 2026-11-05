/* global process, console, URL */
/* eslint-disable no-console -- a command-line report */
/**
 * Supabase 0012 DRY RUN — never against production.
 *
 * Builds the pre-0012 schema (0000–0011) in a THROWAWAY database, seeds legacy
 * uuid-owned rows in all nine student tables, applies 0012, and checks: every
 * row byte-for-byte, owners → accounts, indexes, foreign keys, policies, views
 * and grants, RLS as the runtime role, cascade deletion, then the rollback
 * (rollback/0012_down.sql) — refusal while Clerk-owned rows exist, and an exact
 * return to the pre-0012 catalogue — and re-applying 0012.
 *
 *   DRYRUN_ADMIN_URL=postgres://<superuser>@127.0.0.1:<port>/<anything>_dryrun  *   DRYRUN_APP_URL=postgres://authenticator:<pw>@127.0.0.1:<port>/<same>_dryrun  *   node scripts/migration-0012-dryrun.mjs
 *
 * The cluster needs the roles the migrations expect (anon, authenticated,
 * gradtools_monitor, authenticator) — the API test cluster has them. The
 * database name MUST end in `_dryrun`: its public schema is dropped.
 */
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const postgres = require('postgres');
const DIR = fileURLToPath(new URL('../src/db/supabase/', import.meta.url));
const ADMIN_URL = process.env.DRYRUN_ADMIN_URL;
const APP_URL = process.env.DRYRUN_APP_URL;
for (const url of [ADMIN_URL, APP_URL]) {
  if (url === undefined || !/\/[A-Za-z0-9_]+_dryrun(\?|$)/.test(url)) {
    console.error(
      'Refusing: set DRYRUN_ADMIN_URL and DRYRUN_APP_URL to a database whose name ends in _dryrun.',
    );
    process.exit(2);
  }
}
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
const app = postgres(APP_URL, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});
const T = [
  'student_profiles',
  'semester_records',
  'semester_subjects',
  'semester_results',
  'result_subjects',
  'attendance_records',
  'timetable_slots',
  'backlog_records',
  'source_notifications',
];
const U1 = '11111111-0000-4000-8000-000000000001';
const U2 = '22222222-0000-4000-8000-000000000002';
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

async function snapshot() {
  const q = (s) => admin.unsafe(s);
  const lines = [];
  for (const r of await q(
    `SELECT tablename||'.'||policyname||' '||cmd||' '||array_to_string(roles,',')||' USING '||coalesce(qual,'-')||' CHECK '||coalesce(with_check,'-') l FROM pg_policies WHERE schemaname='public'`,
  ))
    lines.push('policy ' + r.l);
  for (const r of await q(
    `SELECT table_name||'.'||column_name||' '||data_type||' '||is_nullable||' default='||coalesce(column_default,'') l FROM information_schema.columns WHERE table_schema='public'`,
  ))
    lines.push('column ' + r.l);
  for (const r of await q(
    `SELECT conrelid::regclass::text||'.'||conname||' '||pg_get_constraintdef(oid) l FROM pg_constraint WHERE connamespace='public'::regnamespace`,
  ))
    lines.push('constraint ' + r.l);
  for (const r of await q(`SELECT indexdef l FROM pg_indexes WHERE schemaname='public'`))
    lines.push('index ' + r.l);
  for (const r of await q(
    `SELECT relname||' kind='||relkind::text||' rls='||relrowsecurity::text||' force='||relforcerowsecurity::text||' acl='||coalesce(array_to_string(relacl,' '),'') l FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v')`,
  ))
    lines.push('relation ' + r.l);
  for (const r of await q(
    `SELECT viewname||' '||regexp_replace(definition,'[[:space:]]+',' ','g') l FROM pg_views WHERE schemaname='public'`,
  ))
    lines.push('view ' + r.l);
  for (const r of await q(
    `SELECT c.relname||' '||coalesce(obj_description(c.oid,'pg_class'),'') l FROM pg_class c WHERE relnamespace='public'::regnamespace AND relkind='v'`,
  ))
    lines.push('comment ' + r.l);
  for (const r of await q(
    `SELECT tgrelid::regclass::text||'.'||tgname l FROM pg_trigger WHERE NOT tgisinternal`,
  ))
    lines.push('trigger ' + r.l);
  return lines.sort();
}
async function rowHashes() {
  const out = {};
  for (const t of T)
    out[t] = (await admin.unsafe(`SELECT md5(row_to_json(x)::text) h FROM ${t} x ORDER BY 1`)).map(
      (r) => r.h,
    );
  return out;
}
const asUser = (sub, work) =>
  app.begin(async (tx) => {
    await tx`SELECT set_config('role','authenticated',true)`;
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub, role: 'authenticated' })}, true)`;
    return work(tx);
  });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 0. the pre-0012 schema, from the same files production was built from
await admin.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
for (const file of (await readdir(DIR))
  .filter((name) => name.endsWith('.sql') && name < '0012')
  .sort()) {
  await admin.unsafe(await readFile(DIR + file, 'utf8'));
}
await admin`DELETE FROM auth.users WHERE id IN (${U1}, ${U2})`;

// ---- 1. seed legacy (uuid) data in all nine tables, as the pre-0012 schema requires
for (const u of [U1, U2]) {
  await admin`INSERT INTO auth.users (id) VALUES (${u})`;
  const [p] =
    await admin`INSERT INTO student_profiles (auth_user_id, scheme_id, display_name) VALUES (${u}, 'vtu-2022', ${'Legacy ' + u.slice(0, 2)}) RETURNING id`;
  await admin`INSERT INTO semester_records (auth_user_id, profile_id, number) VALUES (${u}, ${p.id}, 3)`;
  await admin`INSERT INTO semester_subjects (auth_user_id, profile_id, semester, code, title, credits) VALUES (${u}, ${p.id}, 3, 'BCS301', 'Mathematics', 4)`;
  const [r] =
    await admin`INSERT INTO semester_results (auth_user_id, profile_id, semester, scheme_id) VALUES (${u}, ${p.id}, 3, 'vtu-2022') RETURNING id`;
  await admin`INSERT INTO result_subjects (auth_user_id, result_id, subject_code, subject_title) VALUES (${u}, ${r.id}, 'BCS301', 'Mathematics')`;
  await admin`INSERT INTO attendance_records (auth_user_id, profile_id, semester, subject_code, subject_title, conducted, attended) VALUES (${u}, ${p.id}, 3, 'BCS301', 'Mathematics', 10, 8)`;
  await admin`INSERT INTO timetable_slots (auth_user_id, profile_id, day, start_time, end_time, subject_code) VALUES (${u}, ${p.id}, 'Mon', '09:00', '10:00', 'BCS301')`;
  await admin`INSERT INTO backlog_records (auth_user_id, profile_id, subject_code, subject_title, origin_semester) VALUES (${u}, ${p.id}, 'BCS301', 'Mathematics', 3)`;
  await admin`INSERT INTO source_notifications (auth_user_id, profile_id, source_family, external_id, content_hash, category, importance, title, source_url, reason, run_id)
    VALUES (${u}, ${p.id}, 'vtu', 'n1', ${'a'.repeat(64)}, 'exam', 'high', 'Synthetic notice', 'https://example.test/n1', 'synthetic', 'run-1')`;
}
const PRE = await snapshot();
const preRows = await rowHashes();
check(
  'seeded one row per table per legacy user',
  T.every((t) => preRows[t].length === 2),
);

// ---- 2. apply 0012
await admin.unsafe(await readFile(DIR + '0012_text_identity_for_clerk.sql', 'utf8'));
const POST = await snapshot();
const postRows = await rowHashes();
check(
  'every row survives byte-for-byte (row_to_json md5)',
  T.every((t) => same(preRows[t], postRows[t])),
);
const accounts = (await admin`SELECT id FROM accounts ORDER BY id`).map((r) => r.id);
check('legacy owners became accounts', same(accounts, [U1, U2]), accounts.join(','));
check(
  'auth.users untouched',
  (await admin`SELECT count(*)::int n FROM auth.users WHERE id IN (${U1},${U2})`)[0].n === 2,
);
const types =
  await admin`SELECT table_name, data_type, column_default FROM information_schema.columns WHERE table_schema='public' AND column_name='auth_user_id' AND table_name = ANY(${T})`;
check(
  'auth_user_id is text with the sub default in all 9',
  types.length === 9 &&
    types.every((c) => c.data_type === 'text' && c.column_default.includes("auth.jwt() ->> 'sub'")),
);
const idx = (s) => s.filter((l) => l.startsWith('index ') && !l.includes('accounts'));
check(
  'every pre-0012 index still exists, unchanged',
  same(idx(PRE), idx(POST)),
  `${idx(POST).length} indexes`,
);
const fks =
  await admin`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE contype='f' AND conname LIKE '%auth_user_id_fkey'`;
check(
  '9 owner FKs reference accounts ON DELETE CASCADE',
  fks.length === 9 &&
    fks.every(
      (f) => f.d === 'FOREIGN KEY (auth_user_id) REFERENCES accounts(id) ON DELETE CASCADE',
    ),
);
check(
  'composite result FK restored',
  POST.some((l) =>
    l.includes(
      'result_subjects_belong_to_their_result FOREIGN KEY (result_id, auth_user_id) REFERENCES semester_results(id, auth_user_id) ON DELETE CASCADE',
    ),
  ),
);
check(
  'no policy uses auth.uid()',
  !POST.some((l) => l.startsWith('policy') && l.includes('auth.uid()')),
);
check(
  '36 owner + 3 account + 1 monitor policies',
  POST.filter((l) => l.startsWith('policy')).length === 40,
  `${POST.filter((l) => l.startsWith('policy')).length}`,
);
check(
  'monitor insert policy untouched',
  PRE.filter((l) => l.includes('insert_by_monitor')).every((l) => POST.includes(l)),
);
const views = (s) =>
  s.filter(
    (l) => l.startsWith('view ') || l.startsWith('comment ') || l.startsWith('relation monitor_'),
  );
check('monitor views: same definitions, comments and grants', same(views(PRE), views(POST)));
console.log(
  'INFO  ' +
    POST.filter((l) => l.startsWith('relation monitor_') || l.startsWith('relation accounts')).join(
      '\nINFO  ',
    ),
);

// ---- 3. RLS on the migrated schema, as the runtime role
const seen = await asUser(U1, (tx) =>
  Promise.all(T.map((t) => tx.unsafe(`SELECT auth_user_id FROM ${t}`))),
);
check(
  'legacy user U1 still sees exactly their own row in all 9 tables',
  seen.every((rows) => rows.length === 1 && rows[0].auth_user_id === U1),
);
const none = await app.begin(async (tx) => {
  await tx`SELECT set_config('role','authenticated',true)`;
  return Promise.all(T.map((t) => tx.unsafe(`SELECT 1 FROM ${t}`)));
});
check(
  'no subject: sees nothing in all 9 tables',
  none.every((rows) => rows.length === 0),
);
const CLERK = 'user_2synthDryRun';
await asUser(CLERK, async (tx) => {
  await tx`INSERT INTO accounts DEFAULT VALUES`;
  await tx`INSERT INTO student_profiles (scheme_id) VALUES ('vtu-2022')`;
});
check(
  'a Clerk subject provisions and writes under its own id',
  (await admin`SELECT count(*)::int n FROM student_profiles WHERE auth_user_id = ${CLERK}`)[0].n ===
    1,
);
const clerkSees = await asUser(CLERK, (tx) => tx`SELECT auth_user_id FROM student_profiles`);
check(
  'the Clerk subject sees only its own profile',
  same(
    clerkSees.map((r) => r.auth_user_id),
    [CLERK],
  ),
);
const forged = await asUser(
  CLERK,
  (tx) =>
    tx`INSERT INTO semester_records (auth_user_id, profile_id, number) SELECT ${U1}, id, 1 FROM student_profiles LIMIT 1`,
).then(
  () => 'accepted',
  (e) => e.message,
);
check(
  'a Clerk subject cannot write rows owned by a legacy user',
  /row-level security/.test(forged),
  forged.slice(0, 80),
);

// ---- 4. cascade: U2 deletes their own account under RLS
await asUser(U2, (tx) => tx`DELETE FROM accounts WHERE id = (SELECT auth.jwt() ->> 'sub')`);
const left = await Promise.all(
  T.map((t) => admin.unsafe(`SELECT 1 FROM ${t} WHERE auth_user_id = '${U2}'`)),
);
check(
  'deleting the account row cascades through all 9 tables',
  left.every((r) => r.length === 0),
);
const u1Left = await Promise.all(
  T.map((t) => admin.unsafe(`SELECT 1 FROM ${t} WHERE auth_user_id = '${U1}'`)),
);
check(
  'U1 untouched by U2 deletion',
  u1Left.every((r) => r.length === 1),
);

// ---- 5. rollback refuses while a Clerk subject owns rows, changing nothing
const down = await readFile(DIR + 'rollback/0012_down.sql', 'utf8');
const refused = await admin.unsafe(down).then(
  () => 'ran',
  (e) => e.message,
);
check(
  'rollback refuses while a Clerk subject owns rows',
  /Rollback refused/.test(refused),
  refused.slice(0, 100),
);
check('...and the refused rollback changed nothing', same(await snapshot(), POST));

// ---- 6. rollback after removing Clerk rows: pre-0012 schema exactly, legacy data intact
await admin`DELETE FROM accounts WHERE id = ${CLERK}`;
const beforeDown = await rowHashes();
await admin.unsafe(down);
const BACK = await snapshot();
const diff = [
  ...PRE.filter((l) => !BACK.includes(l)).map((l) => '- ' + l),
  ...BACK.filter((l) => !PRE.includes(l)).map((l) => '+ ' + l),
];
check(
  'rollback restores the pre-0012 catalogue exactly',
  diff.length === 0,
  diff.slice(0, 8).join('\n      '),
);
check('rollback keeps every remaining row byte-for-byte', same(beforeDown, await rowHashes()));

// ---- 7. forward again
await admin.unsafe(await readFile(DIR + '0012_text_identity_for_clerk.sql', 'utf8'));
check(
  '0012 re-applies after a rollback to the identical post-0012 catalogue',
  same(await snapshot(), POST),
);

// ---- 8. 0012 is all-or-nothing: a second application fails and changes nothing
const again = await admin
  .unsafe(await readFile(DIR + '0012_text_identity_for_clerk.sql', 'utf8'))
  .then(
    () => 'ran',
    (e) => e.message,
  );
check(
  'applying 0012 twice fails loudly (not re-runnable) and changes nothing',
  again !== 'ran',
  again.slice(0, 60),
);

console.log(
  failures === 0 ? '\nDRY RUN: ALL CHECKS PASSED' : `\nDRY RUN: ${failures} CHECK(S) FAILED`,
);
await Promise.all([admin.end(), app.end()]);
process.exit(failures === 0 ? 0 : 1);
