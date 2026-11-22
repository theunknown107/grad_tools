import { describe, expect, it } from 'vitest';
import { branchCode } from '../src/lib/format.js';

describe('branchCode', () => {
  it('shortens a programme the way the design writes it', () => {
    expect(branchCode('Computer Science & Business Systems')).toBe('CSBS');
    expect(branchCode('Computer Science and Engineering')).toBe('CSE');
    expect(branchCode('Artificial Intelligence and Machine Learning')).toBe('AIML');
    expect(branchCode('Electronics & Communication Engineering')).toBe('ECE');
  });

  it('leaves a name that is already short alone', () => {
    expect(branchCode('CSE')).toBe('CSE');
    expect(branchCode('Civil')).toBe('Civil');
  });
});
