import { resultPdf } from './lib/documents.mjs';
import { writeFileSync } from 'node:fs';

const rows = [
  ['BXX101', 'Course one', '40', '40', '80', 'A'],
  ['BXX102', 'Course two', '38', '42', '80', 'A'],
];
const buf = resultPdf(1, rows);
writeFileSync('.qa/fixture.pdf', buf);
console.log('bytes:', buf.length);
console.log('head:', JSON.stringify(buf.subarray(0, 20).toString('latin1')));
console.log('tail:', JSON.stringify(buf.subarray(-40).toString('latin1')));

const pdfjs = await import('file:///D:/GradTools/apps/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
try {
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useWorkerFetch: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  const pdf = await task.promise;
  console.log('OK pages:', pdf.numPages);
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  console.log('items:', tc.items.length, tc.items.slice(0, 4).map((i) => i.str));
} catch (e) {
  console.log('PDFJS ERROR:', e?.name, '|', String(e?.message).slice(0, 200));
}
