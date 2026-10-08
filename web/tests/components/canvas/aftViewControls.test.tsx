// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { AftView } from '../../../src/components/canvas/AftView';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * No inert controls on the aft view.
 *
 * At the default view, zoom-out and fit are both no-ops: `zoomBy` clamps the
 * scale at 1, and fit sets the view to `ZOOM_IDENTITY`, which is what it already
 * is. Like `SchematicControls`, the aft view disables them there, so no button
 * looks clickable and does nothing.
 *
 * Driven through the real buttons rather than asserted against the component's
 * internals: `disabled` is what the user can see.
 */
afterEach(cleanup);

/** A one-tube rocket: enough for the view to draw something to zoom. */
const tree = {
  name: 'T',
  components: [
    {
      type: 'stage',
      id: 'stage',
      children: [{ type: 'bodytube', id: 'body', length: 0.3, outerRadius: 0.024, thickness: 0.0015 }],
    },
  ],
} as unknown as RocketTree;

const view = () => renderWithProviders(<AftView tree={tree} />);

/**
 * By aria-label, as a screen reader would find it. `schematic.zoomIn` carries the
 * wheel/pan hint in its text, so match on the start of it rather than pinning a
 * sentence that is free to be reworded.
 */
const btn = (label: string | RegExp) => screen.getByLabelText(label) as HTMLButtonElement;
const ZOOM_IN = /^Zoom in/;
const ZOOM_OUT = /^Zoom out$/;
const FIT = /^Fit to view$/;

describe('the aft view gates its zoom controls', () => {
  it('starts with zoom-out and fit disabled, and zoom-in live', () => {
    view();
    expect(btn(ZOOM_OUT).disabled).toBe(true);
    expect(btn(FIT).disabled).toBe(true);
    expect(btn(ZOOM_IN).disabled).toBe(false);
  });

  it('enables both the moment the view is actually zoomed', () => {
    view();
    fireEvent.click(btn(ZOOM_IN));
    expect(btn(ZOOM_OUT).disabled).toBe(false);
    expect(btn(FIT).disabled).toBe(false);
  });

  it('disables them again once fit returns to the default view', () => {
    view();
    fireEvent.click(btn(ZOOM_IN));
    fireEvent.click(btn(FIT));
    expect(btn(ZOOM_OUT).disabled).toBe(true);
    expect(btn(FIT).disabled).toBe(true);
  });

  it('disables zoom-in at the ceiling the wheel shares', () => {
    view();
    // 1.5^n past 12: the clamp is the same `WHEEL_ZOOM.max` the wheel handler
    // uses, so the button cannot be left live at a scale the wheel refuses.
    for (let i = 0; i < 10; i++) {
      const b = btn(ZOOM_IN);
      if (b.disabled) break;
      fireEvent.click(b);
    }
    expect(btn(ZOOM_IN).disabled).toBe(true);
    // And the other two are still live there, because the view is zoomed.
    expect(btn(ZOOM_OUT).disabled).toBe(false);
    expect(btn(FIT).disabled).toBe(false);
  });
});

/** The lug's ring sits at the kernel's 2.2 mm radius when the node states none. */
describe('the aft view draws a keyless launch lug at the kernel size', () => {
  it('scales the lug against the tube by 2.2 mm to 24 mm', () => {
    const withLug = {
      name: 'T',
      components: [
        {
          type: 'stage',
          id: 'stage',
          children: [
            {
              type: 'bodytube',
              id: 'body',
              name: 'Body tube',
              length: 0.3,
              outerRadius: 0.024,
              thickness: 0.0015,
              children: [{ type: 'launchlug', id: 'lug', name: 'Lug' }],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const { container } = renderWithProviders(<AftView tree={withLug} />);
    const radiusOf = (title: string) => {
      const c = [...container.querySelectorAll('circle')].find(
        (el) => el.querySelector('title')?.textContent === title,
      );
      return Number(c?.getAttribute('r'));
    };
    expect(radiusOf('Lug') / radiusOf('Body tube')).toBeCloseTo(0.0022 / 0.024, 6);
  });
});

/**
 * A ring, coupler, bulkhead or engine block is sized as every other view sizes
 * it (discGeometry.discDims): its own radius, else the bore of the tube it sits
 * in, and it draws the ring's own bore.
 */
describe('the aft view sizes a centering ring the way the cut sheet does', () => {
  it('fills the bore of the tube and shows the ring bore', () => {
    const withRing = {
      name: 'T',
      components: [
        {
          type: 'stage',
          id: 'stage',
          children: [
            {
              type: 'bodytube',
              id: 'body',
              name: 'Body tube',
              length: 0.3,
              outerRadius: 0.024,
              thickness: 0.0015,
              children: [{ type: 'centeringring', id: 'cr', name: 'Ring', innerRadius: 0.01 }],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const { container } = renderWithProviders(<AftView tree={withRing} />);
    const radii = (title: string) =>
      [...container.querySelectorAll('circle')]
        .filter((el) => el.querySelector('title')?.textContent === title)
        .map((c) => Number(c.getAttribute('r')));
    const tube = radii('Body tube')[0]!;
    const ring = radii('Ring').sort((a, b) => b - a);
    expect(ring).toHaveLength(2);
    expect(ring[0]! / tube).toBeCloseTo(0.0225 / 0.024, 6);
    expect(ring[1]! / tube).toBeCloseTo(0.01 / 0.024, 6);
  });
});

/** A cleared Name field writes `name: ''`; the part is still titled by its type. */
describe('the aft view titles an empty-named part by its type', () => {
  it('does not draw a blank title', () => {
    const blank = {
      name: 'T',
      components: [
        {
          type: 'stage',
          id: 'stage',
          children: [{ type: 'bodytube', id: 'body', name: '', length: 0.3, outerRadius: 0.024, thickness: 0.0015 }],
        },
      ],
    } as unknown as RocketTree;
    const { container } = renderWithProviders(<AftView tree={blank} />);
    const titles = [...container.querySelectorAll('circle title')].map((el) => el.textContent);
    expect(titles).toContain('Body tube');
    expect(titles).not.toContain('');
  });
});
