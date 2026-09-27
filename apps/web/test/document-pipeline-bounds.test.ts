/**
 * The import pipeline always ends, and ends clean.
 *
 * On a real phone the screen stayed at "Reading your document…" forever: the
 * OCR engine lives in a Web Worker, and a worker the WebView kills sends no
 * error, so the promise waiting on it never settled. These tests pin the
 * bounds that make every stage terminate, the teardown that follows, and the
 * content check that decides which decoder a file gets.
 *
 * SYNTHETIC CONTENT ONLY.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_START_MS, RECOGNITION_MS, withDeadline } from '../src/lib/deadline.js';

/* -- A stand-in engine whose worker can be made to hang -------------------- */

const engine = {
  startHangs: false,
  /** The model 404s: tesseract.js reports it to `errorHandler` and never settles. */
  modelMissing: false,
  recognizeHangs: false,
  options: null as null | Record<string, unknown>,
  terminated: 0,
  release: null as null | ((worker: unknown) => void),
};

function fakeWorker() {
  return {
    setParameters: () => Promise.resolve(),
    recognize: () =>
      engine.recognizeHangs
        ? new Promise(() => undefined)
        : Promise.resolve({ data: { blocks: [] } }),
    terminate: () => {
      engine.terminated += 1;
      return Promise.resolve();
    },
  };
}

vi.mock('tesseract.js', () => ({
  createWorker: (_lang: string, _oem: number, options: Record<string, unknown>) => {
    engine.options = options;
    if (engine.modelMissing) {
      (options.errorHandler as (data: unknown) => void)(
        'Network error while fetching /ocr/eng.traineddata.gz. Response code: 404',
      );
      return new Promise(() => undefined);
    }
    return engine.startHangs
      ? new Promise((resolve) => {
          engine.release = resolve;
        })
      : Promise.resolve(fakeWorker());
  },
}));

const { startOcr, OcrError } = await import('../src/lib/ocr.js');
const { sniffKind } = await import('../src/lib/result-file.js');

const canvas = { width: 10, height: 10 } as HTMLCanvasElement;

beforeEach(() => {
  engine.startHangs = false;
  engine.modelMissing = false;
  engine.recognizeHangs = false;
  engine.options = null;
  engine.terminated = 0;
  engine.release = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('withDeadline', () => {
  it('passes a result through and leaves no timer behind', async () => {
    vi.useFakeTimers();
    await expect(withDeadline(Promise.resolve(7), 1000, () => new Error('late'))).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a promise that never settles into an error', async () => {
    vi.useFakeTimers();
    const pending = withDeadline(new Promise(() => undefined), 1000, () => new Error('late'));
    const outcome = expect(pending).rejects.toThrow('late');
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the OCR engine', () => {
  it('fails at once when the model cannot load, though tesseract.js never settles', async () => {
    // The physical-device failure: no timer is advanced, so only the error path can end this.
    engine.modelMissing = true;
    await expect(startOcr()).rejects.toThrow(/could not start/);
  });

  it('asks for every asset from our own origin, and the model uncompressed', async () => {
    await startOcr();
    expect(engine.options).toMatchObject({
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr',
      langPath: '/ocr',
      // An APK stores `x.gz` as `x`, so a gzipped model 404s on Android.
      gzip: false,
    });
  });

  it('gives up on an engine that never starts, and terminates it if it turns up late', async () => {
    vi.useFakeTimers();
    engine.startHangs = true;
    const starting = startOcr();
    const outcome = expect(starting).rejects.toThrow(/did not start on this device/);
    await vi.advanceTimersByTimeAsync(ENGINE_START_MS);
    await outcome;

    // The worker that finally arrives is not left running.
    engine.release?.(fakeWorker());
    await vi.runAllTimersAsync();
    expect(engine.terminated).toBe(1);
  });

  it('gives up on a page that never comes back, and tears the worker down', async () => {
    vi.useFakeTimers();
    engine.recognizeHangs = true;
    const session = await startOcr();
    const reading = session.recognize(canvas);
    const outcome = expect(reading).rejects.toThrow(/took too long/);
    await vi.advanceTimersByTimeAsync(RECOGNITION_MS);
    await outcome;
    await vi.runAllTimersAsync();

    expect(session.closed).toBe(true);
    expect(engine.terminated).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a page still waiting when the import is cancelled', async () => {
    engine.recognizeHangs = true;
    const session = await startOcr();
    const reading = session.recognize(canvas);
    await session.close();

    await expect(reading).rejects.toBeInstanceOf(OcrError);
    await expect(reading).rejects.toThrow(/cancelled/);
    expect(engine.terminated).toBe(1);
    await expect(session.recognize(canvas)).rejects.toThrow(/cancelled/);
  });
});

describe('what a file is, from its own bytes', () => {
  const file = (bytes: BlobPart, name: string, type = ''): File =>
    new File([bytes], name, { type });
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('reads an Android photo with no name extension and no type as a photo', async () => {
    await expect(sniffKind(file(JPEG, '1dfa240a-2c09-4526-92d5-a7cb9bd4dd00'))).resolves.toBe(
      'image',
    );
  });

  it('believes the bytes over the name and the declared type', async () => {
    await expect(sniffKind(file('%PDF-1.7\n', 'card.jpg', 'image/jpeg'))).resolves.toBe('pdf');
    await expect(sniffKind(file(PNG, 'page.html', 'text/html'))).resolves.toBe('image');
  });

  it('finds a PDF header that is not at the very start', async () => {
    await expect(sniffKind(file(`${' '.repeat(200)}%PDF-1.4`, 'x.pdf'))).resolves.toBe('pdf');
  });

  it('refuses a file that only claims to be a PDF', async () => {
    await expect(
      sniffKind(file('Name: Test Student', 'result.pdf', 'application/pdf')),
    ).resolves.toBe('unsupported');
  });

  it('treats a file as HTML only when it says so and is no binary format', async () => {
    await expect(sniffKind(file('<html></html>', 'r.html', 'text/html'))).resolves.toBe('html');
    await expect(sniffKind(file('<html></html>', 'r.txt', 'text/plain'))).resolves.toBe(
      'unsupported',
    );
  });
});
