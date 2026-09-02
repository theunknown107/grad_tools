/**
 * Every internal link points at a route that exists.
 *
 * Authority: docs/22 §22.35 (M9.6F)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS
 * ---------------------------------------------------------------------------
 *
 * M9.6B introduced a destination list for the global search and another for the
 * public footer, both written from memory rather than from the route table.
 * Two of them were wrong: `/degree` and `/gpa` do not exist — the real routes
 * are `/semesters` and `/academics` — so "My degree" and "SGPA & CGPA" landed
 * a student on the not-found page from both the search modal and the footer.
 *
 * Nothing caught it. Type checking cannot: a route is a string. The browser
 * sweep cannot: it visits routes directly rather than following links. Unit
 * tests did not, because each component was tested against its own list.
 *
 * So this compares the two hand-written lists against the ROUTE TABLE itself.
 * It is a cheap test for a whole class of defect that is invisible until a
 * person clicks something.
 */

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relative: string): string {
  const path = [relative, `apps/web/${relative}`]
    .map((candidate) => resolve(process.cwd(), candidate))
    .find((candidate) => existsSync(candidate));
  if (path === undefined) throw new Error(`not found from ${process.cwd()}: ${relative}`);
  return readFileSync(path, 'utf8');
}

/** Every `path="/..."` declared in the route table. */
function declaredRoutes(): ReadonlySet<string> {
  const source = read('src/App.tsx');
  const found = new Set<string>();
  for (const match of source.matchAll(/path="([^"]+)"/g)) {
    const path = match[1] as string;
    // `*` is the catch-all and `:id` segments are dynamic; neither is a
    // literal destination anything should hard-code.
    if (path === '*' || path.includes(':')) continue;
    found.add(path);
  }
  return found;
}

/** Every `to: '/…'` a module hard-codes as a navigation target. */
function linkedRoutes(relative: string): readonly string[] {
  const source = read(relative);
  return [...source.matchAll(/to:\s*'(\/[^']*)'/g)].map((match) => match[1] as string);
}

describe('internal links resolve to real routes', () => {
  const routes = declaredRoutes();

  it('finds the route table', () => {
    expect(routes.has('/')).toBe(true);
    expect(routes.size).toBeGreaterThan(10);
  });

  it.each([
    ['the global search', 'src/components/GlobalSearch.tsx'],
    ['the public footer', 'src/features/landing/LandingPage.tsx'],
  ])('%s links only to declared routes', (_label, file) => {
    const links = linkedRoutes(file);
    expect(links.length).toBeGreaterThan(0);

    const dead = links.filter((link) => !routes.has(link));
    // Named rather than counted: a failure should say WHICH link is broken.
    expect(dead).toEqual([]);
  });

  it('rejects the two routes that were actually wrong', () => {
    // Regression pins: these were shipped and reached the not-found page.
    expect(routes.has('/degree')).toBe(false);
    expect(routes.has('/gpa')).toBe(false);
    expect(routes.has('/semesters')).toBe(true);
    expect(routes.has('/academics')).toBe(true);
  });
});
