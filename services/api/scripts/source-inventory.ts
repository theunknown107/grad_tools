/**
 * What academic source material is actually on this machine, and what it can prove.
 *
 * Authority: docs/22 §22.45 · docs/32 OQ-053 · M10A.3 §3, §4, §7
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS BEFORE ANY INGESTION CODE
 * ---------------------------------------------------------------------------
 *
 * M10A.2 left the catalogue honest and thin: ten subjects in one semester, SEE
 * applicability unknown for all of them, credits unknown beyond semester 1, and
 * L/T/P unknown everywhere. The obvious next step is to ingest more.
 *
 * The step before that — the one that is easy to skip and expensive to skip —
 * is asking whether the material to hand can support the facts we would be
 * writing down. A parser that runs successfully over a document that does not
 * say what we need proves only that the parser runs.
 *
 * So this reads every candidate source, reports what each one actually
 * declares, and says which reference facts it could and could not establish. It
 * writes nothing, and it reaches no network.
 *
 *   node --experimental-strip-types scripts/source-inventory.ts [dir]
 *   pnpm --filter @gradtools/api source:inventory
 *
 * ---------------------------------------------------------------------------
 * THE DISTINCTION THAT DECIDES EVERYTHING
 * ---------------------------------------------------------------------------
 *
 * VTU has two code families in circulation, and they are different schemes:
 *
 *     BMATS101     the 2022 scheme, which GradTools models
 *     1BMATC101    a later scheme, effective 2025-26
 *
 * A document from the second cannot establish a fact about the first. The
 * leading digit is not noise and must never be stripped to make a code "match"
 * — doing so silently reattributes a 2025 course to a 2022 catalogue, and the
 * result looks entirely plausible (M10A.3 §8, §13).
 */

import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { declaredBy, filenameAgrees, isLaterFamily } from '../src/reference/source-scan.js';

const run = promisify(execFile);

interface Finding {
  readonly file: string;
  readonly hasTextLayer: boolean;
  readonly bytes: number;
  /**
   * Every code the DOCUMENT declares, in order.
   *
   * A set, not one value, because a paper legitimately serves several codes:
   * `1BESC104C/204C` is the same examination in two semesters, and
   * `BENGK106-206` likewise. Collapsing that discards a real fact about which
   * courses the document speaks for.
   */
  readonly codes: readonly string[];
  /** The code the FILENAME claims. Compared against the page, never trusted over it. */
  readonly fileCode: string | null;
  readonly isModelPaper: boolean;
  readonly effectFrom: string | null;
  readonly semester: string | null;
  readonly degreeExam: boolean;
  readonly maxMarks: string | null;
}

