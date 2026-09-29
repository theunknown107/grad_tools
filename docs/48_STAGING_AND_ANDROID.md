# Staging deployment and the Android app

Authority: docs/13 §13.4a · docs/25 §25.4 · docs/45 · DEC-051 · OQ-064 · OQ-065

## Status

| | |
| --- | --- |
| The code builds, type-checks and passes its tests | yes |
| The API is safe to bind publicly | yes: no route is unauthenticated (DEC-051) |
| A staging environment exists | **no**. Nothing in this document has been performed against a real host or a real Supabase project |
| An Android APK has been built | **no**. The build machine had no Android SDK |
| The Android app has run on a device | **no** |
| **Deployment-ready** | **not claimed.** It can be claimed once the checklist at the end has been walked through once, for real |

## Architecture

```
  Browser / Android WebView (https://localhost)
        │  static files                 │  fetch, bearer token
        ▼                               ▼
  STATIC HOST (apps/web/dist)       API (Docker image, Express)
                                        │                 │
                                reference DB          Supabase Postgres
                                (DATABASE_URL)        (SUPABASE_DB_URL, as `authenticator`)
                                        ▲
                                  worker (one-shot, same image)
```

- **Web.** It is a static single-page app. It calls the API directly: the static host does not proxy the API.
- **API.** One container with liveness at `/health` and readiness at `/health/ready`.
- **Supabase.** It provides sign-in (browser) and the student cloud (read by the API through RLS).

## Environment variables: where each one goes

**Browser (build-time, static host).** Everything prefixed `VITE_` is compiled into the bundle and the APK, so none of these may be a secret. Set them in `apps/web/.env.local` locally, or in the static host's build environment. Vite does not read VITE_ variables from the repository root.

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_API_URL` | **yes**, for staging and Android | The API's `https://` origin, with no trailing slash. When unset, a production build calls its own origin and never falls back to localhost |
| `VITE_SUPABASE_URL` | for accounts | `https://<staging-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | for accounts | The **publishable** key |

**Server (API web service).** Every value marked secret belongs in the host's secret store only.

| Variable | Required | Value |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` (already set in the image) |
| `APP_ENV` | yes | `staging` |
| `DATABASE_URL` | yes | **secret.** The reference database |
| `WEB_ORIGIN` | yes | `https://<static-site>,https://localhost` (exact origins, no `*`). In staging, every origin must be https or the API refuses to start |
| `HOST` / `PORT` | no | The image sets `0.0.0.0` / `3001`, and a host that assigns `PORT` overrides it |
| `OPERATOR_TOKEN` | no | **secret**, 32 characters or more, generated. When unset, the announcement entry and publish routes do not exist (404) |
| `SUPABASE_URL` | for accounts | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_DB_URL` | for accounts | **secret.** Must log in as `authenticator`, or the API refuses to start |
| `SUPABASE_ADMIN_DB_URL` | no | **secret.** Used only for account deletion |
| `OPENROUTER_API_KEY` | no | **secret.** Free-model AI reading (docs/13 §13.30); takes precedence over Gemini. Every read is refused unless the model is live-verified $0 |
| `DOCUMENT_AI_PRIMARY_MODEL` | no | Default `qwen/qwen3.8-27b:free` (DEC-056) |
| `DOCUMENT_AI_SECONDARY_MODEL` | no | Tried only if the primary is ineligible/unavailable, after the same checks |
| `DOCUMENT_AI_REQUIRE_ZDR` | no | Default `true`. `false` only for synthetic local testing; refused in staging/alpha |
| `GEMINI_API_KEY` | no | **secret.** Enables AI document reading for signed-in students (docs/13 §13.29). Unset: the route does not exist. Free tier: synthetic documents only |
| `GEMINI_DOCUMENT_MODEL` | no | Default `gemini-3.8-flash`; never switched automatically (see OQ-067) |
| `GEMINI_THINKING_LEVEL` | no | `minimal` \| `low` \| `medium` \| `high`; default `low` for predictable latency and cost |
| `GEMINI_ZERO_COST_APPROVED` | no | `true` to let the provider router use Gemini. Default `false`: Gemini can't prove $0 per request, so it is excluded (fails closed) unless the operator asserts the deployment's Gemini tier is free (docs/13 §13.31) |
| `LOG_LEVEL` | no | `info` |
| `INGESTION_ENABLED` | no | `false` |

**The browser never receives** the service-role key, any database URL or password, `OPERATOR_TOKEN`, OAuth client secrets, or any signing key. The committed-secrets guard in CI and the bundle-secrets test (docs/22 §22.17) enforce part of this. The rest is enforced by never prefixing a secret with `VITE_`.

Generate the operator token like this:

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Local development

```
pnpm install
pnpm --filter @gradtools/api migrate && pnpm --filter @gradtools/api seed
pnpm --filter @gradtools/api start      # 127.0.0.1:3001
pnpm --filter @gradtools/web dev        # http://localhost:5173
```

Templates: `services/api/.env.example`, `apps/web/.env.example`, and the root `.env.example` (an index of both).

## Staging on a Render-style host

This section only describes the setup; nothing here has been created. The same shape works on any host that serves static files and runs an OCI container.

### 1. Static site (web)

| Setting | Value |
| --- | --- |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @gradtools/web build` |
| Publish directory | `apps/web/dist` |
| Rewrite | `/*` → `/index.html` (rewrite, not redirect). The app uses `BrowserRouter`, so a reload on `/results` must serve the app |
| Environment | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

