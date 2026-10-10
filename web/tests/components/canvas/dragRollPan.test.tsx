// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { AftView } from '../../../src/components/canvas/AftView';
import { TreeSchematic } from '../../../src/components/canvas/TreeSchematic';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * A drag on the 2D drawings: at the fitted view it rolls the rocket, and once
 * zoomed in it pans, so a part a wheel zoom left off screen can be dragged
 * back. A touch the OS cancels ends the gesture, so the next move without a
 * press neither pans nor rolls.
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

// jsdom lays nothing out; both views read the svg's box to turn pixels into
// their own units.
beforeEach(() => {
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 400,
    bottom: 400,
    width: 400,
    height: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const zoomIn = () => fireEvent.click(screen.getByLabelText(/^Zoom in/));
/** The pan/zoom group's transform, which a pan moves. */
const transform = (svg: Element) => svg.querySelector('g[transform]')!.getAttribute('transform');

const drag = (svg: Element, dx: number) => {
  fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: 100 + dx, clientY: 100, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: 100 + dx, clientY: 100, pointerId: 1 });
};

describe('aft view drag', () => {
  const view = (onRoll = vi.fn()) => {
    renderWithProviders(<AftView tree={tree} onRoll={onRoll} />);
    return { onRoll, svg: screen.getByRole('group', { name: /aft/i }) };
  };

  it('rolls at the fitted view', () => {
    const { onRoll, svg } = view();
    drag(svg, 40);
    expect(onRoll).toHaveBeenCalled();
  });

  it('pans once zoomed in, and leaves the roll alone', () => {
    const { onRoll, svg } = view();
    zoomIn();
    const before = transform(svg);
    drag(svg, 40);
    expect(onRoll).not.toHaveBeenCalled();
    expect(transform(svg)).not.toBe(before);
  });

  it('ends the gesture on a pointer cancel', () => {
    const { onRoll, svg } = view();
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 160, clientY: 100, pointerId: 1 });
    expect(onRoll).not.toHaveBeenCalled();
  });
});

describe('side view drag', () => {
  const view = (onRoll = vi.fn()) => {
    const { container } = renderWithProviders(<TreeSchematic tree={tree} info={null} onRoll={onRoll} />);
    return { onRoll, svg: container.querySelector('svg[aria-label]')! };
  };

  it('rolls at the fitted view', () => {
    const { onRoll, svg } = view();
    drag(svg, 40);
    expect(onRoll).toHaveBeenCalled();
  });

  it('pans once zoomed in, and leaves the roll alone', () => {
    const { onRoll, svg } = view();
    zoomIn();
    const before = transform(svg);
    drag(svg, 40);
    expect(onRoll).not.toHaveBeenCalled();
    expect(transform(svg)).not.toBe(before);
  });

  it('ends the gesture on a pointer cancel', () => {
    const { onRoll, svg } = view();
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 160, clientY: 100, pointerId: 1 });
    expect(onRoll).not.toHaveBeenCalled();
  });
});
