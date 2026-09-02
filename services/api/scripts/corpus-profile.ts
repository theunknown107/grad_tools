/**
 * Prints the corpus profile and the similarity gate.
 *
 * Authority: docs/18 (M10B.3) · docs/32 OQ-045
 *
 *   DATABASE_URL=postgres://... pnpm --filter @gradtools/api corpus:profile
 *
 * Read-only. It opens one connection, counts, prints and exits; nothing here
 * writes to the database or to disk, so it is safe to run against any corpus
 * including one holding private papers.
 *
 * Private papers ARE counted here, because this is an internal readiness report
 * and pretending the corpus is smaller than it is would be its own dishonesty.
 * No question TEXT is printed — only counts — so running it produces no
 * disclosure even from a private paper.
 */

import postgres from 'postgres';
import { profileCorpus, similarityGate } from '../src/intelligence/corpus-profile.js';

function row(label: string, value: string | number): string {
  return `  ${label.padEnd(28)} ${String(value)}`;
}

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const sql = postgres(url, { max: 1 });

try {
  const profile = await profileCorpus(sql);
  const gate = similarityGate(profile);

  console.log('\nQUESTION-PAPER CORPUS PROFILE');
  console.log('  (current extractions only; superseded parser versions excluded)\n');

  console.log(row('Papers', profile.papers));
  console.log(row('Subjects', profile.subjects));
  console.log(row('Multi-sitting subjects', profile.multiSittingSubjects));
  console.log(row('Private papers', profile.privatePapers));
  console.log(row('Papers needing review', profile.needsReviewPapers));
  console.log(row('Superseded extractions', profile.supersededExtractions));

  console.log('\n  Sittings');
  for (const s of profile.sittings)
    console.log(row(`    ${s.sitting}`, `${String(s.papers)} papers`));

  console.log('\n  Extraction source');
  for (const s of profile.bySource)
    console.log(row(`    ${s.source}`, `${String(s.papers)} papers`));

  console.log('\n  Paper format');
  for (const f of profile.byFormat)
    console.log(row(`    ${f.format}`, `${String(f.papers)} papers`));

  console.log('\n  Extracted records');
  console.log(row('    Questions', profile.questions));
  console.log(row('    Sub-questions', profile.subQuestions));
  console.log(row('    MCQ items stored', profile.mcqItems));
  console.log(row('    MCQ items declared', profile.mcqItemsDeclared));
  if (profile.mcqItems !== profile.mcqItemsDeclared) {
    console.log(
      `    ^ MISMATCH: extraction recorded ${String(profile.mcqItemsDeclared)} MCQ item(s) but ${String(profile.mcqItems)} are stored.`,
    );
  }
  console.log(row('    Empty questions', profile.emptyQuestions));
  console.log(row('    Empty sub-questions', profile.emptySubQuestions));
  console.log(row('    Tokenisable texts', profile.tokenisable));
  console.log(row('    Non-empty, non-tokenisable', profile.nonTokenisable));

  console.log('\n  Subject | Sittings | Papers | Usable texts (Q + sub-Q)');
  for (const s of profile.perSubject) {
    console.log(
      `    ${s.subjectCode.padEnd(12)} ${String(s.sittings).padStart(8)} ${String(s.papers).padStart(6)} ${String(s.usableTexts).padStart(17)}`,
    );
  }

  console.log('\nSIMILARITY GATE');
  console.log(`  ${gate.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'} — ${gate.reason}`);
  if (gate.eligibleSubjects.length > 0) {
    console.log('\n  Eligible comparison groups');
    for (const s of gate.eligibleSubjects) {
      console.log(
        row(
          `    ${s.subjectCode}`,
          `${String(s.sittings)} sittings, ${String(s.usableTexts)} usable texts`,
        ),
      );
    }
  }
  console.log('');
} finally {
  await sql.end();
}