- `prebuild` copies the OCR engine into `public/ocr`, so it ships from the site's own origin.
- The build emits source maps (`sourcemap: true`). They contain no secrets, only the app's own source.

### 2. Web service (API)

| Setting | Value |
| --- | --- |
| Runtime | Docker, using the root `Dockerfile` |
| Health check path | `/health` (liveness). `/health/ready` checks the database |
| Instances | **one**. Realtime is single-instance (docs/45 §Realtime) |
| Environment | the server table above |

### 3. Reference database

A plain PostgreSQL database. Migrate and seed it once from any machine that can reach it, or as a pre-deploy command in the container:

```
DATABASE_URL=… pnpm --filter @gradtools/api migrate
DATABASE_URL=… pnpm --filter @gradtools/api seed
```

- `seed` writes public academic reference data only.
- **Do not run `seed:demo`** on anything a student will see. It writes synthetic announcements labelled DEMO.
- Whether the reference tables can share the Supabase project's database has **not been verified**. Use a separate database until that has been checked.

### 4. Supabase staging project

- A **new** project, separate from production. Never copy production data into it.
- Apply `services/api/src/db/supabase/0001…` onward in order. **Never apply `0000_local_substrate.sql`**, because it would redefine Supabase's own `auth` schema. There are ten to apply: `0001_student_cloud.sql` through `0010_profile_academic_identity.sql`.
  - **Apply them as the project owner, not as `authenticator`.** They create tables and policies, which `authenticator` cannot; the runtime connection is a different, lower-privilege role (below). The reference-DB runner (`pnpm --filter @gradtools/api migrate`) does **not** apply these — it targets `DATABASE_URL`, a separate database. Apply the student schema by hand, in order, via the Supabase SQL editor (paste each file) or `psql` as the owner:
    ```
    for f in services/api/src/db/supabase/00[0-1][0-9]_*.sql; do
      [ "$(basename "$f")" = "0000_local_substrate.sql" ] && continue
      psql "$SUPABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f "$f"    # owner/service connection, NOT the API's authenticator
    done
    ```
    `SUPABASE_OWNER_URL` is a one-off provisioning connection (the project's `postgres`/service credentials); it is **not** an application variable and is never given to the running API.
- Test accounts must be synthetic: invented names, no real USNs, no real results.
- Auth → URL configuration:
  - Site URL: `https://<static-site>`
  - Redirect allowlist: `https://<static-site>/account`
- `SUPABASE_DB_URL` must connect as a role that **cannot bypass RLS** — the startup guard refuses `bypassrls`/superuser. On a hosted project you cannot use `authenticator` directly: it is a reserved role and the project owner is **not** a superuser, so `ALTER ROLE authenticator … PASSWORD` fails with `"authenticator" is a reserved role, only superusers can modify it`. Instead create a dedicated login role (verified on staging 2026-09-29):
  ```sql
  -- as the owner (SUPABASE_OWNER_URL), once:
  CREATE ROLE gradtools_runtime LOGIN NOINHERIT NOBYPASSRLS PASSWORD '<generated>';
  GRANT authenticated TO gradtools_runtime;
  ```
  Then `SUPABASE_DB_URL` is the Session-Pooler URI for `gradtools_runtime.<project-ref>` (port 5432, `sslmode=require`). `NOINHERIT` means it holds no student-table access until `withUser` runs `SET LOCAL ROLE authenticated`; membership in `authenticated` is what permits that switch, and RLS via `auth.uid()` applies exactly as for `authenticator`. Never point `SUPABASE_DB_URL` at `postgres`/`service_role`/`SUPABASE_OWNER_URL`.
- Still outstanding from docs/25 §25.15: Google/Apple provider setup and leaked-password protection.

### 5. CORS

`WEB_ORIGIN` holds exact origins, comma-separated: the static site plus `https://localhost` for the Android app. There is no wildcard and there are no credentials; authentication is a bearer token. CORS is a browser policy, not an access control.

## Security summary

| Surface | Control |
| --- | --- |
| Public reads (reference data, announcements, library) | None needed: identical for every visitor and contain no student data |
| `/api/v1/me/*` | Supabase JWT (`guard`), then RLS as `authenticator` |
| Announcement entry and publish | `OPERATOR_TOKEN` bearer, compared in constant time over SHA-256 digests. Every failure returns the same 401. Not mounted without the token |
| Startup | Staging and alpha refuse a missing or plain-http `WEB_ORIGIN`. The API refuses a `SUPABASE_DB_URL` role that can bypass RLS |

**There is one operator credential, not a role model.** `verifiedBy` is a label, not an identity. Rotating the credential means changing `OPERATOR_TOKEN` and restarting.

## Android (Capacitor 8)

The Android project lives in `apps/web/android` and is committed. Its build outputs, and its copy of the web bundle (`app/src/main/assets/public`), are gitignored and regenerated by sync. The config is `apps/web/capacitor.config.json`.

**Prerequisites:**
- **JDK 21** — Capacitor 8 compiles with `--release 21`; JDK 17 fails with "invalid source release: 21". Android Studio's bundled JBR works: `JAVA_HOME="<Android Studio>/jbr" ./gradlew assembleDebug`
- Android Studio with the Android SDK
- `ANDROID_HOME` set, or `apps/web/android/local.properties` containing `sdk.dir=…`, which is gitignored

**Build the web bundle for the app.** `VITE_API_URL` must point at the staging API, because inside the app "same origin" means the phone itself:

```
# apps/web/.env.production.local  (gitignored)
VITE_API_URL=https://<staging-api>
VITE_SUPABASE_URL=https://<staging-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_…

pnpm --filter @gradtools/web android:sync    # build, then cap sync android
pnpm --filter @gradtools/web android:open    # opens Android Studio
```

**Android Studio workflow:**
1. Open the project and wait for the Gradle sync.
2. Choose a device or emulator and press Run.
3. After every web change, rerun `android:sync`. Android Studio does not rebuild the web bundle.

**Debug APK:**
- From the command line: `cd apps/web/android && ./gradlew assembleDebug`. The output is `app/build/outputs/apk/debug/app-debug.apk`.
- From Android Studio: Build → Build App Bundle(s) / APK(s) → Build APK(s).

**A release build** needs a signing key that is never committed. That step is out of scope here, as is any store upload.

**What the app is:**
- The same web bundle, served from `https://localhost` inside the WebView.
- Its only permission is `INTERNET`.
- `android:allowBackup="false"`, so Android Auto Backup never copies the student's on-device records into a cloud backup.

**Open items:**
- **OQ-064.** Email and password sign-in works in the app. Google/Apple sign-in, sign-up confirmation and password-reset links do not, because they redirect to `https://localhost/account`, which the system browser cannot hand back to the app. This needs a deep link plus a Supabase redirect URL.
- **OQ-065.** `appId` `app.gradtools` is a placeholder. It is permanent once published.
- **Launcher icon and splash** come from the GradTools mark, generated — never drawn — by `pnpm --filter @gradtools/web android:icons` (`scripts/android-icons.mjs`): a vector adaptive-icon foreground inside the 66dp safe zone (also the Android 13 monochrome icon), the blood-red background, legacy PNGs for API 24–25 rendered by Chromium at each density, and a vector splash. Re-run it after changing `src/brand/gradtools-mark.svg`.
- None of this has been run on a device.

## Edge-to-edge

- `index.html` already declares `viewport-fit=cover`.
- Capacitor's `SystemBars` runs with `insetsHandling: "css"`:
  - it draws the WebView edge-to-edge;
  - it injects `--safe-area-inset-*`, because `env()` can read 0 in older WebViews;
  - `initialViewportFitValueHint: "cover"` avoids a layout jump at start-up.
- `index.css` resolves each side once, falling back to `env()` in browsers and 0 on desktops:

```
--gt-safe-top / --gt-safe-right / --gt-safe-bottom / --gt-safe-left
```

| Surface | Inset |
| --- | --- |
| Top controls (no bar), sidebar, landing header | top: the controls sit inside the scroll area below the status bar and scroll away with the page on a phone; a page-coloured strip covers only the status bar (pinned on the page colour from `md`) |
| App shell, bottom nav | left and right: notches and rounded corners in landscape |
| Bottom nav, sheets, toasts, main scroll padding | bottom: the gesture bar |

- Touch targets are unchanged.
- The status-bar icon style is `DEFAULT`, which follows the system theme. Following the app's own theme toggle would need `@capacitor/core`'s `SystemBars` API; that is not done.

## The keyboard, and where popups may go

- **The bottom bar hides while a software keyboard is up** and returns when it
  closes (`useKeyboardOpen`, `src/lib/viewport.ts`). "Up" means an editable
  field has focus AND the visible viewport is 150px+ shorter than the tallest
  height seen at that width — so it works whether the WebView resizes (what the
  device test showed) or only the visual viewport shrinks, and it does not hide
  for focus alone (hardware keyboard, IME dismissed with the back gesture).
  Event-driven; nothing polls. Hidden, not unmounted, so scroll is kept.
  A rotation made with the keyboard up borrows the new orientation's full
  height from the other orientation (the axes swap), so the bar stays hidden
  through it. A native IME signal (`@capacitor/keyboard`) was not added.
- **Dropdowns, menus and popovers** keep a measured distance from each edge
  (`collisionInsets()`): the safe-area insets, the bottom bar while it shows,
  and whatever a keyboard covers of the visual viewport. Selects open
  downward, are capped at 18rem and scroll inside; they flip up only when they
  truly do not fit.

## A build with no server

A native build without `VITE_API_URL` has no server: its own origin is the
phone. Requests are not sent, and the UI says "not connected to a GradTools
server" rather than "could not be loaded" (the local asset server would have
answered with `index.html` and a 200). Bundled data still shows where the
architecture already has it (colleges, the built-in scheme); branches are typed.

