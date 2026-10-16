// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotWithHeader, svgToImage } from '../../../src/services/exports/schematicExport';
import { pixelsToCanvas } from '../../../src/services/exports/offscreenRaster';
import { KeyedError } from '../../../src/i18n/keyedError';

/**
 * An image that "loads" as soon as its source is set, so the rasterizer's
 * onload runs without a real decoder.
 */
class LoadingImage {
  naturalWidth = 400;
  naturalHeight = 100;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('svgToImage on a canvas the browser will not allocate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const setup = (getContext: () => unknown) => {
    vi.stubGlobal('Image', LoadingImage);
    const revoke = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      getContext as HTMLCanvasElement['getContext'],
    );
    return revoke;
  };

  it('rejects with a keyed error when the canvas has no 2D context, and releases the URL', async () => {
    const revoke = setup(() => null);
    const err = await svgToImage('<svg xmlns="http://www.w3.org/2000/svg"/>', 7680).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyedError);
    expect((err as KeyedError).key).toBe('errors.export.imageTooLarge');
    expect(revoke).toHaveBeenCalledWith('blob:svg');
  });

  it('rejects the same way when allocating the canvas throws', async () => {
    const revoke = setup(() => {
      throw new RangeError('canvas too large');
    });
    const err = await svgToImage('<svg xmlns="http://www.w3.org/2000/svg"/>', 7680).catch((e: unknown) => e);
    expect((err as KeyedError).key).toBe('errors.export.imageTooLarge');
    expect(revoke).toHaveBeenCalledWith('blob:svg');
  });
});

describe('the 3D compose step past the canvas limit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const data = {
    name: 'R',
    info: null,
    withMotors: false,
    appVersion: '1',
    t: (k: string) => k,
  } as unknown as Parameters<typeof snapshotWithHeader>[1];

  it('rejects with the keyed error when the composed canvas has no 2D context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const frame = Object.assign(document.createElement('canvas'), { width: 7680, height: 4320 });
    const err = await snapshotWithHeader(frame, data).catch((e: unknown) => e);
    expect((err as KeyedError).key).toBe('errors.export.imageTooLarge');
  });

  it('throws the keyed error from the readback canvas the same way', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let err: unknown;
    try {
      pixelsToCanvas(new Uint8Array(4), 1, 1);
    } catch (e) {
      err = e;
    }
    expect((err as KeyedError).key).toBe('errors.export.imageTooLarge');
  });
});
