/**
 * Short names for the programmes VTU's listing writes out in full.
 *
 * Authority: Phase 7D.2 §4
 *
 * ---------------------------------------------------------------------------
 * A CONVENIENCE FOR THE COMMAND LINE, AND NOTHING ELSE
 * ---------------------------------------------------------------------------
 *
 * VTU's scheme page labels the row "Computer Science & Business System". That
 * label is the canonical programme identifier: it is what gets stored, what
 * provenance cites, and what the catalogue is keyed by. Nothing here changes
 * any of that.
 *
 * What it changes is that `--programme CSBS` finds it. Before this table the
 * flag selected NOTHING for the programme this whole phase is about, and did
 * so silently — an empty selection looks exactly like a source with no
 * documents.
 *
 * ---------------------------------------------------------------------------
 * A TABLE, NOT A SIMILARITY FUNCTION (§14)
 * ---------------------------------------------------------------------------
 *
 * No edit distance, no initials, no substring scoring. Every entry is written
 * down because somebody checked the university's own listing, and an
 * unrecognised alias is an ERROR rather than a best guess: a fuzzy fallback
 * that quietly selects the wrong programme puts the wrong credits in a real
 * student's SGPA.
 *
 * A value that is not an alias is still usable directly — `--programme
 * "Business System"` matches the label as a substring, exactly as before. The
 * table is consulted only for names that ARE aliases, so it can never override
 * a caller who typed part of the official label.
 */

export interface ProgrammeAlias {
  /** The short name a person would type. Matched case-insensitively. */
  readonly alias: string;
  /** The label VTU's own listing prints, which stays the canonical identity. */
  readonly officialLabel: string;
}

/**
 * The aliases GradTools recognises.
 *
 * Deliberately short. An entry earns its place by being a name the university
 * itself uses in its documents — the CSBS scheme and syllabus PDFs are named
 * `38csbssch.pdf`, `2csbssyll.pdf` — not by being a plausible abbreviation.
 */
export const PROGRAMME_ALIASES: readonly ProgrammeAlias[] = [
  { alias: 'CSBS', officialLabel: 'Computer Science & Business System' },
];

/**
 * The label to select on, for a programme the caller named.
 *
 * Returns the official label for a known alias, and the caller's own text
 * otherwise — so a partial official label keeps working. `strict` makes an
 * unknown name that LOOKS like an alias an error instead: see `resolveProgramme`.
 */
export function officialLabelFor(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  return (
    PROGRAMME_ALIASES.find((entry) => entry.alias.toLowerCase() === wanted)?.officialLabel ?? null
  );
}

/**
 * What `--programme` should match against, or an explanation of why it cannot.
 *
 * A name is taken as an alias only on an EXACT match. Anything else is treated
 * as a fragment of the official label, which is how the flag already behaved —
 * unless it is a bare acronym, which cannot be a fragment of a label VTU
 * spells out, and is therefore a typed alias that does not exist.
 */
export function resolveProgramme(
  name: string,
): { readonly match: string } | { readonly error: string } {
  const official = officialLabelFor(name);
  if (official !== null) return { match: official };

  const trimmed = name.trim();
  if (trimmed === '') return { error: 'A programme name cannot be empty.' };

  /*
   * An all-capital word of two to six letters is an acronym, and VTU's listing
   * writes no programme that way — so it cannot be a fragment of a real label
   * and is certainly a misremembered alias. Saying so beats selecting nothing
   * and reporting a successful run over zero documents.
   */
  if (/^[A-Z]{2,6}$/.test(trimmed)) {
    const known = PROGRAMME_ALIASES.map((entry) => entry.alias).join(', ');
    return {
      error:
        `"${trimmed}" is not a programme alias GradTools knows. ` +
        `Known aliases: ${known === '' ? '(none)' : known}. ` +
        `Otherwise pass part of the label VTU's own listing prints, ` +
        `such as --programme "Business System".`,
    };
  }
  return { match: trimmed };
}
