/**
 * The top bar's one appearance control: LIGHT ↔ DARK, nothing else.
 *
 * It flips whatever is showing now, so under "System" one press still gives
 * the opposite of what the student sees (and that becomes their explicit
 * choice). Accent, density and System itself live in Profile → Appearance —
 * never here.
 */

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import { IconButton } from '../ui/button.js';

export function ThemeToggle() {
  const { resolved, toggleAppearance } = useTheme();
  const dark = resolved === 'dark';
  return (
    <IconButton
      label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={dark}
      onClick={toggleAppearance}
      className="relative overflow-hidden"
    >
      <Sun
        aria-hidden="true"
        className={`absolute size-4.5 transition-[transform,opacity] duration-300 ${dark ? 'scale-50 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'}`}
      />
      <Moon
        aria-hidden="true"
        className={`absolute size-4.5 transition-[transform,opacity] duration-300 ${dark ? 'scale-100 rotate-0 opacity-100' : 'scale-50 rotate-90 opacity-0'}`}
      />
    </IconButton>
  );
}
