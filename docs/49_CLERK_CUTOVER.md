# 49 — Clerk cutover runbook

Authentication moves from Supabase Auth to Clerk. Supabase stays the database
(Postgres + row-level security). This is the order of operations; nothing here
has been done to production yet.

## How identity reaches the database

```
browser: Clerk session token  (Authorization: Bearer, from session.getToken())
→ API: clerkMiddleware()      (verifies signature, expiry, authorized party — auth/clerk.ts)
→ getAuth(req).userId         (clerkAuthenticator → req.session.userId)
→ withUser()                  (SET LOCAL role authenticated;
                               request.jwt.claims = {"sub": userId} — db/cloud.ts)
→ auth.jwt() ->> 'sub'        (every RLS policy, Supabase 0012)
```

The browser never talks to Supabase directly, so Supabase's "third-party
auth" integration is NOT on this path and is not required. Nothing else in a
request (body, query, path) is read as identity.

Proven, unmocked, by `services/api/test/clerk-cutover.test.ts` (real
`clerkMiddleware` verifying RS256 tokens offline via `CLERK_JWT_KEY`, real
routes, real Postgres RLS).

## Authority selection

| `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` | API accepts |
|---|---|
| both set | Clerk sessions only — Supabase sessions get 401 |
| neither | legacy Supabase sessions only (rollback path) |
| one of them | refuses to start |

## Dashboard configuration (manual)

Clerk:
1. A **production instance needs a domain you own** (Clerk adds DNS records to
   it). `grad-tools.vercel.app` cannot be that domain. Attach a custom domain to
   the Vercel project first.
2. Sign-in options: Email address + Password, email verification code. Google.
   Phone/SMS **off**, Apple **off**.
3. Google: production needs your own Google OAuth client; paste the Authorized
   redirect URI that Clerk's Google connection page shows into Google Cloud.
4. Allowed origins: add the Android WebView origin `https://localhost`
   (Capacitor's default; there is no `androidScheme` override) with the Backend
   API `instances.update({ allowedOrigins: [...] })`, server-side.

Secrets / variables:

| Where | Variable | Value |
|---|---|---|
| Vercel (web build) | `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| Android build env | `VITE_CLERK_PUBLISHABLE_KEY` | same `pk_live_…` |
| Render (API) | `CLERK_PUBLISHABLE_KEY` | same `pk_live_…` |
| Render (API), secret | `CLERK_SECRET_KEY` | `sk_live_…` — never a `VITE_` variable |
| Render (API) | `CLERK_AUTHORIZED_PARTIES` | `https://<custom domain>,https://localhost` |

App URLs: `/sso-callback` (Google returns here), `/account` (after sign-in).
Local development: `http://localhost:5173` with a development instance (`pk_test_`).

## Database: migration 0012

- Production read on 2026-10-08: 1 `auth.users` row, 0 rows in all nine student
  tables; catalogue matches the local pre-0012 schema (37 policies, 30 indexes,
  9 `auth.users` foreign keys).
- Dry run, any time, against a throwaway database:
  `DRYRUN_ADMIN_URL=…/x_dryrun DRYRUN_APP_URL=…/x_dryrun node services/api/scripts/migration-0012-dryrun.mjs`
- Rollback: usually unnecessary (unset the Clerk keys; 0012 serves Supabase
  subjects too). Exact schema rollback: `services/api/src/db/supabase/rollback/0012_down.sql`,
  which refuses while any Clerk-owned row exists.
- 0012 is one transaction and is not re-runnable (fails on `accounts` existing).

## Device data from the old account

Records saved on a device under the old Supabase id stay in IndexedDB under
that id. On first Clerk sign-in into an account with no records, the Account
page offers to COPY them in (`LegacyDataOffer`), only on confirmation, never
overwriting, keeping the old copy until the student removes it. They upload on
the next sync.

## Cutover order

1. Back up production (Supabase dashboard backup / `pg_dump`); confirm restorable.
2. Clerk app + domain + Google + allowed origins configured.
3. Apply 0012 and deploy the new API **back to back**, Clerk keys still unset.
   They depend on each other: the new API creates an `accounts` row on every
   request (needs 0012), and the old API's cloud writes fail 0012's foreign key.
   Between the two steps, cloud sync errors (local data is unaffected). With
   the keys unset the new API still runs Supabase Auth, on the 0012 schema.
4. Set the Clerk variables on Render, then Vercel; redeploy API first, then web.
5. Live checks (below). On failure: unset the Clerk variables and redeploy.
6. After a stable period: remove legacy Supabase Auth code and `SUPABASE_URL` /
   `SUPABASE_ADMIN_DB_URL`.

Live checks: sign up + email code; sign in; new-device code; password reset;
Google on web; two accounts see only their own data; account deletion removes
data and the Clerk user; Android email/password. Google on Android is not
supported yet (hidden in the app).
