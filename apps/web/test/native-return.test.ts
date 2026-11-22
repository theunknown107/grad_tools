// @vitest-environment node
/**
 * The Android Google sign-in return page must never silently disappear.
 *
 * Clerk sends the browser tab to https://grad-tools.vercel.app/native-return
 * after Google sign-in in the Android app (the app's NATIVE_RETURN_PAGE). If a
 * deploy loses that route, the site's catch-all serves the web app's 404 and
 * students are stranded in Chrome. These checks fail before that can ship.
 * See docs/52_ANDROID_GOOGLE_SIGNIN_RETURN.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../public/native-return.html', import.meta.url), 'utf8');
const vercel = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
) as { rewrites: { source: string; destination: string }[] };

describe('/native-return (Android Google sign-in return)', () => {
  it('is routed to the static page before the catch-all rewrite', () => {
    const sources = vercel.rewrites.map((rule) => rule.source);
    const route = vercel.rewrites.find((rule) => rule.source === '/native-return');
    expect(route?.destination).toBe('/native-return.html');
    expect(sources.indexOf('/native-return')).toBeLessThan(sources.indexOf('/(.*)'));
  });

  it('hands back only to the GradTools package, with no token in the link', () => {
    expect(page).toContain(
      "'intent://auth/callback#Intent;scheme=gradtools;package=app.gradtools;'",
    );
    expect(page).not.toMatch(/token=|session=|__session/i);
  });

  it("keeps Clerk's query out of history and stores nothing", () => {
    expect(page).toContain("history.replaceState(null, '', location.pathname)");
    expect(page).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it('loads nothing external and offers a recovery path', () => {
    expect(page).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img[^>]+src=/i);
    expect(page).toContain('handoff=failed');
    expect(page).toContain('Open GradTools');
  });
});
