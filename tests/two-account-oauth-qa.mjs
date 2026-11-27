/**
 * Can a Google URL started in one browser sign in the wrong browser?
 *
 * Needs two DISPOSABLE Google accounts and the app built against the development
 * Clerk instance. A person signs in by hand in the windows this opens; nothing here
 * types a credential or stores one. Never use a real account.
 *
 *   APP_URL=http://localhost:5173 node tests/two-account-oauth-qa.mjs
 *
 * Reproduced transfer = context A ends up signed in as the account that logged in
 * only in context B. Opening the URL in B is not itself a finding.
 */

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';

const app = process.env.APP_URL ?? 'http://localhost:5173';
const ask = createInterface({ input: process.stdin, output: process.stdout });

const who = async (page) => {
  await page.goto(`${app}/account`);
  await page.waitForTimeout(3000);
  const id = await page.evaluate(() => window.Clerk?.user?.id ?? null);
  return id === null ? 'signed out' : createHash('sha256').update(id).digest('hex').slice(0, 10);
};

const browser = await chromium.launch({ headless: false });
const [contextA, contextB] = [await browser.newContext(), await browser.newContext()];
const [pageA, pageB] = [await contextA.newPage(), await contextB.newPage()];

// Context A starts Google and stops at Google's page, without signing in.
await pageA.goto(`${app}/sign-in`);
await pageA.getByRole('button', { name: /google/i }).click();
await pageA.waitForURL(/accounts\.google\.com/, { timeout: 30_000 });
const copied = pageA.url();
console.log(
  `A stopped at Google. state present: ${String(new URL(copied).searchParams.has('state'))}`,
);

// Context B opens A's URL. The operator signs in there with disposable account B.
await pageB.goto(copied);
await ask.question('Sign in with disposable account B in window B, then press Enter. ');
const returnUrl = pageB.url();
console.log(`B landed on: ${new URL(returnUrl).origin}${new URL(returnUrl).pathname}`);

const resultB = await who(pageB);
const resultA = await who(pageA);
console.log({ contextA: resultA, contextB: resultB });

// Replaying B's landing URL in A must not give A a session.
await pageA.goto(returnUrl);
const replay = await who(pageA);
console.log({ contextAAfterReplay: replay });

const transferred = resultA !== 'signed out' || replay !== 'signed out';
console.log(
  transferred
    ? 'CONTEXT A HOLDS A SESSION IT NEVER AUTHENTICATED. Treat as a vulnerability.'
    : 'No transfer: A stayed signed out. Repeat with A completing its own sign-in.',
);

await ask.question('Press Enter to close. ');
ask.close();
await browser.close();
