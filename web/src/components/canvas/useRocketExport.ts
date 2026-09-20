import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import {
  IMAGE_FORMAT_EXT,
  snapshotWithHeader,
  type ExportData,
  type ImageFormat,
} from '../../services/schematicExport.js';
import { download, safeFilename } from '../../services/saveFile';
import type { ImageExportOptions } from './ImageExportMenu.js';
import { piecesBounds, type Piece } from './rocketPieces';
import { exportCamera, isFittableBox } from './rocketExportCamera';
import { captureSceneOffscreen } from './offscreenCapture';
import { clampExportSize } from './offscreenRaster';

/**
 * Owns the 3D image export handler: the export camera choice, the offscreen
 * render-target capture with its live-canvas fallback, and the header/encode/
 * download tail. Rocket3D hands it the R3F handles and the current pieces
 * and wires the returned `snapshot` to the export menu.
 */

/** What the export needs off the R3F canvas, captured in `onCreated`. */
export interface R3fHandles {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  setFrameloop: (mode: 'always' | 'demand' | 'never') => void;
}

export function useRocketExport(
  r3f: RefObject<R3fHandles | null>,
  pieces: Piece[],
  maxR: number,
  exportData: Omit<ExportData, 'spanM'> | undefined,
): (format: ImageFormat, widthPx: number, opts?: ImageExportOptions) => Promise<void> {
  // Live while the owning component is mounted; read by the fallback's
  // restore step. Set in the effect body as well as cleared in its cleanup:
  // under React.StrictMode's development double-invoke the cleanup runs once
  // before the effect re-runs, and a cleanup-only guard stayed false for good.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return async (format: ImageFormat, widthPx: number, opts?: ImageExportOptions) => {
    const st = r3f.current;
    if (!st || !exportData) return;
    const el = st.gl.domElement;
    const cssW = el.clientWidth || el.width || 1;
    const cssH = el.clientHeight || el.height || 1;
    // Same aspect as the view on screen, clamped to what the GPU will give a
    // render target (see clampExportSize for why that clamp exists).
    const { width, height } = clampExportSize(widthPx, cssW / cssH, st.gl.capabilities.maxTextureSize);

    // Auto-fit (Eric, 12 Aug 2026). His real 8K export has the rocket filling
    // roughly a fifth of the frame, so four fifths of those pixels are
    // background. Trimming to content AFTER the render cannot fix that — it
    // throws pixels away, so an "8K" export of a small on-screen rocket yields
    // far fewer than 8K pixels OF ROCKET. Moving the camera in BEFORE the
    // hi-res render lands the full requested resolution on the subject; trim
    // is the weaker half of the same idea.
    //
    // The fit renders through a THROWAWAY camera instead of moving the live
    // one and restoring it. OrbitControls owns the on-screen camera and
    // re-derives its state from it every frame, and the hi-res encode below
    // takes long enough (seconds, at 8K) for plenty of frames to land — a
    // mutate/restore pair would flash a jumped view at the user and risks
    // leaving the controls desynced if the capture throws. A throwaway cannot
    // desync: there is nothing to put back. Building it fresh rather than
    // cloning also guarantees a clean projection (no inherited zoom or view
    // offset). spanM stays 2*maxR: framing moves the camera, never the rocket.
    const src = st.camera as THREE.PerspectiveCamera;
    const box = opts?.fit && src.isPerspectiveCamera ? piecesBounds(pieces) : null;
    const cam: THREE.Camera = box && isFittableBox(box) ? exportCamera(box, src, width / height) : st.camera;
    const data: ExportData = { ...exportData, spanM: 2 * maxR };
    const filename = `${safeFilename(exportData.name)}-3d.${IMAGE_FORMAT_EXT[format]}`;

    // Preferred path: an offscreen render target. The on-screen canvas is
    // never resized, so nothing flashes, the frame loop keeps running, and
    // there is nothing to restore if the encode throws or the view unmounts
    // mid-export. It is synchronous, so the `alive` guard is not needed here.
    let offscreen: HTMLCanvasElement | null = null;
    try {
      offscreen = captureSceneOffscreen(st.gl, st.scene, cam, width, height);
    } catch (err) {
      // The GPU refused a target of this size or format (renderbuffer limit,
      // float attachment unsupported, context lost). Say why, then take the
      // slower on-screen path rather than fail the export.
      console.warn('3D export: offscreen capture failed, falling back to the live canvas', err);
    }
    if (offscreen) {
      download(filename, await snapshotWithHeader(offscreen, data, format));
      return;
    }

    // Fallback (the original export): re-render the SAME scene at the export
    // size through the LIVE renderer (updateStyle=false keeps the on-screen
    // CSS size), grab the buffer, then restore — preserveDrawingBuffer on the
    // canvas makes the read reliable.
    const pr = st.gl.getPixelRatio();
    try {
      // The LIVE renderer is resized for the encode, and an 8K encode takes
      // seconds. With the frame loop left running, R3F kept rendering the
      // on-screen camera into the resized buffer underneath the capture (and
      // OrbitControls kept damping into it), so a frame could land between
      // our render and the readback. Freezing the loop for the duration makes
      // the export frame the only frame; `finally` restores it.
      st.setFrameloop('never');
      st.gl.setPixelRatio(1);
      st.gl.setSize(width, height, false);
      st.gl.render(st.scene, cam);
      download(filename, await snapshotWithHeader(el, data, format));
    } finally {
      // Switching away from the 3D view, or an edit remounting the canvas,
      // disposes the renderer underneath it - and restoring a disposed
      // WebGLRenderer threw out of the `finally`, which surfaced as an
      // unhandled rejection and lost the "export failed" signal entirely.
      // TreeSchematic routes its export errors to `onError`; this had no such
      // channel, so at minimum it must not make things worse.
      if (alive.current && r3f.current === st) {
        st.gl.setPixelRatio(pr);
        st.gl.setSize(cssW, cssH, false);
        st.gl.render(st.scene, st.camera);
        st.setFrameloop('always');
      }
    }
  };
}
