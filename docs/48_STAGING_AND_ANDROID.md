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
- Apply `services/api/src/db/supabase/0001…` onward in order. **Never apply `0000_local_substrate.sql`**, because it would redefine Supabase's own `auth` schema.
- Test accounts must be synthetic: invented names, no real USNs, no real results.
- Auth → URL configuration:
  - Site URL: `https://<static-site>`
  - Redirect allowlist: `https://<static-site>/account`
- `SUPABASE_DB_URL` must connect as `authenticator` (docs/25 §25.15). Setting its password on a hosted project is a Supabase dashboard or SQL step that has not been exercised here.
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
- JDK 17 or newer (Android Studio bundles one)
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
- **Launcher icons and splash** are Capacitor's defaults. They must be generated from the GradTools mark before anyone outside development sees the app.
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
| Top bar, sidebar, landing header | top: the status bar stays behind the bar's own material, and content starts below it |
| App shell, bottom nav | left and right: notches and rounded corners in landscape |
| Bottom nav, sheets, toasts, main scroll padding | bottom: the gesture bar |

- Touch targets are unchanged.
- The status-bar icon style is `DEFAULT`, which follows the system theme. Following the app's own theme toggle would need `@capacitor/core`'s `SystemBars` API; that is not done.

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

- **Materials are CSS classes, not per-component styling.** `.gt-glass` covers controls, and the new `.gt-bar` is the one material for every edge bar (top bar, bottom nav, landing header). `.gt-bar` reproduces the existing look exactly: panel at 95% (98% on the bottom nav) under an 8px blur.
- **A glass layer is a change in `index.css` only.** Swap the fill, the filter and the highlight in `.gt-bar` and `.gt-glass`; no component changes.
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