## Background behaviour and battery

- **Nothing runs while the app is hidden.** `usePageVisible` combines the browser's `visibilitychange` with Capacitor's document `pause`/`resume`.
- `KeepRunning: "false"` (a Cordova preference in `capacitor.config.json`) makes Capacitor pause the WebView's JavaScript timers when the app is backgrounded.

| Work | Hidden or paused | Visible again |
| --- | --- | --- |
| Notification stream (SSE over fetch) | Aborted, and any backoff wait cancelled | Reconnects once; connecting refetches the authoritative inbox |
| Shared minute clock (`useNow`) | Timer cleared | Re-reads the clock (the day may have changed), then realigns to the minute |
| Announcement feed | Nothing runs | Refreshes on `focus`, `visibilitychange` and `resume` |
| Supabase token refresh | supabase-js pauses its own timer when the page is hidden | Resumes |

**Absent by design:**
- foreground or persistent services
- wake locks
- background location
- push or Web Push
- service workers
- the browser Notification API
- polling loops

Tested in `apps/web/test/page-lifecycle.test.tsx`.

## Refresh rate

Nothing is tied to a frame rate:
- There is no `requestAnimationFrame` loop, no `setInterval`, and no custom render loop.
- Motion is CSS transitions and a few keyframe animations, which the browser composites at whatever rate the display runs (60, 90 or 120 Hz).
- `prefers-reduced-motion` turns them off.
- Continuous animations exist only while something is loading: the spinner and the skeleton shimmer.
- The Android project sets no preferred display mode or refresh rate, so the system decides.

