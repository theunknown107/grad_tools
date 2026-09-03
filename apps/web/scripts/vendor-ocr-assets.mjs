/**
 * Copies the OCR engine's assets out of node_modules and onto our own origin.
 *
 * Authority: docs/12 §12.x · M10A.6B §5, §7, §38
 *
 * ---------------------------------------------------------------------------
 * WHY A COPY STEP AND NOT AN IMPORT
 * ---------------------------------------------------------------------------
 *
 * tesseract.js builds two of its asset URLs by STRING CONCATENATION:
 *
 *     `${langPath}/${lang}.traineddata.gz`
 *     `${corePath}/tesseract-core-simd-lstm.wasm.js`
 *
 * so both need a directory whose filenames survive intact. A bundler import
 * gives back a content-hashed name, which is exactly what those templates
 * cannot use. Hence a plain copy into `public/`, which Vite serves verbatim.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST LET IT USE THE CDN
 * ---------------------------------------------------------------------------
 *
 * Because the default is jsDelivr, and the page making that request has a
 * student's result card open in it. Every fetch would tell a third party when a
 * student is reading their marks, and the feature would stop working offline.
 * The engine is ours to serve (Apache-2.0 and MIT), so we serve it.
 *
 * ---------------------------------------------------------------------------
 * NOTHING COPIED HERE IS COMMITTED
 * ---------------------------------------------------------------------------
 *
 * `public/ocr/` is gitignored. These are several megabytes of build output that
 * npm already holds a canonical copy of; committing them would put binaries in
 * the history to no purpose.
 *
 *   node apps/web/scripts/vendor-ocr-assets.mjs
 *
 * Runs from `prebuild` and `predev`, and is idempotent.
 */
import { createRequire } from 'node:module';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'public', 'ocr');
const require = createRequire(import.meta.url);

/**
 * The variants the engine may choose between.
 *
 * `getCore` picks by SIMD support at runtime, so all three LSTM builds are
 * copied even though any given browser fetches exactly one. Each is
 * self-contained — the wasm is embedded, so there is no sibling to fetch — and
 * the legacy (non-LSTM) builds are deliberately absent: the legacy engine needs
 * the 10.9MB model rather than the 2.8MB one, for worse results on printed
 * text.
 */
const CORE_FILES = [
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
];

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

/** Copies only when the destination is missing or a different size. */
async function vendor(from, to) {
  const [source, destination] = await Promise.all([sizeOf(from), sizeOf(to)]);
  if (source < 0) throw new Error(`missing OCR asset: ${from}`);
  if (source === destination) return { to, bytes: source, copied: false };
  await copyFile(from, to);
  return { to, bytes: source, copied: true };
}

const main = async () => {
  await mkdir(OUT, { recursive: true });

  const tesseractPkg = require.resolve('tesseract.js/package.json');
  const tesseractDir = dirname(tesseractPkg);
  const engDir = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

  /*
   * The core is a dependency OF tesseract.js, not of this app, and pnpm does
   * not hoist it — so it is resolved from tesseract.js's own directory rather
   * than from here. Asking the package that actually depends on it is also the
   * only way to be sure the copied core matches the library's expected version.
   */
  const coreDir = dirname(
    createRequire(tesseractPkg).resolve('tesseract.js-core/package.json'),
  );

  const jobs = [
    // The worker script the main thread spawns.
    [join(tesseractDir, 'dist', 'worker.min.js'), join(OUT, 'worker.min.js')],
    /*
     * `4.0.0_best_int` rather than `4.0.0`: the integer-quantised LSTM model is
     * 2.8MB against 10.9MB, and the larger file's extra size is the LEGACY
     * engine data, which is not used here at all.
     */
    [join(engDir, '4.0.0_best_int', 'eng.traineddata.gz'), join(OUT, 'eng.traineddata.gz')],
    ...CORE_FILES.map((file) => [join(coreDir, file), join(OUT, file)]),
  ];

  let total = 0;
  for (const [from, to] of jobs) {
    const result = await vendor(from, to);
    total += result.bytes;
    console.log(
      `  ${result.copied ? 'copied ' : 'present'}  ${(result.bytes / 1024 / 1024).toFixed(2)} MB  ${result.to.slice(OUT.length + 1)}`,
    );
  }

  /*
   * The on-disk total is not the download. A browser fetches ONE core variant,
   * the worker and the model — so what a student actually pays is roughly the
   * largest core plus the model, not this sum.
   */
  console.log(`  ---\n  ${(total / 1024 / 1024).toFixed(2)} MB on disk across ${String(jobs.length)} files`);
};

main().catch((error) => {
  console.error('Could not vendor the OCR assets:', error.message);
  process.exit(1);
});
