/**
 * Looks for the known real grade card, using private reference data.
 *
 * `fixture-privacy.test.ts` checks shape only. Real values cannot live in this
 * repository, nor a hash of them: three small numbers are trivial to brute-force.
 * So this hands off to the private scanner kept beside that data, which also reads
 * rows split across lines, values with other numbers between them, and the text
 * inside Office files. It cannot read text inside an image, so review image
 * fixtures by eye.
 *
 *   GRADTOOLS_PRIVATE_SCANNER=D:/gradtools-privacy-backup/scan_records.py \
 *     node tests/private-record-scan.mjs            # working files
 *     node tests/private-record-scan.mjs --history  # every reachable commit too
 *
 * Output is redacted: paths and counts, never marks. Exits 1 on a match, 2 when the
 * scanner is unavailable, which is not a pass.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const scanner = process.env.GRADTOOLS_PRIVATE_SCANNER;
if (scanner === undefined || !existsSync(scanner)) {
  console.error('Set GRADTOOLS_PRIVATE_SCANNER. Nothing was scanned.');
  process.exit(2);
}

const scan = (...args) =>
  spawnSync('python', ['-I', scanner, ...args], { stdio: 'inherit' }).status ?? 2;

let status = scan('tree', process.cwd());
if (process.argv.includes('--history')) {
  const gitDir = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  status = Math.max(status, scan('repo', gitDir.stdout.trim()));
}
process.exit(status);
