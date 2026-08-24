/**
 * Reference-data hooks.
 *
 * Authority: M5a §21, docs/04 §4.4-§4.6
 *
 * Every server-backed screen must handle loading, success, empty, network
 * error, server error and retry. This hook models all of them explicitly as a
 * discriminated state rather than the usual `{data, loading, error}` triple,
 * where "loaded but empty" and "not loaded yet" blur together and produce the
 * blank screens M5a §21 forbids.
 */

import { useCallback, useEffect, useState } from 'react';
import { ReferenceError, apiReferenceRepository } from '../repositories/reference.js';

export type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly kind: ReferenceError['kind']; readonly message: string };

export interface AsyncResult<T> {
  readonly state: AsyncState<T>;
  readonly retry: () => void;
}

/**
 * Runs an async reference query, with cancellation and retry.
 *
 * `deps` deliberately drives re-fetching, and an in-flight request is aborted
 * when they change so a slow first response cannot overwrite a fast second one.
 */
export function useAsync<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ReferenceError) {
          setState({ status: 'error', kind: error.kind, message: error.message });
          return;
        }
        setState({
          status: 'error',
          kind: 'network',
          message: 'Something went wrong loading reference data.',
        });
      },
    );

    return () => {
      controller.abort();
    };
    // `run` is recreated each render by callers; deps + attempt are the real
    // inputs. Including `run` would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}

/** Schemes GradTools supports, from the server. */
export function useSchemes() {
  return useAsync((signal) => apiReferenceRepository.listSchemes(signal), []);
}

/** Branches, from the server. */
export function useBranches() {
  return useAsync((signal) => apiReferenceRepository.listBranches(signal), []);
}

/** Subjects for a scheme, branch and semester. */
export function useSubjects(scheme?: string, branch?: string, semester?: number) {
  return useAsync(
    (signal) =>
      apiReferenceRepository.listSubjects(
        {
          ...(scheme === undefined ? {} : { scheme }),
          ...(branch === undefined ? {} : { branch }),
          ...(semester === undefined ? {} : { semester }),
        },
        signal,
      ),
    [scheme, branch, semester],
  );
}

/**
 * Rule-set metadata for a scheme.
 *
 * Metadata only. Calculations still run through @gradtools/academic-rules on
 * the client; this exists so the UI can show which thresholds and clause
 * citations are in force without hard-coding them (M5a §9).
 */
export function useSchemeRules(schemeId: string | null) {
  return useAsync(
    (signal) =>
      schemeId === null
        ? Promise.resolve(null)
        : apiReferenceRepository.getSchemeRules(schemeId, signal),
    [schemeId],
  );
}
