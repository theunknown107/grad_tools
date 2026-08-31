/**
 * Web test setup.
 *
 * Authority: docs/22 §22.26
 */

import { configure } from '@testing-library/dom';

/*
 * Testing Library's async queries have their OWN timeout, separate from
 * Vitest's. `testTimeout: 20_000` in vitest.config.ts governs how long a test
 * may run; `asyncUtilTimeout` governs how long a single `findBy*` waits before
 * it throws "Unable to find an element" — and it defaults to 1000ms.
 *
 * That 1s is comfortable for one test file and too tight for forty-two running
 * in parallel. `reference.test.tsx` flaked three times in one session on a
 * `findByText` that takes ~400ms alone and over 3800ms under full-suite load:
 * the assertion was correct, the component was correct, and the wait expired
 * before the render it was waiting for.
 *
 * Five seconds is long enough to absorb scheduler contention and still short
 * enough that a genuinely missing element fails the run rather than hanging it.
 */
configure({ asyncUtilTimeout: 5_000 });
