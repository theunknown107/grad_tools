/**
 * `pnpm vtu:validate` — the catalogue integrity gate.
 *
 * Authority: Phase 7D.2 §21, §32
 *
 *   pnpm vtu:validate
 *   pnpm vtu:validate --scheme 2022
 *
 * The rules themselves live in `src/sources/catalogue-validate.ts`, so they can
 * be run against a database a test built with a defect deliberately in it — a
 * validator nobody has ever seen fail is not a validator. This file is the
 * terminal: it opens a connection, prints, and sets an exit code.
 */

import postgres from 'postgres';
import { validateCatalogue, type Severity } from '../src/sources/catalogue-validate.js';

const MARK: Readonly<Record<Severity, string>> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
  skip: '–',
};

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'] ?? null;
  if (url === null) {
    console.error('\n  No DATABASE_URL. vtu:validate checks the PERSISTED catalogue.\n');
    process.exitCode = 1;
    return;
  }
  const schemeYear = flag('scheme');
  const sql = postgres(url, { max: 2 });

  const result = await validateCatalogue(sql, { schemeYear }).finally(() => sql.end());

  console.log(`\nValidation${schemeYear === null ? '' : ` of the ${schemeYear} catalogue`}\n`);
  let area = '';
  for (const finding of result.findings) {
    if (finding.area !== area) {
      area = finding.area;
      console.log(`  ${area}`);
    }
    console.log(`    ${MARK[finding.severity]} ${finding.message}`);
    for (const example of finding.examples ?? []) console.log(`        ${example}`);
  }

  const trailer = [
    result.warnings === 0
      ? null
      : `${String(result.warnings)} warning${result.warnings === 1 ? '' : 's'}`,
    result.skipped === 0 ? null : `${String(result.skipped)} not checkable`,
  ].filter((part) => part !== null);

  const verdict = result.passed
    ? 'VALIDATION PASSED'
    : `VALIDATION FAILED — ${String(result.failures)} failure${result.failures === 1 ? '' : 's'}`;
  console.log(`\n${verdict}${trailer.length === 0 ? '' : ` (${trailer.join(', ')})`}\n`);
  if (!result.passed) process.exitCode = 1;
}

await main();
