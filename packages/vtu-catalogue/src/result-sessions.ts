/**
 * VTU result sessions: which official results.vtu.ac.in page belongs to which
 * exam session.
 *
 * The data is a one-time, human-reviewable transcription of a public index page
 * (see `data/vtu-result-sessions.json` and the package README). Nothing here
 * fetches anything. URLs are taken as printed and never built from a pattern.
 */
import raw from '../data/vtu-result-sessions.json' with { type: 'json' };

export type VtuResultType = 'Regular' | 'Revaluation';

export interface VtuResultSession {
  /** The URL path, e.g. 'MJ26cbcs' (…/MJ26cbcs/index.php) or 'indexMJ26' (…/indexMJ26.php). */
  readonly id: string;
  readonly url: string;
  readonly resultType: VtuResultType;
  readonly variant: string | null;
  /** `variant ?? labelAsPrinted`. */
  readonly label: string;
  readonly programme: 'UG' | 'PG' | null;
  readonly note: string | null;
  /* Archive card structure, in page order. */
  readonly cardTitle: string;
  readonly yearLabel: string | null;
  readonly sectionLabel: string;
  readonly buttonLabel: string;
  readonly cardIndex: number;
  readonly sectionIndex: number;
  readonly buttonIndex: number;
}

export interface VtuResultSection {
  readonly label: string;
  readonly resultType: VtuResultType;
  readonly sessions: readonly VtuResultSession[];
}

export interface VtuResultCard {
  /** The session heading as printed. */
  readonly title: string;
  readonly yearLabel: string | null;
  readonly sections: readonly VtuResultSection[];
}

export interface VtuResultCatalog {
  readonly source: {
    readonly name: string;
    readonly url: string;
    readonly pageUpdated: string | null;
    readonly retrievedAt: string;
    readonly method: string;
  };
  readonly cards: readonly VtuResultCard[];
}

export interface RawResultEntry {
  readonly yearAsPrinted: string | null;
  readonly session: string;
  readonly resultType: string;
  readonly variant: string | null;
  readonly programme: string | null;
  readonly url: string;
  readonly labelAsPrinted: string;
  readonly note: string | null;
}

const HOST = 'https://results.vtu.ac.in/';

/** 'https://results.vtu.ac.in/MJ26cbcs/index.php' -> 'MJ26cbcs'; '…/indexMJ26.php' -> 'indexMJ26'. */
function idOf(url: string): string {
  const path = url
    .slice(HOST.length)
    .replace(/\/index\.php$/, '')
    .replace(/\.php$/, '');
  if (path === '' || path.includes('/')) throw new Error(`Cannot derive an id from ${url}`);
  return path;
}

/**
 * Groups page-ordered entries into cards. A card is a CONTIGUOUS run with the
 * same heading and year label: two cards that merely look alike are never
 * merged. Throws on any entry that fails validation, so bad data cannot ship.
 */
export function buildResultCards(entries: readonly RawResultEntry[]): VtuResultCard[] {
  const ids = new Set<string>();
  const cards: { title: string; yearLabel: string | null; sections: VtuResultSection[] }[] = [];

  for (const entry of entries) {
    if (typeof entry.url !== 'string' || !entry.url.startsWith(HOST)) {
      throw new Error(`Result URL is not on ${HOST}: ${String(entry.url)}`);
    }
    if (entry.resultType !== 'Regular' && entry.resultType !== 'Revaluation') {
      throw new Error(`Unknown result type "${entry.resultType}" for ${entry.url}`);
    }
    const id = idOf(entry.url);
    if (ids.has(id)) throw new Error(`Duplicate result session id "${id}"`);
    ids.add(id);

    let card = cards.at(-1);
    if (card?.title !== entry.session || card.yearLabel !== entry.yearAsPrinted) {
      card = { title: entry.session, yearLabel: entry.yearAsPrinted, sections: [] };
      cards.push(card);
    }
    let sectionIndex = card.sections.findIndex((s) => s.resultType === entry.resultType);
    if (sectionIndex === -1) {
      sectionIndex = card.sections.length;
      card.sections.push({ label: entry.resultType, resultType: entry.resultType, sessions: [] });
    }
    const section = card.sections[sectionIndex]!;
    (section.sessions as VtuResultSession[]).push({
      id,
      url: entry.url,
      resultType: entry.resultType,
      variant: entry.variant,
      label: entry.variant ?? entry.labelAsPrinted,
      programme: entry.programme === 'UG' || entry.programme === 'PG' ? entry.programme : null,
      note: entry.note,
      cardTitle: card.title,
      yearLabel: card.yearLabel,
      sectionLabel: section.label,
      buttonLabel: entry.labelAsPrinted,
      cardIndex: cards.length - 1,
      sectionIndex,
      buttonIndex: section.sessions.length,
    });
  }
  return cards;
}

let cached: VtuResultCatalog | undefined;

export function vtuResultCatalog(): VtuResultCatalog {
  cached ??= {
    source: {
      name: raw.source.name,
      url: raw.source.url,
      pageUpdated: raw.source.pageUpdated,
      retrievedAt: raw.source.retrievedAt,
      method: raw.source.method,
    },
    cards: buildResultCards(raw.entries as readonly RawResultEntry[]),
  };
  return cached;
}

export function vtuResultCards(): readonly VtuResultCard[] {
  return vtuResultCatalog().cards;
}

export function findVtuResultSession(
  id: string,
): { card: VtuResultCard; session: VtuResultSession } | null {
  for (const card of vtuResultCatalog().cards) {
    for (const section of card.sections) {
      const session = section.sessions.find((s) => s.id === id);
      if (session) return { card, session };
    }
  }
  return null;
}
