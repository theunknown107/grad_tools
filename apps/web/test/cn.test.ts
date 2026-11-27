// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from '../src/lib/cn.js';

describe('cn and the named text sizes', () => {
  it('keeps a named size beside a text colour', () => {
    expect(cn('text-caption font-medium', 'text-ink-3')).toBe(
      'text-caption font-medium text-ink-3',
    );
  });

  it('still lets a later size replace an earlier one', () => {
    expect(cn('text-caption', 'text-label')).toBe('text-label');
    expect(cn('text-[12px]', 'text-title')).toBe('text-title');
  });
});
