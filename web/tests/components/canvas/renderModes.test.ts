import { describe, expect, it } from 'vitest';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { figureLooks } from '../../../src/services/design/appearance';
import { DEFAULT_PART_COLORS } from '../../../src/services/design/partColors';
import { drawnOpacity } from '../../../src/components/canvas/RocketModel';
import type { Piece } from '../../../src/components/canvas/rocketPieces';

/**
 * The two 3D view types taken from desktop's: Figure (`FigureRenderer`) and
 * Finished (`RealisticRenderer`).
 */

const node = (extra: Record<string, unknown>) => ({ type: 'bodytube', ...extra }) as unknown as ComponentNode;

describe('the Figure view', () => {
  it('draws the figure color, else the palette color of the type', () => {
    expect(figureLooks(node({ color: '#ff0000' })).outside.color).toBe('#ff0000');
    expect(figureLooks(node({})).outside.color).toBe(DEFAULT_PART_COLORS.body);
  });

  it('ignores the 3D appearance', () => {
    const looks = figureLooks(node({ color: '#ff0000', appearance: { paint: '#00ff00', alpha: 10, shine: 1 } }));
    expect(looks.outside).toEqual({ color: '#ff0000', shine: 40 / 128, opacity: 1 });
  });

  it('draws the inside at 70% of the color and the edges as the outside', () => {
    const looks = figureLooks(node({ color: '#c8641e' }));
    // 200, 100, 30 scaled by 0.7.
    expect(looks.inside.color).toBe('#8c4615');
    expect(looks.edges).toEqual(looks.outside);
  });

  it("takes an external part's shine from its finish, out of 128, and gives an internal part 20", () => {
    // FigureRenderer.getShine.
    const shine = (n: ComponentNode) => figureLooks(n).outside.shine * 128;
    expect(shine(node({ finish: 'rough' }))).toBeCloseTo(10, 9);
    expect(shine(node({ finish: 'unfinished' }))).toBeCloseTo(30, 9);
    expect(shine(node({}))).toBeCloseTo(40, 9);
    expect(shine(node({ finish: 'smooth' }))).toBeCloseTo(80, 9);
    expect(shine(node({ finish: 'polished' }))).toBeCloseTo(128, 9);
    // A finish 24.12's switch has no case for.
    expect(shine(node({ finish: 'mirror' }))).toBeCloseTo(100, 9);
    expect(shine({ type: 'centeringring', finish: 'polished' } as unknown as ComponentNode)).toBeCloseTo(20, 9);
  });
});

describe('what each view lets show through', () => {
  const look = { color: '#ffffff', shine: 0, opacity: 1 };
  const shell = { translucent: true } as Piece;
  const mount = { innerGlass: true } as Piece;
  const fin = {} as Piece;

  it('layers the airframe in the Figure view', () => {
    expect(drawnOpacity(shell, look, true)).toBe(0.55);
    expect(drawnOpacity(mount, look, true)).toBe(0.5);
    expect(drawnOpacity(fin, look, true)).toBe(1);
  });

  it('draws everything solid in the Finished view but what is painted see-through', () => {
    expect(drawnOpacity(shell, look, false)).toBe(1);
    expect(drawnOpacity(mount, look, false)).toBe(1);
    expect(drawnOpacity(shell, { ...look, opacity: 0.4 }, false)).toBe(0.4);
  });
});
