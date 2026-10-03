// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { AftView } from '../../../src/components/canvas/AftView';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * No inert controls on the aft view.
 *
 * At the default view, zoom-out and fit were both no-ops: `zoomBy` clamps the
 * scale at 1, and fit sets the view to `ZOOM_IDENTITY`, which is what it already
 * is. `SchematicControls` gates the equivalent three; this surface did not, so
 * two of its three buttons looked clickable and did nothing.
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
