import type { Tone } from '../ui/badge.js';

/**
 * The badge tone for a printed grade — the design colours grades by level.
 *
 * STATUS TONES ONLY, NEVER THE ACCENT. The accent is a personal preference and
 * must not change how a grade looks, so the top grade does not borrow it.
 */
export function gradeTone(letter: string | null | undefined): Tone {
  switch (letter) {
    case 'O':
    case 'A+':
    case 'A':
      return 'success';
    case 'B+':
    case 'B':
      return 'info';
    case 'C':
    case 'P':
      return 'warning';
    case 'F':
    case 'Ab':
    case 'AB':
      return 'danger';
    default:
      return 'neutral';
  }
}
