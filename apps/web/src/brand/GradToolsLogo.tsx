/**
 * The GradTools symbol on its theme tile.
 *
 * One source of truth: gradtools-mark.svg, drawn in `currentColor`. The same
 * file is the favicon (index.html). The tile takes the theme through the
 * brand tokens (styles/index.css), so the symbol never changes shape, only
 * its ink and its ground.
 *
 * Decorative by default: a brand link already carries its own name. Pass
 * `label` only where the symbol stands alone as meaning.
 */

import mark from './gradtools-mark.svg?raw';
import { cn } from '../lib/cn.js';

export function GradToolsLogo({
  size = 32,
  label,
  className,
  round = false,
}: {
  readonly size?: number;
  readonly label?: string;
  readonly className?: string;
  /** The header's logo bubble; everywhere else the tile keeps its corners. */
  readonly round?: boolean;
}) {
  return (
    <span
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      data-testid="gradtools-logo"
      className={cn(
        'inline-grid shrink-0 place-items-center bg-brand-surface text-brand-mark ring-1 ring-line ring-inset',
        // A circle is narrower at its corners; the cap's tips need the room.
        round ? '[&>svg]:size-[68%]' : '[&>svg]:size-[78%]',
        className,
      )}
      style={{ width: size, height: size, borderRadius: round ? size / 2 : size / 4 }}
      dangerouslySetInnerHTML={{ __html: mark }}
    />
  );
}
