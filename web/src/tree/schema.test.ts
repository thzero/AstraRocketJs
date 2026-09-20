import { describe, it, expect } from 'vitest';
import { DISPLAY_NAME } from './schema';
import en from '../i18n/locales/en.json';

describe('DISPLAY_NAME', () => {
  it('maps component types to human-readable labels', () => {
    expect(DISPLAY_NAME.bodytube).toBe('Body tube');
    expect(DISPLAY_NAME.nosecone).toBe('Nose cone');
    expect(DISPLAY_NAME.trapezoidfinset).toBe('Trapezoidal fins');
    expect(DISPLAY_NAME.parallelstage).toBe('Booster (parallel stage)');
  });
});

describe('DISPLAY_NAME is only a fallback', () => {
  it('every type it names has a localized part.<type> key, which is what the UI should show', () => {
    const part = (en as { part: Record<string, unknown> }).part;
    const missing = Object.keys(DISPLAY_NAME).filter((t) => typeof part[t] !== 'string');
    expect(missing).toEqual([]);
  });
});
