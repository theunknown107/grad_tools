# Technical SEO & AI-visibility checklist (conditional — not yet implemented)

Inspected 2026-10-10. **No SEO files are created by this document.** GradTools has
**no production domain** (`docs/25` lists production as "Future / Not yet defined"),
so indexing cannot be configured or validated yet. This records verified guidance
and the exact future steps + triggers.

## GradTools deployment facts (verified in-repo, 2026-10-10)

- **SPA on Vercel.** `vercel.json` rewrites **every** route to `/index.html`
  (`"source": "/(.*)" → "/index.html"`). Client-rendered; initial HTML is the app shell.
- **Auth-gated.** Only `/welcome` (LandingPage) is public; everything else is
  behind `OnboardingGate` (a logged-out visitor is redirected to `/sign-in`).
- **No SEO files / tags.** No `robots.txt`, `sitemap.xml`, or `llms.txt`;
  `index.html` has only `description` + `title` (no `og:`, `canonical`, or `robots`).
- **No production domain** anywhere in the repo.

## Verified source facts (Google Search Central, read 2026-10-10)

- **robots.txt is NOT an index-blocker.** Google: it is *"not a mechanism for
  keeping a web page out of Google"*; a disallowed URL can still be indexed if
  linked elsewhere. To keep a page out of the index, use **`noindex`**,
  password-protection, or removal.
  ([robots intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro))
- **SPA handling:** Google crawls → renders (headless Chromium runs the JS) →
  indexes the **rendered** HTML. App-shell pages risk empty initial HTML;
  server/pre-render is "still a great idea." Links must be real `<a href>`.
  Canonical is best set in HTML, one per page. For client-routed 404s, redirect
  to a real-404 URL or add a `noindex` meta (note: Google may skip JS execution
  when it sees `noindex`). Avoid serving an identical shell for distinct content;
  use unique canonicals.
  ([JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics))
- **`llms.txt`:** an **informal convention, not a Google requirement.** Google
  Search does not use it (John Mueller, Jan 2026: *"to be direct, no"* — per
  third-party reporting, not a Google Search Central page). Chrome Lighthouse
  added an `llms.txt` audit (agentic-browsing category, 2026) — a dev-tools
  signal, **not** a ranking/indexing signal. **Adding `llms.txt` does not
  guarantee indexing, ranking, or AI visibility.**

## The GradTools-specific risk (when a domain goes live)

Because the SPA rewrite returns a **200 app-shell for every path**, a crawler
hitting `/results/5`, `/attendance`, `/import`, etc. gets the same shell. For a
logged-out crawler the gate renders the sign-in/landing content, so these would
be **duplicate/soft-404-like** URLs. robots.txt disallow alone won't keep them
out of the index (verified above). The exclusion mechanism is `noindex` on the
rendered output of non-public routes.

## Conditional implementation checklist (do when a public domain exists)

> Trigger: a real production domain is provisioned and `docs/25` production row is defined.

**Public surface (index these):**
- [ ] `/welcome` only (and arguably `/sign-in`). Confirm what is intended public.
- [ ] Landing page: accurate `<title>`, `description`, **one** `rel="canonical"`
  (absolute, in the served HTML), and `og:`/`twitter:` tags for sharing.

**Private surface (keep OUT of the index):**
- [ ] Add `noindex` to the rendered output of all gated routes (app shell when not
  on a public route) — **not** robots.txt alone. Verify with URL Inspection.
- [ ] Never expose student data, API endpoints (`/api/*`), test fixtures, or
  preview/dev deployments to indexing (Vercel preview URLs should carry `noindex`).

**robots.txt (crawl management, not exclusion):**
- [ ] `robots.txt` at the domain root: `Allow: /welcome`, `Disallow:` the API and
  app routes to save crawl budget — understanding it does not prevent indexing.

**sitemap.xml:**
- [ ] Only if there is more than one indexable public page; list canonical public
  URLs. A single landing page does not need a sitemap.

**Transport / correctness:**
- [ ] HTTPS enforced (Vercel default); canonical host (www vs apex) chosen and the
  other 301-redirected; no mixed content.

**Search Console (requires the owner — manual):**
- [ ] Owner verifies the property (DNS TXT record **or** the HTML-file/meta method).
  DNS verification needs **your** registrar/DNS access — I cannot do this.
- [ ] After verification: submit the sitemap (if any); use URL Inspection to
  confirm `/welcome` is indexed and gated routes are **not**.

**`llms.txt` (optional, experimental):**
- [ ] Only if a public documentation/content corpus ever exists. Document its
  experimental status; do not expect indexing/ranking benefit.

## Status

Documentation only. No `robots.txt`, `sitemap.xml`, `llms.txt`, canonical tags, or
metadata were added. Revisit when a production domain is defined.
