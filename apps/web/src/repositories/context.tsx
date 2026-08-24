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

export function RepositoryProvider({
  children,
  repositories = localRepositories,
}: {
  children: ReactNode;
  repositories?: RepositoryBundle;
}) {
  return <RepositoryContext value={repositories}>{children}</RepositoryContext>;
}

export function useRepositories(): RepositoryBundle {
  return use(RepositoryContext);
}
