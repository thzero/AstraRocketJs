// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { FreeformFinActions } from '../../../src/components/design/FreeformFinActions';
import { renderWithProviders } from '../../testing/renderWithProviders';
import * as saveFile from '../../../src/services/files/saveFile';
import { useWorkspaceStore } from '../../../src/state/store';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

const fin = {
  type: 'freeformfinset',
  id: 'ff',
  name: 'Fin set',
  points: [
    [0, 0],
    [0.04, 0.03],
    [0.06, 0],
  ],
} as unknown as ComponentNode;

afterEach(() => vi.restoreAllMocks());

/**
 * The fin outline download is named the way every export is (exportFilename):
 * rocket, part, what it is. A bare "Fin_set.csv" would say nothing about which
 * rocket, beside "Bertha-aero-table.csv" in the same downloads folder.
 */
describe('FreeformFinActions', () => {
  it('names the CSV after the rocket and the fin', () => {
    useWorkspaceStore.setState({ tree: { ...useWorkspaceStore.getState().tree, name: 'Bertha' } });
    const spy = vi.spyOn(saveFile, 'download').mockImplementation(() => {});
    renderWithProviders(<FreeformFinActions node={fin} />);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(spy.mock.calls[0]![0]).toBe('Bertha-Fin_set-points.csv');
  });

  it('caps the scale factor at desktop SCALE_MAX', () => {
    const applyTreeAction = vi.fn();
    useWorkspaceStore.setState({ applyTreeAction });
    renderWithProviders(<FreeformFinActions node={fin} />);
    fireEvent.change(screen.getByLabelText('Scale factor'), { target: { value: '1e300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const action = applyTreeAction.mock.calls[0]![0] as (t: unknown) => { components: ComponentNode[] };
    const scaled = action({ name: 'T', components: [fin] }).components[0]!;
    expect((scaled['points'] as number[][])[2]![0]).toBeCloseTo(6, 9);
  });

  it('decodes a large photo straight to the tracing size, closes every bitmap, and keeps one pixel one millimeter', async () => {
    const closes: string[] = [];
    const createImageBitmap = vi.fn(async (_src: unknown, opts?: { resizeWidth: number; resizeHeight: number }) =>
      opts
        ? { width: opts.resizeWidth, height: opts.resizeHeight, close: () => closes.push('small') }
        : { width: 6000, height: 3000, close: () => closes.push('full') },
    );
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const canvasSizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvasSizes.push([this.width, this.height]);
      return {
        drawImage: () => {},
        // A dark block over the left half of the bottom half: a fin on the root edge.
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4).fill(255);
          for (let y = h / 2; y < h; y++)
            for (let x = 0; x < w / 2; x++) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
          return { width: w, height: h, data };
        },
      } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext']);
    const applyTreeAction = vi.fn();
    useWorkspaceStore.setState({ applyTreeAction });
    renderWithProviders(<FreeformFinActions node={fin} />);
    fireEvent.change(screen.getByLabelText('Import from image'), {
      target: { files: [new File(['x'], 'fin.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(applyTreeAction).toHaveBeenCalled());
    expect(createImageBitmap.mock.calls[1]![1]).toMatchObject({ resizeWidth: 1200, resizeHeight: 600 });
    expect(canvasSizes).toEqual([[1200, 600]]);
    expect(closes.sort()).toEqual(['full', 'small']);
    const action = applyTreeAction.mock.calls[0]![0] as (t: unknown) => { components: ComponentNode[] };
    const pts = action({ name: 'T', components: [fin] }).components[0]!['points'] as number[][];
    // 3000 source pixels wide at one millimeter each, traced at a fifth of that.
    expect(Math.max(...pts.map((p) => p[0]!))).toBeCloseTo(3, 1);
    vi.unstubAllGlobals();
  });
});
