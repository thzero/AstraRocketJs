/**
 * Owns the pure arithmetic of the offscreen 3D image export: the export-size
 * clamp against the renderer's texture limit, and the bottom-up row copy that
 * turns a WebGL pixel readback into ImageData rows. Nothing here touches
 * WebGL, and only `pixelsToCanvas` touches the DOM, so the numbers are unit
 * tested; the GPU side lives in offscreenCapture.ts.
 */

export interface ExportSize {
  width: number;
  height: number;
}

/**
 * The render-target size for a requested export width and aspect, clamped to
 * what the GPU can allocate. A WebGLRenderTarget is a texture, so its edges
 * are bound by MAX_TEXTURE_SIZE (`renderer.capabilities.maxTextureSize`):
 * 8192 on a lot of integrated and mobile GPUs, 16384 on most discrete ones.
 * The 7680 px "8K" preset already sits under the common floor, but a wider
 * on-screen aspect or a future preset would not, and an oversized target
 * fails at framebuffer setup with nothing useful in the console. Both edges
 * scale down together so the export keeps the on-screen aspect; the header
 * band is laid on afterwards and scales with whatever width comes out.
 *
 * @param aspect width / height of the frame to export (the on-screen canvas).
 */
export function clampExportSize(widthPx: number, aspect: number, maxTextureSize: number): ExportSize {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let width = Math.max(1, Math.round(Number.isFinite(widthPx) ? widthPx : 1));
  let height = Math.max(1, Math.round(width / a));
  // A missing or nonsense limit (a stubbed renderer, a lost context reporting
  // 0) means no clamp rather than a 1 px export.
  const max = Number.isFinite(maxTextureSize) && maxTextureSize >= 1 ? Math.floor(maxTextureSize) : Infinity;
  const over = Math.max(width, height) / max;
  if (over > 1) {
    width = Math.max(1, Math.floor(width / over));
    height = Math.max(1, Math.floor(height / over));
  }
  return { width, height };
}

/**
 * WebGL's readPixels hands rows back bottom-up (origin at the lower-left);
 * ImageData wants them top-down. Copy row by row into a fresh clamped array,
 * last row first. Alpha is passed through untouched: the capture pass already
 * divided the premultiplied color out, so what arrives here is straight RGBA,
 * exactly what `putImageData` expects.
 */
export function flipRows(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const rowBytes = width * 4;
  const expected = rowBytes * height;
  if (pixels.length !== expected) {
    throw new RangeError(`flipRows: expected ${expected} bytes for ${width}x${height}, got ${pixels.length}`);
  }
  const out = new Uint8ClampedArray(expected);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes;
    out.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  return out;
}

/**
 * A 2D canvas holding a WebGL readback, the right way up. This is the ONLY
 * DOM touch on the export path before the header/encode step, and the canvas
 * it returns is an ordinary HTMLCanvasElement, so `snapshotWithHeader` draws
 * it exactly as it drew the live WebGL canvas.
 */
export function pixelsToCanvas(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pixelsToCanvas: 2D canvas context unavailable');
  const image = ctx.createImageData(width, height);
  image.data.set(flipRows(pixels, width, height));
  ctx.putImageData(image, 0, 0);
  return canvas;
}
