import { describe, expect, it } from 'vitest';
import { keyPan } from '../../../src/components/canvas/keyPan';
import { ZOOM_IDENTITY } from '../../../src/tree/schematicGeometry';

/** Arrow keys pan a zoomed schematic the way a drag toward the other side would. */
describe('keyPan', () => {
  const zoomed = { k: 2, x: 0, y: 0 };

  it('brings the side the arrow points at into view', () => {
    expect(keyPan(zoomed, 'ArrowLeft', false, 100)).toEqual({ k: 2, x: 10, y: 0 });
    expect(keyPan(zoomed, 'ArrowRight', false, 100)).toEqual({ k: 2, x: -10, y: 0 });
    expect(keyPan(zoomed, 'ArrowUp', false, 100)).toEqual({ k: 2, x: 0, y: 10 });
    expect(keyPan(zoomed, 'ArrowDown', false, 100)).toEqual({ k: 2, x: 0, y: -10 });
  });

  it('takes a larger step with Shift', () => {
    expect(keyPan(zoomed, 'ArrowLeft', true, 100)!.x).toBe(50);
  });

  it('leaves the fitted view and other keys alone', () => {
    expect(keyPan(ZOOM_IDENTITY, 'ArrowLeft', false, 100)).toBeNull();
    expect(keyPan(zoomed, 'Enter', false, 100)).toBeNull();
  });
});
