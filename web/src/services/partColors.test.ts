import { describe, it, expect } from 'vitest';
import {
  PART_KEYS,
  DEFAULT_PART_COLORS,
  UNKNOWN_PART_COLOR,
  mergePalette,
  colorForType,
} from './partColors';

describe('part palette', () => {
  it('DEFAULT_PART_COLORS has an entry for every PART_KEY', () => {
    for (const k of PART_KEYS) {
      expect(DEFAULT_PART_COLORS[k]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('mergePalette overlays overrides on the defaults', () => {
    const p = mergePalette({ fins: '#123456' });
    expect(p.fins).toBe('#123456');
    expect(p.nose).toBe(DEFAULT_PART_COLORS.nose); // untouched keys keep defaults
  });

  it('mergePalette with no overrides equals the defaults', () => {
    expect(mergePalette()).toEqual(DEFAULT_PART_COLORS);
  });
});

describe('colorForType', () => {
  it('maps grouped component types to their group colour', () => {
    expect(colorForType('nosecone')).toBe(DEFAULT_PART_COLORS.nose);
    expect(colorForType('transition')).toBe(DEFAULT_PART_COLORS.nose);
    expect(colorForType('bodytube')).toBe(DEFAULT_PART_COLORS.body);
    expect(colorForType('trapezoidfinset')).toBe(DEFAULT_PART_COLORS.fins);
    expect(colorForType('centeringring')).toBe(DEFAULT_PART_COLORS.rings);
    expect(colorForType('parachute')).toBe(DEFAULT_PART_COLORS.parachute);
    expect(colorForType('shockcord')).toBe(DEFAULT_PART_COLORS.streamer);
  });

  it('honours a supplied palette', () => {
    const palette = mergePalette({ body: '#abcdef' });
    expect(colorForType('bodytube', palette)).toBe('#abcdef');
  });

  it('falls back to UNKNOWN_PART_COLOR for an unmapped type', () => {
    expect(colorForType('rocket' as never)).toBe(UNKNOWN_PART_COLOR);
    expect(colorForType('stage' as never)).toBe(UNKNOWN_PART_COLOR);
  });
});
