/**
 * Discovering VTU's scheme and syllabus document graph.
 *
 * Authority: Phase 7C.2 §14–§19, §36, §52
 *
 * ---------------------------------------------------------------------------
 * NO NETWORK
 * ---------------------------------------------------------------------------
 *
 * Every fixture below is markup written here, in the shape the official page
 * uses. §52 is explicit that the ordinary suite must not depend on the
 * internet, and a discovery test that fetched the real page would fail on a
 * train and pass in an office for reasons that have nothing to do with the
 * code.
 *
 * The shapes ARE the real ones: a numbered table whose second cell names the
 * programme and whose later cells hold the links, which is what the official
 * listing turned out to be.
 */

import { describe, expect, it } from 'vitest';
import { vtuSchemeAdapter } from '../src/sources/vtu-scheme.js';

const link = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

const row = (serial: string, programme: string, ...cells: string[]) =>
  `<tr class="row-1 odd"><td class="column-1">${serial}</td><td class="column-2">${programme}</td>${cells
    .map((cell, index) => `<td class="column-${String(index + 3)}">${cell}</td>`)
    .join('')}</tr>`;

const page = (...rows: string[]) => `<html><body><table>${rows.join('')}</table></body></html>`;

const describeAll = (html: string) => vtuSchemeAdapter.describe(vtuSchemeAdapter.parse(html));

describe('reading the official listing', () => {
  it('takes the programme from the ROW, not from the link', () => {
    /*
     * THE DEFECT THIS EXISTS FOR. A link reads only "3-8 Sem Scheme" and says
     * nothing about whose scheme it is — the programme is the row's second
     * cell. Reading anchors alone produced 244 "programmes" that were mostly
     * fragments of link text, and found nothing when asked for CSBS.
     */
    const html = page(
      row(
        '12',
        'Computer Science &amp; Business System',
        link('https://vtu.ac.in/pdf/2022_3to8/38csbssch.pdf', '3-8 Sem Scheme'),
        link('https://vtu.ac.in/pdf/2022_3to8/2csbssyll.pdf', '3-4 Syllabus'),
      ),
    );

    const [scheme, syllabus] = describeAll(html);
    expect(scheme).toMatchObject({
      programme: 'Computer Science & Business System',
      kind: 'scheme',
      schemeYear: '2022',
      semesters: [3, 8],
    });
    expect(syllabus).toMatchObject({ kind: 'syllabus', semesters: [3, 4] });
  });

  it('reads the scheme year from the URL when the link text omits it', () => {
    const html = page(row('1', 'Some Programme', link('/pdf/2022syll/csesch.pdf', 'Scheme')));
    expect(describeAll(html)[0]?.schemeYear).toBe('2022');
  });

  it('does not confuse one scheme year with another', () => {
    const html = page(
      row('1', 'A Programme', link('/pdf/2022_3to8/a.pdf', 'Scheme')),
      row('2', 'A Programme', link('/pdf/2025syll3to8/b.pdf', 'Scheme')),
    );
    expect(describeAll(html).map((d) => d.schemeYear)).toEqual(['2022', '2025']);
  });

  it('marks a stream-wide document common, and gives it no programme', () => {
    /*
     * §17, §18. "CSE Stream Scheme (CSE/ISC/BT)" serves every programme in the
     * stream, so attributing it to one would be wrong — and CSBS, which is not
     * even named in that parenthesis, depends on it.
     */
    const html = page(
      row('2', 'CSE Stream Scheme (CSE/ISC/BT)', link('/pdf/2022syll/csesch.pdf', 'Scheme')),
    );
    expect(describeAll(html)[0]).toMatchObject({ common: true, programme: null });
  });

  it('counts one document once, however many times it is linked', () => {
    const html = page(
      row('1', 'A Programme', link('/pdf/2022syll/x.pdf', 'Scheme')),
      row('2', 'A Programme', link('/pdf/2022syll/x.pdf', 'Scheme again')),
    );
    expect(describeAll(html)).toHaveLength(1);
  });

  it('discovers a document it cannot classify rather than dropping it', () => {
    /*
     * §36: the report accounts for everything. A document nobody can classify
     * is the extractor's problem; hiding it here would keep it out of the one
     * place that is supposed to name it.
     */
    const html = page(row('1', 'A Programme', link('/pdf/2022syll/714csbs.pdf', 'Annexure')));
    const [doc] = describeAll(html);
    expect(doc?.kind).toBe('unclassified');
    expect(doc?.url).toContain('714csbs.pdf');
  });

  it('refuses a link that is not a VTU document', () => {
    const html = page(row('1', 'A Programme', link('https://example.com/other.pdf', 'Scheme')));
    const verdict = vtuSchemeAdapter.validate(
      vtuSchemeAdapter.normalize(vtuSchemeAdapter.parse(html)),
    );
    expect(verdict.valid).toHaveLength(0);
    expect(verdict.rejected[0]?.reason).toMatch(/not a vtu\.ac\.in document/i);
  });

  it('is pure — parsing never needs the network', () => {
    // The contract `SourceAdapter` states, asserted rather than assumed: the
    // same bytes give the same answer, with no I/O in between.
    const html = page(row('1', 'A Programme', link('/pdf/2022syll/x.pdf', 'Scheme')));
    expect(describeAll(html)).toEqual(describeAll(html));
  });

  it('gives the same payload hash for the same document across runs', () => {
    const html = page(row('1', 'A Programme', link('/pdf/2022syll/x.pdf', 'Scheme')));
    const once = vtuSchemeAdapter.normalize(vtuSchemeAdapter.parse(html));
    const twice = vtuSchemeAdapter.normalize(vtuSchemeAdapter.parse(html));
    expect(once[0]?.payloadHash).toBe(twice[0]?.payloadHash);
    expect(once[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
