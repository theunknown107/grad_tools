/**
 * Loading placeholder.
 *
 * Authority: docs/05 §5.25 (M9.6D §31)
 * Provenance: SHADCN SOURCE. Ported from
 * `registry/bases/base/ui/skeleton.tsx`, retrieved via the shadcn skill.
 *
 * The shadcn original is four lines and has no dependencies at all:
 *
 *     function Skeleton({ className, ...props }) {
 *       return <div data-slot="skeleton" className={cn("cn-skeleton animate-pulse", ...)} />
 *     }
 *
 * Everything portable was kept — the single element, the `data-slot` hook, the
 * pass-through props, the pulse. What was replaced is the styling layer:
 * `cn()` and Tailwind's `animate-pulse` need Tailwind, which GradTools does
 * not use, and docs/05 §9 requires every imported component to be restyled to
 * GradTools tokens regardless. So the pulse is a local keyframe over the glass
 * surface token.
 *
 * A SKELETON MUST MATCH THE SHAPE IT REPLACES or it is worse than a spinner:
 * the layout shifts when the real content lands, which is the jank the
 * skeleton existed to prevent. Hence `lines` and `width` rather than a single
 * grey slab.
 */

import type { CSSProperties, ReactNode } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** Rows to draw. Match the row count of the content being awaited. */
  readonly lines?: number;
  /** Height of one row. Defaults to a line of body text. */
  readonly height?: string;
  /** Width of the last row, so a paragraph does not end square. */
  readonly lastWidth?: string;
  readonly radius?: 'sm' | 'md' | 'pill';
  /** Describes what is loading, for assistive technology. */
  readonly label?: string;
}

export function Skeleton({
  lines = 1,
  height,
  lastWidth = '62%',
  radius = 'sm',
  label = 'Loading',
}: SkeletonProps): ReactNode {
  return (
    /*
     * `role="status"` with `aria-busy`, not `aria-hidden`. A screen reader
     * user needs to know something is coming; hiding the placeholder leaves
     * them on a silent empty region wondering whether the page is broken.
     */
    <div className={styles.stack} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          data-slot="skeleton"
          className={styles.bar}
          data-radius={radius}
          style={
            {
              ...(height === undefined ? {} : { blockSize: height }),
              ...(index === lines - 1 && lines > 1 ? { inlineSize: lastWidth } : {}),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
