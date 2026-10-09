// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { FlightResult, RocketTree } from '../../../src/engine/openRocketEngine';
import { renderWithProviders } from '../../testing/renderWithProviders';

// The WebGL scene is not what this checks, and jsdom has no WebGL: the canvas
// renders nothing, so only the HTML controls around it mount.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => null,
  useFrame: () => {},
  useThree: () => ({}),
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, Line: () => null, Html: () => null }));

const { FlightPath3D } = await import('../../../src/components/canvas/FlightPath3D');

afterEach(cleanup);

const result = {
  summary: { timeToApogee: 2 },
  events: [],
  series: {
    time: [0, 1, 2, 3, 4],
    altitude: [0, 50, 80, 50, 0],
    velocity: [0, 40, 0, -20, -5],
    Px: [0, 1, 2, 3, 4],
    Py: [0, 1, 2, 3, 4],
  },
} as unknown as FlightResult;
const tree = { name: 'T', components: [] } as unknown as RocketTree;

/** Whether a pointer can reach `el`: the nearest ancestor that sets pointer-events decides. */
const pointerReachable = (el: Element): boolean => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.classList.contains('pointer-events-auto')) return true;
    if (n.classList.contains('pointer-events-none')) return false;
  }
  return true;
};

describe('3D flight path controls', () => {
  it('lets a pointer reach the phase-color swatches', () => {
    renderWithProviders(<FlightPath3D result={result} tree={tree} />);
    const swatches = document.querySelectorAll('input[type="color"], label input');
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    for (const s of swatches) expect(pointerReachable(s)).toBe(true);
  });

  it('names the playback slider and the speed select', () => {
    renderWithProviders(<FlightPath3D result={result} tree={tree} />);
    expect(screen.getByRole('slider').getAttribute('aria-label')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Playback speed' })).toBeTruthy();
  });
});
