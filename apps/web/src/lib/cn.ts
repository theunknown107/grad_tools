import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * The named sizes in styles/index.css (`--text-caption`, `--text-label`,
 * `--text-title`). Without this, tailwind-merge reads `text-caption` as a text
 * COLOUR and drops it when a colour such as `text-ink-3` follows.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['caption', 'label', 'title'] } },
});

/** Joins class names and lets a later Tailwind utility override an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
