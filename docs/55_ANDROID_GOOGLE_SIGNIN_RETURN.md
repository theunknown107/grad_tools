# 55 — Android Google sign-in return (`/native-return`)

> **Do not push or deploy a branch that omits `/native-return`.**
> `feat/figma-frontend` is Vercel's production branch. A deploy without this
> route strands every Android student in Chrome on a 404 after Google sign-in.
> `apps/web/test/native-return.test.ts` fails if the route or its safeguards go.

## Why the route exists

Google refuses OAuth inside an app WebView, so the Android app runs Google
sign-in in the system browser (a Chrome Custom Tab). Clerk will not return to a
custom scheme such as `gradtools://` during a real login, so the app gives Clerk
an https page to return to: `https://grad-tools.vercel.app/native-return` (the
app's `NATIVE_RETURN_PAGE`). That page's only job is to bring the app back.

## The flow

1. The app's WebView creates a Clerk sign-in or sign-up with
   `strategy: oauth_google` and `redirectUrl` = the page above, records a
   single-use, 10-minute "pending sign-in" marker, and opens Google in a Custom Tab.
2. Google and Clerk complete OAuth **on Clerk's servers**. The `state` and PKCE
   checks belong to Clerk and are not reimplemented anywhere.
3. Clerk redirects the tab to `/native-return`. The page:
   - removes Clerk's query from the tab's history (`history.replaceState`);
   - opens `intent://auth/callback#Intent;scheme=gradtools;package=app.gradtools;…`.
     The intent is **pinned to the GradTools package**, so no other app can
     receive it;
   - shows "GradTools · Signing you in…" (light or dark), with no app shell, no
     navigation and no external requests;
   - if the app does not open, shows a short recovery message and an
     *Open GradTools* link (via `?handoff=failed` or after 4 s);
   - off Android, says "Finish on your phone".
4. The app receives `gradtools://auth/callback`, which carries **no token and no
   data**. It acts only if it started a sign-in in the last 10 minutes, then
   re-reads the attempt from Clerk and activates a session only when Clerk
   reports `complete`. A stray or forged link can at most trigger a re-check.

## Where it lives

| Piece | Location |
|---|---|
| Page (static, self-contained) | `apps/web/public/native-return.html` (Vite copies it to the build unchanged) |
| Route | `vercel.json`: `/native-return` → `/native-return.html`, **before** the `/(.*)` catch-all |
| Regression test | `apps/web/test/native-return.test.ts` |
| App side | `NATIVE_RETURN_PAGE` and `completeDeepLink` in the app's Clerk adapter; Android intent filter `gradtools://auth` |

The page was first deployed by hand on 22 Nov 2026 (Vercel deployment
`dpl_C378tBDM39KheLFa8qoGhY7pVSKu`) and verified with a real Google sign-in on
a Samsung Galaxy A35: Custom Tab → Google → back in GradTools, signed in. The
tracked file is byte-identical to that deployment.

## Testing

- Unit: `pnpm --filter @gradtools/web exec vitest run test/native-return.test.ts`.
- Device, without signing in: open the page in the phone's Chrome. GradTools
  should come to the front and, with no pending sign-in, ignore the link.
- End to end: sign out in the app, choose *Continue with Google*, pick an
  account. The app should return by itself, signed in.

## Clerk: development vs production

The Android app currently uses Clerk's **development** instance (`pk_test_…`).
A production release needs a production Clerk instance with its own Google
OAuth client, `https://grad-tools.vercel.app/native-return` (or the production
domain's equivalent) allowed as a redirect URL, and the app built with the
production publishable key. No credential values belong in this repository.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Chrome shows the web app's 404 after Google | Route missing from the deployed build: check `vercel.json` and the page, and redeploy |
| Page stays on "Still here?" | App not installed under `app.gradtools`, or Chrome blocked the hand-off: tap *Open GradTools* |
| Back in the app but not signed in | Google was cancelled or failed, or the 10-minute marker expired: sign in again |

## Known limits

- The hand-off is a package-pinned intent to a custom scheme, not a verified
  Android App Link. App Links would need a manifest change and a rebuilt APK.
- Recovery from a missing route: roll back to the last deployment that serves
  `/native-return`, then fix the branch.