async function firstPageText(path: string): Promise<string | null> {
  try {
    // `-` writes to stdout, so nothing is left behind on disk.
    const { stdout } = await run('pdftotext', ['-layout', '-f', '1', '-l', '1', path, '-'], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch {
    /*
     * Either pdftotext is absent or this file has no text layer. The two are
     * reported differently by the caller, because "we could not look" and "we
     * looked and there was nothing" are different states and only one of them
     * is a fact about the document.
     */
    return null;
  }
}

async function havePdftotext(): Promise<boolean> {
  try {
    await run('pdftotext', ['-v']);
    return true;
  } catch (cause) {
    /*
     * `pdftotext -v` prints its banner to STDERR and exits non-zero on several
     * poppler builds, so a thrown error does not mean the tool is missing.
     * ENOENT does. Treating any failure as "not installed" made this report
     * announce it could not look at files it could read perfectly well.
     */
    return (cause as { code?: unknown }).code !== 'ENOENT';
  }
}

function examine(file: string, text: string): Finding {
  /*
   * Only the first page is read. A VTU paper declares its code, title,
   * semester and marks in the header block; the body is questions, and
   * scanning it would drag in every code a question happens to mention.
   */
  const declaration = declaredBy(text.slice(0, 1500));
  const { claimed } = filenameAgrees(file, declaration);
  return {
    file,
    hasTextLayer: text.trim().length > 200,
    bytes: text.length,
    codes: declaration.codes,
    fileCode: claimed,
    isModelPaper: declaration.isModelPaper,
    effectFrom: declaration.effectFrom,
    semester: declaration.semester,
    degreeExam: declaration.isDegreeExam,
    maxMarks: declaration.maxMarks === null ? null : String(declaration.maxMarks),
  };
}

const main = async (): Promise<void> => {
  const dir = resolve(process.argv[2] ?? 'qpapers_and solutions_sample');

  let files: string[];
  try {
    files = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.pdf')).sort();
  } catch {
    console.log(`No source directory at ${dir}. Nothing to inventory.`);
    return;
  }

  const tool = await havePdftotext();
  console.log(`source directory : ${dir}`);
  console.log(`pdf files        : ${String(files.length)}`);
  console.log(
    `pdftotext        : ${tool ? 'available' : 'NOT AVAILABLE — text-layer status unknown'}\n`,
  );
  if (!tool) {
    console.log('Install poppler-utils to inventory these files. Nothing is guessed without it.');
    return;
  }

  const findings: Finding[] = [];
  for (const file of files) {
    const text = await firstPageText(join(dir, file));
    findings.push(text === null ? examine(file, '') : examine(file, text));
  }

  const withText = findings.filter((entry) => entry.hasTextLayer);
  const scanned = findings.filter((entry) => !entry.hasTextLayer);

  console.log(`with a text layer : ${String(withText.length)}`);
  console.log(
    `image-only scans  : ${String(scanned.length)}  (readable only through OCR, which is unreviewed — M10B.3)\n`,
  );

  console.log('Documents that could be read directly:');
  console.log('  codes declared on the page          model?  effect    sem     file');
  for (const entry of withText) {
    const declared = entry.codes.length === 0 ? '(none found)' : entry.codes.join(', ');
    /*
     * A filename claiming a code the page does not carry is worth seeing on its
     * own line. It is how the corpus came to hold 2025-scheme model papers as
     * 2022-scheme sittings: the name was trusted and the page was not.
     */
    const disagrees =
      entry.fileCode !== null && !entry.codes.includes(entry.fileCode)
        ? `  <- filename says ${entry.fileCode}, NOT on the page`
        : '';
    console.log(
      `  ${declared.padEnd(34)}  ${(entry.isModelPaper ? 'yes' : 'no').padEnd(6)}  ` +
        `${(entry.effectFrom ?? '-').padEnd(8)}  ${(entry.semester ?? '-').padEnd(6)}  ` +
        `${entry.file}${disagrees}`,
    );
  }

  /* ---- What these documents can and cannot establish --------------------- */

  /*
   * A document counts for the 2022 catalogue only if EVERY code it declares is
   * a 2022 code. A paper printing both `1BPLC105E` and a bare `205E` is a
   * later-scheme document that happens to spell one code without its prefix,
   * and counting it as 2022 evidence on the strength of that spelling is
   * exactly the mistake this report exists to prevent.
   */
  const later = withText.filter((entry) => entry.codes.some(isLaterFamily));
  const twenty22 = withText.filter(
    (entry) => entry.codes.length > 0 && !entry.codes.some(isLaterFamily),
  );
  const mismatched = withText.filter(
    (entry) => entry.fileCode !== null && !entry.codes.includes(entry.fileCode),
  );

  console.log('\nWhat this material can establish for the vtu-2022 catalogue:');
  console.log(`  documents whose every declared code is 2022-family : ${String(twenty22.length)}`);
  console.log(`  documents declaring a LATER (1B...) code           : ${String(later.length)}`);
  console.log(`  filenames claiming a code not on the page         : ${String(mismatched.length)}`);
  if (later.length > 0) {
    console.log('    These are a DIFFERENT SCHEME. They cannot establish a fact about vtu-2022,');
    console.log('    and stripping the leading 1 to make a code match would reattribute a later');
    console.log('    course to the 2022 catalogue while looking entirely plausible.');
  }

  /*
   * The fields a question paper carries at all. Credits and L/T/P are absent
   * from every question paper ever printed, so no amount of this material
   * closes those gaps — which is worth stating plainly rather than leaving a
   * reader to infer it from a table of what IS present.
   */
  console.log('\n  A question paper can evidence : subject code, course title, semester,');
  console.log('                                  and that a semester-end examination exists.');
  console.log('  A question paper NEVER carries : credits, L/T/P, scheme membership.');
  console.log('    So the credit and L/T/P gaps cannot be closed from this material at all,');
  console.log('    whatever its quality — they need the scheme of teaching document.');

  /* ---- The corpus against the verified catalogue (M10A.4 §22) ------------ */
  const referenceUrl = process.env.DATABASE_URL;
  const corpusUrl = process.env.CORPUS_DATABASE_URL;
  if (referenceUrl !== undefined && corpusUrl !== undefined) {
    /*
     * Imported lazily so the directory report — the part that needs no database
     * at all — keeps working on a machine with neither.
     */
    const { default: postgres } = await import('postgres');
    const reference = postgres(referenceUrl, { onnotice: () => undefined });
    const corpus = postgres(corpusUrl, { onnotice: () => undefined });
    try {
      const known = new Set(
        (
          await reference<{ code: string }[]>`
            select code from subjects where publication = 'published'`
        ).map((row) => row.code),
      );
      const stored = await corpus<{ subject_code: string | null; title: string }[]>`
        select subject_code, title from documents
         where document_kind = 'question_paper' order by subject_code`;

      console.log('\nCorpus documents against the verified catalogue:');
      for (const row of stored) {
        const code = row.subject_code ?? '(none)';
        const verdict =
          row.subject_code === null
            ? 'no code recorded'
            : known.has(row.subject_code)
              ? 'in the catalogue'
              : 'NOT in the verified catalogue';
        console.log(`  ${code.padEnd(12)}  ${verdict.padEnd(30)}  ${row.title}`);
      }
      console.log('\n  "NOT in the catalogue" is not proof of an error: this catalogue covers CSE');
      console.log('  semesters I-II only, so a real code from another stream or a later semester');
      console.log('  lands here too. It is a list to CHECK, not a list of defects (M10A.4 §22).');
    } finally {
      await Promise.all([reference.end(), corpus.end()]);
    }
  }

  const modelOnly = withText.filter((entry) => entry.isModelPaper).length;
  if (modelOnly > 0) {
    console.log(
      `\n  ${String(modelOnly)} of the readable documents are MODEL papers, not records of a sitting.`,
    );
    console.log(
      '    A model paper shows the intended shape of an examination. It is weaker evidence',
    );
    console.log('    that a given cohort actually sat one than a real paper from a named session.');
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
