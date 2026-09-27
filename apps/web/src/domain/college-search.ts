/**
 * Finding a college by what a student actually types.
 *
 * VTU's own list prints names the way a register does — "S G BALEKUNDRI INST.
 * OF TECH", "C.M.R INSTITUTE OF TECHNOLOGY" — so a student typing "SG",
 * "cmr" or "balekundri" has to find them. Matching is deterministic and ranked,
 * never fuzzy: with 185 colleges, a scored guess would put the wrong one first
 * more often than it would rescue a typo, and a wrong college is saved into
 * the profile.
 *
 * Rank, best first:
 *   0  the whole name, exactly
 *   1  the name with spaces and punctuation removed starts with the query
 *      ("sg" → S G BALEKUNDRI…, "cmr" → C.M.R …)
 *   2  the college's VTU code, exactly — below a name match, because "SG" is
 *      both Sapthagiri's code and S G Balekundri's initials, and a student
 *      types a name far more often than a code
 *   3  every query word starts a word of the name ("bal inst" → …BALEKUNDRI INST.…)
 *   4  the query appears anywhere in the name
 * Ties keep the list's own (alphabetical) order.
 */

export interface SearchableCollege {
  readonly name: string;
  readonly code: string | null;
}

/** Lower case, punctuation to spaces, runs of space collapsed. */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = (text: string): string => text.replace(/ /g, '');

function rank(college: SearchableCollege, query: string): number | null {
  const name = normalizeName(college.name);
  const words = name.split(' ');
  const wanted = query.split(' ');
  if (name === query) return 0;
  if (compact(name).startsWith(compact(query))) return 1;
  if (college.code !== null && normalizeName(college.code) === query) return 2;
  if (wanted.every((part) => words.some((word) => word.startsWith(part)))) return 3;
  if (name.includes(query) || compact(name).includes(compact(query))) return 4;
  return null;
}

/** Matching colleges, best first. An empty query returns the list unchanged. */
export function searchColleges<T extends SearchableCollege>(
  colleges: readonly T[],
  query: string,
): T[] {
  const wanted = normalizeName(query);
  if (wanted === '') return [...colleges];
  return colleges
    .map((college, order) => ({ college, order, rank: rank(college, wanted) }))
    .filter((entry): entry is typeof entry & { rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.college);
}
