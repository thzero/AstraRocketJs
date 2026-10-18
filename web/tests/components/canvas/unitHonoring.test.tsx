// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { HorizontalCaliper, VerticalCaliper } from '../../../src/components/canvas/SchematicCalipers';
import { SchematicControls } from '../../../src/components/canvas/SchematicControls';
import { FlightPathExport } from '../../../src/components/canvas/FlightPathExport';
import type { ExportData } from '../../../src/services/exports/schematicExport';

// No WebGL in jsdom: the canvas renders nothing, so only the HTML around it mounts.
vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useFrame: () => {}, useThree: () => ({}) }));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, Bounds: () => null }));
// The CG/CP marker textures draw on a 2D canvas, which jsdom does not have; the
// ink each one is drawn with is what is observed.
const markerTexture = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ dispose: () => {} })));
vi.mock('../../../src/components/canvas/rocketCallouts', () => ({ markerTexture, AxisCallout: () => null }));

const { Rocket3D } = await import('../../../src/components/canvas/Rocket3D');
const { CenterCanvas } = await import('../../../src/components/canvas/CenterCanvas');

afterEach(() => {
  localStorage.clear();
  markerTexture.mockClear();
  document.documentElement.removeAttribute('style');
});

const tree = { name: 'T', components: [] } as unknown as RocketTree;
const exportData = {
  name: 'T',
  info: null,
  units: {},
  withMotors: false,
  appVersion: '0',
  t: (k: string) => k,
} as unknown as Omit<ExportData, 'spanM'>;

/**
 * Readouts and controls that follow the user's unit.
 *
 * The caliper tag is a length readout like the one in its handles' value text,
 * so it carries the length symbol.
 */
describe('the schematic caliper readouts', () => {
  const noop = () => () => {};
  const props = { cal: { a: 0, b: 0.5 }, ctx: { scale: 100, cy: 100, x0: 10 }, scale: 100, totalLen: 1 };

  it('carry the length symbol on the length span', () => {
    seedSettings({ units: { length: 'ft' } });
    const { container } = renderWithProviders(
      <svg>
        <HorizontalCaliper {...props} h={200} rBot={10} onDragStart={noop} onKey={noop} />
      </svg>,
    );
    // 0.5 m.
    expect(container.querySelector('text')?.textContent).toBe('1.64 ft');
  });

  it('carry the length symbol on the diameter span', () => {
    seedSettings({ units: { length: 'ft' } });
    const { container } = renderWithProviders(
      <svg>
        <VerticalCaliper {...props} vHalf={0.1} onDragStart={noop} onKey={noop} />
      </svg>,
    );
    expect(container.querySelector('text')?.textContent).toBe('1.64 ft');
  });
});

/**
 * The 2D roll slider steps in whole degrees; without a value text a screen
 * reader reads that raw number while the readout beside it is in radians.
 */
describe('the 2D roll slider', () => {
  it('carries the formatted angle as its value text', () => {
    seedSettings({ units: { angle: 'rad' } });
    useWorkspaceStore.setState({ view: '2d', roll: Math.PI / 2 });
    renderWithProviders(<CenterCanvas flight={null} pathResult={null} ctrlSlot={null} presetSlot={null} />);
    const slider = screen.getByRole('slider', { name: 'Roll angle (degrees)' });
    expect(slider.getAttribute('aria-valuetext')).toBe('1.57 rad');
  });
});

/**
 * A decorative glyph on a button stays out of its accessible name, or a screen
 * reader reads out the glyph's Unicode name before "SVG". Each one sits in an
 * aria-hidden span, and the image menu takes its glyph as an icon rather than in
 * the label.
 */
describe('button glyphs are not part of the name', () => {
  it('on the schematic SVG and image export buttons', () => {
    renderWithProviders(
      <SchematicControls
        svgRef={{ current: null }}
        exportData={exportData}
        scale={1}
        w={100}
        h={100}
        vHalf={0.1}
        totalLen={1}
        maxR={0.1}
        caliperH={null}
        caliperV={null}
        setCaliperH={() => {}}
        setCaliperV={() => {}}
        zoom={{ k: 1, x: 0, y: 0 } as never}
        setZoom={() => {}}
        zoomBy={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'SVG' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Image' })).toBeTruthy();
  });

  it('on the 3D image export button', () => {
    renderWithProviders(<Rocket3D tree={tree} info={null} exportData={exportData} />);
    expect(screen.getByRole('button', { name: 'Image' })).toBeTruthy();
  });

  it('on the flight path export button', () => {
    const flight = { id: 's1', name: 'Sim', result: { series: {}, events: [] }, launch: {} } as never;
    renderWithProviders(<FlightPathExport flight={flight} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });
});

/**
 * The 3D view's legend dot identifies its marker, so it is the marker's ink, from
 * the same shared token.
 */
describe('the 3D legend matches its markers', () => {
  it('draws each marker and its legend dot in the same ink', () => {
    document.documentElement.style.setProperty('--c-scene-cg', '#112233');
    document.documentElement.style.setProperty('--c-scene-cp', '#445566');
    renderWithProviders(<Rocket3D tree={tree} info={null} />);
    const inks = markerTexture.mock.calls.map((c) => c[0]);
    expect(inks).toContain('#112233');
    expect(inks).toContain('#445566');
    const dots = screen.getAllByText('●');
    expect(dots.map((d) => d.style.color)).toEqual(['var(--c-scene-cg)', 'var(--c-scene-cp)']);
    fireEvent.click(screen.getByRole('button', { name: 'Side' }));
  });
});
