// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { AftView } from '../../../src/components/canvas/AftView';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * In a pane wider than it is tall the aft view's square viewBox is
 * letterboxed: SVG's default `preserveAspectRatio="xMidYMid meet"` scales it
 * by the smaller of the two ratios and centers it (SVG 1.1, 7.8). The wheel
 * zooms about the drawing point under the pointer, and a drag pans the drawing
 * by as much as the pointer moved over it. jsdom lays nothing out, so the box
 * and the screen matrix the browser would compute for that box are given
 * here, the matrix from the spec's formula.
 */

const tree = {
  name: 'T',
  components: [
    {
      type: 'stage',
      id: 'stage',
      children: [
        { type: 'nosecone', id: 'nose', length: 0.1, aftRadius: 0.024, thickness: 0.002, shape: 'ogive' },
        { type: 'bodytube', id: 'body', length: 0.3, outerRadius: 0.024, thickness: 0.0015 },
      ],
    },
  ],
} as unknown as RocketTree;

const BOX = { left: 50, top: 20, width: 600, height: 300 };

beforeEach(() => {
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...BOX,
    right: BOX.left + BOX.width,
    bottom: BOX.top + BOX.height,
    x: BOX.left,
    y: BOX.top,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The view, with the screen matrix `xMidYMid meet` gives its viewBox in BOX. */
function view() {
  renderWithProviders(<AftView tree={tree} />);
  const svg = screen.getByRole('group', { name: /aft/i }) as unknown as SVGSVGElement;
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number) as [number, number, number, number];
  const k = Math.min(BOX.width / vw, BOX.height / vh);
  const e = BOX.left + (BOX.width - vw * k) / 2 - vx * k;
  const f = BOX.top + (BOX.height - vh * k) / 2 - vy * k;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: k, b: 0, c: 0, d: k, e, f }) });
  /** A client point in viewBox units, through that matrix. */
  const toViewBox = (cx: number, cy: number) => [(cx - e) / k, (cy - f) / k] as const;
  return { svg, k, toViewBox };
}

/** The pan/zoom group's translate and scale. */
function zoomOf(svg: Element) {
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(
    svg.querySelector('g[transform]')!.getAttribute('transform')!,
  )!;
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
}

describe('the aft view in a wide pane', () => {
  it('zooms about the drawing point under the pointer', () => {
    const { svg, toViewBox } = view();
    // Right of center, inside the letterboxed square.
    const [cx, cy] = [420, 120];
    const [px, py] = toViewBox(cx, cy);
    const before = zoomOf(svg);
    const under = [(px - before.x) / before.k, (py - before.y) / before.k];
    fireEvent.wheel(svg, { deltaY: -100, clientX: cx, clientY: cy });
    const after = zoomOf(svg);
    expect(after.k).toBeGreaterThan(before.k);
    expect((px - after.x) / after.k).toBeCloseTo(under[0]!, 9);
    expect((py - after.y) / after.k).toBeCloseTo(under[1]!, 9);
  });

  it('pans by as far as the pointer moved over the drawing', () => {
    const { svg, k } = view();
    fireEvent.click(screen.getByLabelText(/^Zoom in/));
    const before = zoomOf(svg);
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 340, clientY: 170, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 340, clientY: 170, pointerId: 1 });
    const after = zoomOf(svg);
    expect(after.x - before.x).toBeCloseTo(40 / k, 9);
    expect(after.y - before.y).toBeCloseTo(20 / k, 9);
  });
});
