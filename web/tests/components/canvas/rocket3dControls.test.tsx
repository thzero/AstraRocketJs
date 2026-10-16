// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, renderHook, screen } from '@testing-library/react';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import type { R3fHandles } from '../../../src/components/canvas/useRocketExport';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { KeyedError } from '../../../src/i18n/keyedError';

// No WebGL in jsdom: the canvas renders nothing, so only the HTML controls
// around it mount.
vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useFrame: () => {}, useThree: () => ({}) }));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, Bounds: () => null }));
// The CG/CP marker textures draw on a 2D canvas, which jsdom does not have.
vi.mock('../../../src/components/canvas/rocketCallouts', () => ({
  markerTexture: () => ({ dispose: () => {} }),
  AxisCallout: () => null,
}));
// By default the capture succeeds and the encode refuses, the way an 8K JPEG can.
let capture: () => HTMLCanvasElement = () => document.createElement('canvas');
vi.mock('../../../src/components/canvas/offscreenCapture', () => ({
  captureSceneOffscreen: () => capture(),
}));
vi.mock('../../../src/services/exports/schematicExport.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/exports/schematicExport.js')>()),
  snapshotWithHeader: () => Promise.reject(new Error('encode refused')),
}));

const { Rocket3D } = await import('../../../src/components/canvas/Rocket3D');
const { useRocketExport } = await import('../../../src/components/canvas/useRocketExport');

afterEach(cleanup);

const tree = { name: 'T', components: [] } as unknown as RocketTree;

describe('3D view presets', () => {
  it('say which one is active through aria-pressed, not color alone', () => {
    renderWithProviders(<Rocket3D tree={tree} info={null} />);
    const side = screen.getByRole('button', { name: 'Side' });
    const aft = screen.getByRole('button', { name: 'Aft' });
    expect(side.getAttribute('aria-pressed')).toBe('true');
    expect(aft.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(aft);
    expect(side.getAttribute('aria-pressed')).toBe('false');
    expect(aft.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('3D image export failure', () => {
  it('reaches the error channel instead of rejecting unhandled', async () => {
    const gl = {
      domElement: Object.assign(document.createElement('canvas'), { width: 100, height: 100 }),
      capabilities: { maxTextureSize: 4096 },
    };
    const r3f = { current: { gl, scene: {}, camera: {}, setFrameloop: () => {} } as unknown as R3fHandles };
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useRocketExport(r3f, [], 0.05, { name: 'T' } as Parameters<typeof useRocketExport>[3], onError),
    );
    await expect(result.current('png', 1920)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('encode refused');
  });

  it('reports a frame past the canvas limit without taking the live fallback', async () => {
    capture = () => {
      throw new KeyedError('errors.export.imageTooLarge');
    };
    try {
      const gl = {
        domElement: Object.assign(document.createElement('canvas'), { width: 100, height: 100 }),
        capabilities: { maxTextureSize: 8192 },
        getPixelRatio: vi.fn(() => 1),
      };
      const setFrameloop = vi.fn();
      const r3f = { current: { gl, scene: {}, camera: {}, setFrameloop } as unknown as R3fHandles };
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useRocketExport(r3f, [], 0.05, { name: 'T' } as Parameters<typeof useRocketExport>[3], onError),
      );
      await result.current('png', 7680);
      expect((onError.mock.calls[0]![0] as KeyedError).key).toBe('errors.export.imageTooLarge');
      expect(gl.getPixelRatio).not.toHaveBeenCalled();
      expect(setFrameloop).not.toHaveBeenCalled();
    } finally {
      capture = () => document.createElement('canvas');
    }
  });
});
