import { describe, expect, it } from 'vitest';
import {
  buildResultCards,
  findVtuResultSession,
  vtuResultCards,
  vtuResultCatalog,
  type RawResultEntry,
} from '../src/index.js';
import raw from '../data/vtu-result-sessions.json' with { type: 'json' };

const entry = (over: Partial<RawResultEntry>): RawResultEntry => ({
  yearAsPrinted: '2026',
  session: 'May – June 2026 Exam',
  resultType: 'Regular',
  variant: 'CBCS',
  programme: null,
  url: 'https://results.vtu.ac.in/MJ26cbcs/index.php',
  labelAsPrinted: 'CBCS',
  note: null,
  ...over,
});

describe('result-session loader', () => {
  it('derives ids from the URL path', () => {
    const [card] = buildResultCards([
      entry({ url: 'https://results.vtu.ac.in/indexMJ26.php', variant: 'Main Page' }),
      entry({}),
    ]);
    expect(card!.sections[0]!.sessions.map((s) => s.id)).toEqual(['indexMJ26', 'MJ26cbcs']);
  });

  it('refuses a URL off results.vtu.ac.in', () => {
    expect(() =>
      buildResultCards([entry({ url: 'https://evil.example/MJ26cbcs/index.php' })]),
    ).toThrow();
    expect(() =>
      buildResultCards([entry({ url: 'http://results.vtu.ac.in/MJ26cbcs/index.php' })]),
    ).toThrow();
  });

  it('refuses duplicate ids and unknown result types', () => {
    expect(() => buildResultCards([entry({}), entry({})])).toThrow(/Duplicate/);
    expect(() => buildResultCards([entry({ resultType: 'Makeup' })])).toThrow(/Unknown/);
  });

  it('refuses a duplicate id even when the two URLs are spelled differently', () => {
    expect(() =>
      buildResultCards([
        entry({ url: 'https://results.vtu.ac.in/MJ26cbcs/index.php' }),
        entry({ session: 'Other', url: 'https://results.vtu.ac.in/MJ26cbcs.php' }),
      ]),
    ).toThrow(/Duplicate result session id "MJ26cbcs"/);
  });

  it('keeps a known anomaly and refuses an unknown one', () => {
    const [card] = buildResultCards([entry({ anomaly: 'label-url-mismatch' })]);
    expect(card!.sections[0]!.sessions[0]!.anomaly).toBe('label-url-mismatch');
    expect(buildResultCards([entry({})])[0]!.sections[0]!.sessions[0]!.anomaly).toBeNull();
    expect(() => buildResultCards([entry({ anomaly: 'typo' })])).toThrow(/Unknown anomaly/);
  });

  it('never merges two cards that are not adjacent, even with the same title', () => {
    const cards = buildResultCards([
      entry({ url: 'https://results.vtu.ac.in/A/index.php' }),
      entry({ session: 'Other', url: 'https://results.vtu.ac.in/B/index.php' }),
      entry({ url: 'https://results.vtu.ac.in/C/index.php' }),
    ]);
    expect(cards.map((c) => c.title)).toEqual([
      'May – June 2026 Exam',
      'Other',
      'May – June 2026 Exam',
    ]);
    expect(cards[2]!.sections[0]!.sessions[0]!.cardIndex).toBe(2);
  });

  it('keeps sections in first-appearance order and buttons in page order', () => {
    const [card] = buildResultCards([
      entry({ resultType: 'Revaluation', url: 'https://results.vtu.ac.in/R/index.php' }),
      entry({ url: 'https://results.vtu.ac.in/A/index.php' }),
      entry({
        url: 'https://results.vtu.ac.in/B/index.php',
        variant: null,
        labelAsPrinted: 'Link',
      }),
    ]);
    expect(card!.sections.map((s) => s.resultType)).toEqual(['Revaluation', 'Regular']);
    const regular = card!.sections[1]!.sessions;
    expect(regular.map((s) => [s.buttonIndex, s.label])).toEqual([
      [0, 'CBCS'],
      [1, 'Link'],
    ]);
  });
});

describe('the shipped result-session catalogue', () => {
  const catalog = vtuResultCatalog();
  const sessions = catalog.cards.flatMap((c) => c.sections.flatMap((s) => s.sessions));

  it('exposes every transcribed entry, in page order, on the official host', () => {
    expect(sessions.map((s) => s.url)).toEqual(raw.entries.map((e) => e.url));
    for (const s of sessions) expect(s.url.startsWith('https://results.vtu.ac.in/')).toBe(true);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(sessions.length);
  });

  it('carries provenance and no fields beyond the contract', () => {
    expect(catalog.source.url).toMatch(/^https:\/\//);
    expect(catalog.source.retrievedAt).not.toBe('');
    expect(Object.keys(sessions[0]!).sort()).toEqual(
      [
        'id',
        'url',
        'resultType',
        'variant',
        'label',
        'programme',
        'note',
        'anomaly',
        'cardTitle',
        'yearLabel',
        'sectionLabel',
        'buttonLabel',
        'cardIndex',
        'sectionIndex',
        'buttonIndex',
      ].sort(),
    );
  });

  /** What the label/section says versus what the URL path says. */
  const labelUrlProblems = (s: (typeof sessions)[number]): string[] => {
    const id = s.id.toLowerCase();
    const problems: string[] = [];
    if (s.variant === 'CBCS' && (!id.includes('cbcs') || id.includes('noncbcs')))
      problems.push('CBCS label without a cbcs path');
    if (s.variant === 'Non-CBCS' && !id.includes('noncbcs'))
      problems.push('Non-CBCS label without a noncbcs path');
    if (s.variant === 'Main Page' && !id.startsWith('index'))
      problems.push('Main Page label without an index path');
    if (id.includes('rv') !== (s.resultType === 'Revaluation'))
      problems.push('rv in the path disagrees with the Revaluation section');
    return problems;
  };

  it('every label agrees with its URL, except entries flagged as a source anomaly', () => {
    for (const s of sessions) {
      if (s.anomaly === null) expect([s.id, labelUrlProblems(s)]).toEqual([s.id, []]);
      else expect(labelUrlProblems(s).length).toBeGreaterThan(0);
    }
  });

  it('flags exactly one session: SplJcbcs25, printed as Non-CBCS', () => {
    const flagged = sessions.filter((s) => s.anomaly !== null);
    expect(flagged.map((s) => [s.id, s.anomaly, s.label])).toEqual([
      ['SplJcbcs25', 'label-url-mismatch', 'Non-CBCS'],
    ]);
  });

  it('finds a session by id, and nothing for an unknown one', () => {
    expect(findVtuResultSession('MJ26cbcs')?.card.title).toBe('May – June 2026 Exam');
    expect(findVtuResultSession('nope')).toBeNull();
    expect(vtuResultCards()).toBe(catalog.cards);
  });

  it('contains no control characters or mojibake', () => {
    const text = JSON.stringify(raw);
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f\u007f]|â€/.test(text)).toBe(false);
  });
});
