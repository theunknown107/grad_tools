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

/**
 * A header row, which is how the listing says what its columns are.
 *
 * Every table on the official page opens with one, and the programme column is
 * found through it rather than guessed from the body rows — so a fixture
 * without a header is a different case, not a shorthand for this one.
 */
const header = (...cells: string[]) =>
  `<tr>${cells.map((cell) => `<th>${cell}</th>`).join('')}</tr>`;

/** The header the official 3-8 semester table prints. */
const PROGRAMME_HEADER = header(
  'Sl. No',
  'Program Title',
  'Scheme',
  '1st yr Syllabus',
  '2nd yr Syllabus',
);

const page = (...rows: string[]) =>
  `<html><body><table>${PROGRAMME_HEADER}${rows.join('')}</table></body></html>`;

/** A page whose table says nothing about its columns. */
const unheadedPage = (...rows: string[]) =>
  `<html><body><table>${rows.join('')}</table></body></html>`;

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

  /* ------------------------------------------------------------------ */
  /* Which column names the row                                         */
  /* ------------------------------------------------------------------ */

  it('never reads the serial column as a programme, letter suffix and all', () => {
    /*
     * THE `21a` DEFECT. VTU numbers some rows 21a and 29a, so a rule that
     * skipped a serial by testing for digits alone took the serial itself as
     * the programme — and `21a` then carried a duplicate of the entire
     * Computer Science scheme under a programme that does not exist.
     */
    const html = page(
      row('21a', 'Computer Science', link('/pdf/2022_3to8/38cssch.pdf', '3-8 Sem Scheme')),
      row('29a', 'Electronics Communication', link('/pdf/2022_3to8/actsch.pdf', 'Scheme')),
    );
    expect(describeAll(html).map((d) => d.programme)).toEqual([
      'Computer Science',
      'Electronics Communication',
    ]);
  });

  it('reads a programme whose cell also carries an annotation link', () => {
    /*
     * THE 60-UNKNOWN DEFECT. VTU hangs a circular off the programme name —
     * `Computer Science &amp; Engineering<br><a>Code correction 21SM72
     * circular</a>` — and a rule that skipped any cell containing `.pdf`
     * skipped the whole row. `38csesch.pdf` is Computer Science &
     * Engineering's own scheme, 91 courses, and it was stored as though it
     * applied to every student in the university.
     */
    const html = page(
      row(
        '6',
        `Computer Science &amp; Engineering<br>${link('https://vtu.ac.in/wp-content/uploads/2024/11/3597-Typo.pdf', 'Code correction 21SM72 circular')}`,
        link('/pdf/2022_3to8/38csesch.pdf', '3- 8 Sem Scheme'),
      ),
    );
    const scheme = describeAll(html).find((d) => d.url.endsWith('38csesch.pdf'));
    expect(scheme).toMatchObject({
      programme: 'Computer Science & Engineering',
      common: false,
      streamLabel: null,
    });
  });

  it('keeps a name that merely WRAPS across lines whole', () => {
    /* `<br>` is not the divider: the same page sets one name over three lines. */
    const html = page(
      row(
        '1',
        'Bachelor of<br />Business<br />Administration',
        link('/pdf/2022syll/x.pdf', 'Scheme'),
      ),
    );
    expect(describeAll(html)[0]?.programme).toBe('Bachelor of Business Administration');
  });

  it('gives every document in one row the same programme', () => {
    const html = page(
      row(
        '12',
        'Computer Science &amp; Business System',
        link('/pdf/2022_3to8/38csbssch.pdf', '3-8 Sem Scheme'),
        link('/pdf/2022_3to8/2csbssyll.pdf', '3-4 Syllabus'),
        link('/pdf/2022_3to8/3csbssyll.pdf', '5- Syllabus'),
      ),
    );
    const found = describeAll(html);
    expect(found).toHaveLength(3);
    expect(new Set(found.map((d) => d.programme))).toEqual(
      new Set(['Computer Science & Business System']),
    );
  });

  it('does not read a COURSE row as a programme', () => {
    /*
     * The listing mixes per-course tables in among the programme tables. There
     * is no degree called "Principles of Programming Using C", and reading one
     * invented a hundred of them. The course code at the start of the label is
     * the evidence — and it is read in either case, because VTU prints both
     * `BETCK105I` and `BETCK105l`.
     */
    const html = `<html><body><table>${header('Sl. No', 'Course Code', 'Course Name', 'Syllabus')}${row('3', 'BPOPS103/203 Principles of Programming Using C', link('/pdf/2022syll/BPOPS103.pdf', 'Syllabus'))}</table></body></html>`;
    expect(describeAll(html)[0]).toMatchObject({ programme: null, streamLabel: null });
  });

  it('still reads the STREAM a first-year course names', () => {
    /*
     * The other half of the same rule. "BMATS101 Mathematics for CSE Stream-I"
     * is a course and not a programme, and it does say whose first year it
     * belongs to — which is what keeps the Civil and CSE first years from
     * sharing one identity.
     */
    const html = `<html><body><table>${header('Sl. No', 'Course Code', 'Course Name', 'Syllabus')}${row('1', 'BMATS101 Mathematics for CSE Stream-I', link('/pdf/2022syll/BMATS101.pdf', 'Syllabus'))}</table></body></html>`;
    expect(describeAll(html)[0]).toMatchObject({
      programme: null,
      common: true,
      streamLabel: 'BMATS101 Mathematics for CSE Stream-I',
    });
  });

  it('leaves a row unplaced when its table names no column at all', () => {
    /*
     * §7: unknown beats fabricated. A table that does not say what its rows
     * are is not made to say it — the answer is recorded as missing, and the
     * document is still discovered.
     */
    const html = unheadedPage(row('1', 'Something', link('/pdf/2022syll/x.pdf', 'Scheme')));
    const [doc] = describeAll(html);
    expect(doc?.programme).toBeNull();
    expect(doc?.url).toContain('x.pdf');
  });

  it('lets each table on the page keep its own columns', () => {
    /* One page carries seventeen tables and they do not agree. */
    const html =
      `<html><body><table>${header('Sl. No', 'Program Title', 'Scheme')}${row('1', 'A Programme', link('/pdf/2022syll/a.pdf', 'Scheme'))}</table>` +
      `<table>${header('Sl. No', 'Course Code', 'Course Name', 'Syllabus')}${row('1', 'BPOPS103 Principles of Programming Using C', link('/pdf/2022syll/b.pdf', 'Syllabus'))}</table></body></html>`;
    const found = describeAll(html);
    expect(found.find((d) => d.url.endsWith('a.pdf'))?.programme).toBe('A Programme');
    expect(found.find((d) => d.url.endsWith('b.pdf'))?.programme).toBeNull();
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

describe('the listing section a link sits under', () => {
  /*
   * -------------------------------------------------------------------------
   * MEASURED ON THE REAL PAGE, REPRODUCED AS SHAPE
   * -------------------------------------------------------------------------
   *
   * The official listing groups its documents under headings and anchors those
   * headings as `#menu11`, `#menu12`, `#menu13`. Running the reader over the
   * real saved page found the defect these fixtures pin down:
   *
   *   #menu11  "UG Engineering Scheme and Syllabus 2025 (1st & 2nd semesters)"
   *            87 links, filed under /pdf/UG2024/ — a path naming 2024
   *
   * Seventy-seven of those links stated no year in their own text either, so
   * the reader produced `schemeYear: null` for eighty-six of eighty-seven and
   * `--scheme 2025` selected NONE of them. Silently: a section whose documents
   * all fail the year filter looks exactly like a section with no documents.
   *
   * The markup below is written here, in the shapes the page uses. The years,
   * paths and heading wording are the real ones because they are the evidence;
   * the course codes and programme names are invented.
   */

  const heading = (title: string) =>
    `<div class="row zmodeltitle"><div class="col-md-12 mqtitle">${title}</div></div>`;
  const section = (anchor: string, title: string, ...body: string[]) =>
    `<div id="${anchor}" class="vc_row wpb_row vc_row-fluid">${heading(title)}` +
    `<table>${PROGRAMME_HEADER}${body.join('')}</table></div>`;

  it('takes the year from the heading when the link and its path do not state one', () => {
    /*
     * THE CASE THAT WAS LOSING 87 DOCUMENTS. The path says UG2024 and the link
     * says only "Scheme"; the heading is the only thing on the page that says
     * which scheme these belong to.
     */
    const html = section(
      'menu11',
      'UG Engineering Scheme and Syllabus 2025 (1st &amp; 2nd semesters)',
      row('1', 'Invented Cycle', link('/pdf/UG2024/qqcyc.pdf', 'Scheme')),
    );
    const [doc] = vtuSchemeAdapter.describe(vtuSchemeAdapter.parse(html), html);

    expect(doc?.schemeYear).toBe('2025');
    expect(doc?.section).toEqual({
      anchor: 'menu11',
      title: 'UG Engineering Scheme and Syllabus 2025 (1st & 2nd semesters)',
    });
  });

  it('never overrides a year the document itself states', () => {
    /*
     * The fallback fills a null and does nothing else. A 2022 document listed
     * under a 2025 heading stays 2022 — which is not hypothetical, since the
     * page keeps every scheme year it has ever published on one page.
     */
    const html = section(
      'menu12',
      'UG 3rd to 8th semesters Scheme and Syllabus (2025)(Engg)',
      row('1', 'Invented Programme', link('/pdf/2022_3to8/qqsch.pdf', 'Scheme')),
    );
    const [doc] = vtuSchemeAdapter.describe(vtuSchemeAdapter.parse(html), html);
    expect(doc?.schemeYear).toBe('2022');
  });

  it('establishes no year from a heading that names several', () => {
    /*
     * The listing carries "2002 2006 2010 2014 2015 2017 and 2018 scheme
     * Common Syllabus for MATDip courses". Taking the first year would file
     * every document under it as 2002. Several is not one (§7).
     */
    const html = section(
      'menu10',
      '2002 2006 2010 2014 2015 2017 and 2018 scheme Common Syllabus for MATDip courses',
      row('1', 'Invented Course', link('/pdf/matdip/qq.pdf', 'Syllabus')),
    );
    const [doc] = vtuSchemeAdapter.describe(vtuSchemeAdapter.parse(html), html);
    expect(doc?.schemeYear).toBeNull();
  });

  it('lets one anchor hold several headings, each governing its own links', () => {
    /*
     * `#menu07` on the real page carries the 2022 first-year listing, the 2022
     * 3-to-8 listing and the 2022 common-course listing. The heading is the
     * unit, not the wrapper — so a reader keyed on the anchor would give all
     * three the same semester scope.
     */
    const html =
      `<div id="menu07" class="vc_row wpb_row vc_row-fluid">` +
      heading('UG Scheme and Syllabus (I&amp;II semesters) (2022 Scheme)') +
      `<table>${PROGRAMME_HEADER}${row('1', 'Invented Stream', link('/pdf/qq/a.pdf', 'Scheme'))}</table>` +
      heading('UG Scheme and Syllabus 3rd to 8th Semester (2022 Scheme)') +
      `<table>${PROGRAMME_HEADER}${row('2', 'Invented Programme', link('/pdf/qq/b.pdf', 'Scheme'))}</table>` +
      `</div>`;
    const docs = vtuSchemeAdapter.describe(vtuSchemeAdapter.parse(html), html);

    expect(docs.map((doc) => doc.section?.title)).toEqual([
      'UG Scheme and Syllabus (I&II semesters) (2022 Scheme)',
      'UG Scheme and Syllabus 3rd to 8th Semester (2022 Scheme)',
    ]);
    expect(docs[1]?.semesters).toEqual([3, 8]);
  });

  it('reports no section to a caller that does not hand over the page', () => {
    /* The second argument is optional, so every existing caller is unchanged. */
    const html = section(
      'menu11',
      'UG Engineering Scheme and Syllabus 2025 (1st &amp; 2nd semesters)',
      row('1', 'Invented Cycle', link('/pdf/UG2024/qqcyc.pdf', 'Scheme')),
    );
    const [doc] = vtuSchemeAdapter.describe(vtuSchemeAdapter.parse(html));
    expect(doc?.section).toBeNull();
    expect(doc?.schemeYear).toBeNull();
  });
});
