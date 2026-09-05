import { describe, it, expect } from 'vitest';
import { DISPLAY_NAME } from './schema';

describe('DISPLAY_NAME', () => {
  it('maps component types to human-readable labels', () => {
    expect(DISPLAY_NAME.bodytube).toBe('Body tube');
    expect(DISPLAY_NAME.nosecone).toBe('Nose cone');
    expect(DISPLAY_NAME.trapezoidfinset).toBe('Trapezoidal fins');
    expect(DISPLAY_NAME.parallelstage).toBe('Booster (parallel stage)');
  });
});
