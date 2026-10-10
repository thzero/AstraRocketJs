import { describe, it, expect } from 'vitest';
import { appPresetType, kernelPresetType } from '../../../../src/services/files/ork/presetTypes';

/** The `<preset type>` mapping takes its key from a file. */
describe('preset type mapping', () => {
  it('maps the kernel enum constants both ways', () => {
    expect(appPresetType('NOSE_CONE')).toBe('nosecone');
    expect(kernelPresetType('nosecone')).toBe('NOSE_CONE');
  });

  it('returns a string for a key that names an Object.prototype member', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(appPresetType(key), key).toBe(key.toLowerCase());
      expect(kernelPresetType(key), key).toBe('');
    }
  });
});
