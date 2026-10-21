# Clerk auth & session — real-session test plan

A reproducible plan to verify real sign-in and session restoration, using the
read-only diagnostic at `/diagnostics` (diagnostic builds only; see
`apps/web/src/features/diagnostics`). Capture diagnostic rows, HTTP status codes
and sanitized errors — **never** tokens, cookies, headers, passwords or PII.

## Verification levels (report each separately)

- **L1 — mocked** unit/component tests (Clerk faked). Logic only.
- **L2 — integration** real crypto / real DB, no real Clerk account.
- **L3 — real Clerk** a genuine sign-in against the configured instance in a browser.
- **L4 — device** the installed Android app on the Galaxy A35.

A passing L1/L2 does **not** establish L3/L4.

## Prerequisites (verify in the diagnostic first)

Open `/diagnostics` and confirm, before any sign-in:

- Clerk: *publishable key present = yes*, *format valid = yes*, *category* (test/live), *provider configured = yes*, *clerk-js mounted = yes*, *loaded = yes*.
- API & origin: *effective API URL* is your HTTPS API (not `http://localhost:3001`), *localhost fallback active = no*, *app origin* is as expected (`https://localhost` in the Android app).

If *key present = no* → the build lacks `VITE_CLERK_PUBLISHABLE_KEY` (no Clerk). If *localhost fallback active = yes* on device → the build lacks `VITE_API_URL`.

## Steps

| # | Action | Expected | Capture |
|---|---|---|---|
| 1 | Launch with valid config | App opens to dashboard (local-first), no spinner lock | diagnostic: current state |
| 2 | Sign in (email+password or emailed code — whatever the instance supports) | Auth state → `signed_in` | state badge |
| 3 | Confirm entry | App usable; Account shows the signed-in identity | — |
| 4 | Navigate protected screens (Account, Import, Results) | No redirect to `/sign-in`, no logout | — |
| 5 | Reload the web app (or `/diagnostics` → **Persist & reload**) | *Before this load = signed_in*, *current = signed_in*, *restored across reload = yes* | both rows |
| 6 | Close & reopen the Android app | Session restored (see L4 note) | before/after rows |
| 7 | Confirm restoration | Auth state `signed_in` after cold start | — |
| 8 | **Probe authenticated /me** (read-only) | `ok` (200) | probe row + status |
| 9 | Invalid/expired session (wait out token / revoke in Clerk dashboard) | Supported refresh, else state → `expired` (not a silent sign-out); local data intact | state + probe (expect 401) |
| 10 | Sign out intentionally | State → `signed_out`; authenticated probe → `no-token`/401 | probe row |
| 11 | Signed-out local use | Dashboard/results/attendance still work; local records present | — |

## What each probe tells you

- **Connectivity (no auth)** `unauthorized (401)` = server reachable and enforcing auth (good). `network`/`unconfigured` = wrong/missing API URL.
- **Authenticated GET /me** `ok` = token minted and accepted end-to-end. `unauthorized (401)` with a valid session = **`azp` mismatch**: the API's `CLERK_AUTHORIZED_PARTIES` is missing this origin (add `https://localhost` for the app). `no-token` = not signed in / `getToken()` returned nothing.

## L4 (device) notes

- A **`pk_live`** instance relies on first-party cookies on a real domain; inside the WebView at `https://localhost` there is no backing domain, so restore across restart may fail. A **`pk_test`** instance persists via the `__clerk_db_jwt` handshake in `localStorage`, which survives restarts. If step 6/7 fails with a live key, that is the first thing to check — but confirm against the installed Clerk SDK's documented storage behavior before changing keys.
- Use `adb logcat` during steps 2/6/9 for sanitized errors. Do not clear app data.
