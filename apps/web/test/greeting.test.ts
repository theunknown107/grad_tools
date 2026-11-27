// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { greetingFor } from '../src/lib/time.js';

describe('the dashboard greeting', () => {
  it('follows the time of day', () => {
    expect(greetingFor(5)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(16)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good evening');
    expect(greetingFor(2)).toBe('Good evening');
  });

  it('uses the first name the student gave, and nothing when there is none', () => {
    expect(greetingFor(9, '  Asha Rao ')).toBe('Good morning, Asha');
    expect(greetingFor(9, '')).toBe('Good morning');
    expect(greetingFor(9, null)).toBe('Good morning');
  });
});