## Liquid Glass readiness

Not implemented, only prepared:

- **Materials are CSS classes, not per-component styling.** `.gt-glass` covers controls; `.gt-bubble` is every floating top control — 36px visible (`--gt-bubble-size`), 44px touch target (`.gt-hit`, `--gt-hit-size`) — (the app has no top bar: logo, search, theme, notifications and profile each float on the page); `.gt-bar` is the bottom bar and the landing header.
- **A glass layer is a change in `index.css` only.** Swap the fill, the filter and the highlight in `.gt-bubble`, `.gt-bar` and `.gt-glass`; no component changes. `.gt-bubble` is solid today, with a reduced-transparency rule already in place.
- **Every material stays legible with `backdrop-filter` disabled.** The fill carries it, and `.gt-bar` drops to an opaque panel under `prefers-reduced-transparency`.
- **Rules for whoever adds it:**
  - no blur larger than the current 8px on anything that scrolls;
  - no animated `backdrop-filter`;
  - check text contrast in light mode;
  - keep the reduced-transparency fallback.
- **There is no official web "Liquid Glass" package.** Any web version is an approximation and should say so.

## Checklist before calling staging deployment-ready

1. A Supabase staging project has been created, and migrations 0001 onward applied. 0000 has **not** been applied.
2. The Supabase Site URL and redirect allowlist are set, and the `authenticator` login verified.
3. The reference database has been migrated and seeded (without `seed:demo`).
4. The API service is up with `APP_ENV=staging`, and `/health` and `/health/ready` are green.
5. `curl -X POST <api>/api/v1/announcements/entry` returns **404** without a token configured, or **401** without the header.
6. The static site is up. A deep reload on `/results` serves the app, and the browser console shows no CORS errors.
7. Sign up, sign in, sync and delete an account with a synthetic user.
8. A debug APK has been built and installed on a real device. Check:
   - the bars clear the status and gesture bars;
   - reference data loads;
   - backgrounding the app for over a minute and returning refreshes the clock and inbox.
