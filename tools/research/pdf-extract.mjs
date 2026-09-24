/**
 * Extract the text of an official VTU PDF, for research only.
 *
 * WebFetch reports VTU's regulation PDFs as "heavily compressed/corrupted" and
 * returns nothing usable. This uses the SAME pdfjs build the product parses
 * result cards with (apps/web/src/lib/pdf-text.ts), so a document that the
 * product can read is a document this can read.
 *
 *   node tools/research/pdf-extract.mjs <file.pdf> > out.txt
 *
 * Run it from apps/web so pdfjs-dist resolves:
 *   cd apps/web && node ../../tools/research/pdf-extract.mjs <file.pdf>
 *
 * Research tooling. Nothing in the application imports it.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
const path = process.argv[2];
const data = new Uint8Array(await readFile(path));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
console.log('PAGES:', doc.numPages);
const out = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  const text = content.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
  out.push(`\n===== PAGE ${p} =====\n${text}`);
}
console.log(out.join('\n'));
