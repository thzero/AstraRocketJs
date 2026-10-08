// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { hexOf, parseHexColor } from '../../../src/services/design/colorHex';
import { exportOrk } from '../../../src/services/files/orkFile';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * One reading of a hex color for every file and view (KML, 3MF, .ork). It
 * refuses a partial match rather than reading a hex prefix ("12zz" is not 0x12),
 * expands "#rgb" the same way for every writer, and leaves each caller only its
 * own fallback.
 */
describe('parseHexColor', () => {
  it('reads six digits, with or without the hash, in either case', () => {
    expect(parseHexColor('#ff8800')).toBe(0xff8800);
    expect(parseHexColor('FF8800')).toBe(0xff8800);
    expect(parseHexColor('  #ff8800  ')).toBe(0xff8800);
  });

  it('expands the CSS shorthand and drops an alpha byte', () => {
    expect(parseHexColor('#f80')).toBe(0xff8800);
    expect(parseHexColor('#ff8800cc')).toBe(0xff8800);
  });

  it('refuses anything else rather than reading part of it', () => {
    // "bad" is three hex digits, but the shorthand needs its '#'.
    for (const bad of ['', '#', '12zz', 'bad', '#12345', 'rebeccapurple', 'rgb(1,2,3)', null, undefined, 7]) {
      expect(parseHexColor(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('hexOf', () => {
  it('writes six lowercase digits, with the hash unless told not to', () => {
    expect(hexOf(0xff8800)).toBe('#ff8800');
    expect(hexOf(0x0a0b0c, false)).toBe('0a0b0c');
    expect(hexOf(0x1ff8800)).toBe('#ff8800');
  });
});

describe('a part color in a saved .ork', () => {
  it('keeps a shorthand color the 3MF writer already kept', () => {
    const tree = {
      name: 'C',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [{ type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.012, color: '#f80' }],
        },
      ],
    } as unknown as RocketTree;
    expect(exportOrk({ name: 'C', tree })).toContain('<color red="255" green="136" blue="0"/>');
  });
});
