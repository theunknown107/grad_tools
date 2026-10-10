/**
 * Regenerates the synthetic Office/ODF fixtures used by office-extract.test.ts.
 *
 * Run from the repo root: `node apps/web/test/fixtures/office/make-fixtures.mjs`
 *
 * The content is wholly invented — no real student name, USN, email or mark. The
 * USN "1XX22CS001" is deliberately not a valid seat number. Every fixture carries
 * the SAME logical result card (preamble, a six-column header, three subject rows,
 * a legend) so the test can assert semantic parity across formats.
 *
 * DOCX/ODT/RTF are produced by officeParser's own generator (run through its Node
 * build here). XLSX is minimal OOXML; ODS/ODP/ODG are minimal ODF; PPTX is minimal
 * OOXML — all hand-authored and zipped with fflate, because officeParser generates
 * none of those. No binary XML is committed except the fixtures this script writes.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOffice } from 'officeparser';
import { zipSync, strToU8 } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const write = (name, bytes) => {
  const buf = bytes instanceof Uint8Array ? Buffer.from(bytes) : Buffer.from(String(bytes));
  writeFileSync(join(here, name), buf);
  console.log(name.padEnd(20), buf.length, 'bytes');
};

const PREAMBLE = ['University Seat Number : 1XX22CS001', 'Semester : 4'];
const HEADER = [
  'Subject Code',
  'Subject Name',
  'Internal Marks',
  'External Marks',
  'Total',
  'Result',
];
const ROWS = [
  ['BQAS401', 'ENGINEERING MATHEMATICS', '44', '36', '80', 'P'],
  ['BQCS402', 'DATA STRUCTURES', '40', '38', '78', 'P'],
  ['BQCS403', 'OPERATING SYSTEMS', '42', '35', '77', 'P'],
];
const LEGEND = 'P -> PASS, F -> FAIL, A -> ABSENT';

const RESULT_MD = `# Provisional Results

${PREAMBLE.join('\n\n')}

| ${HEADER.join(' | ')} |
|${HEADER.map(() => '---').join('|')}|
${ROWS.map((r) => `| ${r.join(' | ')} |`).join('\n')}

${LEGEND}
`;

async function fromMd(format, outName) {
  const ast = await parseOffice(Buffer.from(RESULT_MD), { fileType: 'md' });
  write(outName, (await ast.to(format)).value);
}

/* ------------------------------- OOXML XLSX ------------------------------- */
function buildXlsx(outName) {
  const col = (n) => {
    let s = '';
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const grid = [...PREAMBLE.map((p) => [p]), HEADER, ...ROWS, [LEGEND]];
  const sheetData = grid
    .map((cells, r) => {
      const cs = cells
        .map(
          (v, c) =>
            `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${v}</t></is></c>`,
        )
        .join('');
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join('');
  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
  };
  write(
    outName,
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))),
  );
}

/* -------------------------------- ODF family ------------------------------ */
function buildOdf(outName, mime, bodyInner) {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>${bodyInner}</office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  // The mimetype part must be stored uncompressed, which {level:0} does.
  write(
    outName,
    zipSync({
      mimetype: [strToU8(mime), { level: 0 }],
      'META-INF/manifest.xml': strToU8(manifest),
      'content.xml': strToU8(content),
    }),
  );
}

const p = (t) => `<text:p>${t}</text:p>`;
const LINES = [...PREAMBLE, HEADER.join(' '), ...ROWS.map((r) => r.join(' ')), LEGEND];

function odsBody() {
  const grid = [...PREAMBLE.map((x) => [x]), HEADER, ...ROWS, [LEGEND]];
  const rows = grid
    .map(
      (cells) =>
        `<table:table-row>${cells.map((c) => `<table:table-cell><text:p>${c}</text:p></table:table-cell>`).join('')}</table:table-row>`,
    )
    .join('');
  return `<office:spreadsheet><table:table table:name="Results">${rows}</table:table></office:spreadsheet>`;
}

/* --------------------------------- PPTX ----------------------------------- */
function buildPptx(outName) {
  const sp = (t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
  const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/>${LINES.map(sp).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide,
  };
  write(
    outName,
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))),
  );
}

await fromMd('docx', 'result-card.docx');
await fromMd('odt', 'result-card.odt');
await fromMd('rtf', 'result-card.rtf');
buildXlsx('result-card.xlsx');
buildOdf('result-card.ods', 'application/vnd.oasis.opendocument.spreadsheet', odsBody());
buildOdf(
  'result-card.odp',
  'application/vnd.oasis.opendocument.presentation',
  `<office:presentation><draw:page draw:name="p1">${LINES.map(p).join('')}</draw:page></office:presentation>`,
);
buildOdf(
  'result-card.odg',
  'application/vnd.oasis.opendocument.graphics',
  `<office:drawing><draw:page draw:name="p1">${LINES.map(p).join('')}</draw:page></office:drawing>`,
);
buildPptx('result-card.pptx');
console.log('done');
