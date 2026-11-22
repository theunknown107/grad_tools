/**
 * The GradTools symbol on its tile.
 *
 * One source of truth: gradtools-logo.png — the official brand asset, black
 * line art on a solid white ground, used AS-IS. The same file is the favicon's
 * source (scripts/android-icons.mjs). The asset carries its own white ground,
 * so the tile reads white in both light and dark; its built-in padding sets the
 * symbol's inset.
 *
 * Decorative by default: a brand link already carries its own name. Pass
 * `label` only where the symbol stands alone as meaning.
 */

import logo from './gradtools-logo.png';
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
        'inline-grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-line ring-inset',
        className,
      )}
      style={{ width: size, height: size, borderRadius: round ? size / 2 : size / 4 }}
    >
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="size-full object-contain"
      />
    </span>
  );
}