9. `pnpm verify` is green on the commit that was deployed.

## Staging smoke test (synthetic data only)

Walk this once against the deployed staging stack, signed in as a throwaway
account, using only invented documents (the `BQ`-prefixed synthetic fixtures,
never a real USN or grade card). It expands the checklist above into the full
user flow; each step is pass/fail.

| # | Step | Expected |
|---|---|---|
| 1 | Sign up with a synthetic email | Account created; session established |
| 2 | Reload the page while signed in | Session persists (no re-login) — `autoRefreshToken`/`persistSession` |
| 3 | Sign out | Session cleared; `/api/v1/me` calls now 401 |
| 4 | Sign back in; set up a profile (college, branch, scheme) | Profile saved and reloads |
| 5 | Import a timetable (synthetic PDF) offline (AI off) | Parsed on device; nothing leaves the app |
| 6 | Import a result card (synthetic PDF) offline | Rows parsed; conflicts/marks flagged in review |
| 7 | Offline parser with the network disabled | Still reads a text-layer PDF; no request attempted |
| 8 | Turn on "Read with AI"; import a synthetic image | Server extracts, or a fixed "temporarily unavailable / Offline mode" message when the free model is unavailable |
| 9 | Review → confirm | Nothing saved until confirm; on confirm the record appears |
| 10 | Reload the dashboard | Saved results/timetable persist |
| 11 | Open Announcements | Public feed loads; an external "Open the original" link is http(s) only |
| 12 | `GET /health` and `/health/ready` | `200 ok` and `200 ready` (or `503 degraded` if the DB is down) |
| 13 | `POST /api/v1/announcements/entry` with no token | `404` (no operator) or `401` (no header) |
| 14 | Trigger an error (oversized/invalid upload) | A clear message; no stack trace, provider text, key, or document content |
| 15 | Kill the network mid-action, then restore it | The app recovers; no corrupted local state |
| 16 | Install the debug APK; repeat 1–11 against staging | `VITE_API_URL` points at the staging API; same behaviour as web |

Any step that fails is a staging blocker. None of these can be run from the
repository alone — they require the external stack from the checklist above.
