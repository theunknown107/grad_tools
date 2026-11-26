/**
 * Repository provider.
 *
 * The single place the storage implementation is chosen. Swapping Stage 1's
 * local bundle for a future API bundle is a change here and nowhere else
 * (docs/33 §33.3).
 */

import { createContext, use, type ReactNode } from 'react';
import { localRepositories } from './local/index.js';
import type { RepositoryBundle } from './types.js';

const RepositoryContext = createContext<RepositoryBundle>(localRepositories);

/*
 * WHETHER THESE ARE THE RIGHT RECORDS YET.
 *
 * While a stored session is still being checked, the bundle above is the
 * anonymous scope — not the student's. Its lists answer instantly and are
 * usually empty, and showing that as "No results are saved yet" told a
 * signed-in student their records were gone until the session settled and
 * the screen swapped to a skeleton, then to their data. Readers treat a bundle
 * that is not ready as still loading, so the only transition is skeleton →
 * the real answer.
 */
const ReadyContext = createContext(true);

export function RepositoryProvider({
  children,
  repositories = localRepositories,
  ready = true,
}: {
  children: ReactNode;
  repositories?: RepositoryBundle;
  ready?: boolean;
}) {
  return (
    <RepositoryContext value={repositories}>
      <ReadyContext value={ready}>{children}</ReadyContext>
    </RepositoryContext>
  );
}

export function useRepositories(): RepositoryBundle {
  return use(RepositoryContext);
}

/** False while the provider's scope is not yet known to be the right one. */
export function useRepositoriesReady(): boolean {
  return use(ReadyContext);
}
