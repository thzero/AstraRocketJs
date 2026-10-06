import { describe, it, expect } from 'vitest';
import { errorMessage } from '../../../src/services/app/errorMessage';

describe('errorMessage', () => {
  it('reads an Error by its message and anything else as text', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});
