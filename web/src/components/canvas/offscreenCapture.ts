// cspell:ignore glsl Reinhard Cineon MSAA tonemapping OETF
import * as THREE from 'three';
import { pixelsToCanvas } from './offscreenRaster';

/**
 * Owns the GPU side of the offscreen 3D image export: render the scene into a
 * WebGLRenderTarget of the export size, run the renderer's tone mapping and
 * output color space over it in a second full-frame pass, read the bytes back
 * and hand them to the 2D-canvas step in offscreenRaster.ts. The on-screen
 * drawing buffer is never resized, frozen or redrawn.
 *
 * Why the second pass: three applies tone mapping and the output transfer
 * function ONLY when the render target is the canvas (WebGLPrograms picks
 * NoToneMapping and the linear working space for any other target). A single
 * render into a target therefore comes back linear and un-tone-mapped, and
 * the export would be visibly brighter and flatter than the view on screen.
 * The pass below is what three's own OutputPass does, minus the addon import.
 *
 * WebGL cannot run under vitest, so this file is unverified by unit tests;
 * the size clamp and the row flip are proven in offscreenRaster.test.ts.
 */

/** three's GLSL function per `renderer.toneMapping`, the same table
 *  WebGLProgram uses to bind `toneMapping()` for the canvas. */
const TONE_MAPPING_FN: Partial<Record<THREE.ToneMapping, string>> = {
  [THREE.LinearToneMapping]: 'LinearToneMapping',
  [THREE.ReinhardToneMapping]: 'ReinhardToneMapping',
  [THREE.CineonToneMapping]: 'CineonToneMapping',
  [THREE.ACESFilmicToneMapping]: 'ACESFilmicToneMapping',
  [THREE.AgXToneMapping]: 'AgXToneMapping',
  [THREE.NeutralToneMapping]: 'NeutralToneMapping',
  [THREE.CustomToneMapping]: 'CustomToneMapping',
};

/** MSAA sample count for the scene target: matches the antialiased canvas
 *  R3F creates, so exported edges are no rougher than on-screen ones. */
const SAMPLES = 4;

/**
 * The full-frame material for the output pass. `tonemapping_pars_fragment`
 * is included by hand because three only prepends it when the target is the
 * canvas; `colorspace_pars_fragment` (sRGBTransferOETF) is in every fragment
 * prefix. Alpha is un-premultiplied FIRST: the scene pass blends straight
 * alpha over a cleared (0,0,0,0) target, leaving premultiplied color in the
 * buffer, and the browser reads the on-screen canvas the same way. Tone
 * mapping the straight color, then storing straight RGBA, is what makes the
 * translucent shell composite onto the white export background the way it
 * composites on screen.
 */
function outputPassMaterial(renderer: THREE.WebGLRenderer, source: THREE.Texture): THREE.ShaderMaterial {
  const fn = TONE_MAPPING_FN[renderer.toneMapping];
  const srgb = renderer.outputColorSpace === THREE.SRGBColorSpace;
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: source },
      toneMappingExposure: { value: renderer.toneMappingExposure },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      #include <tonemapping_pars_fragment>
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        c.rgb /= max(c.a, 1e-5);
        ${fn ? `c.rgb = ${fn}(c.rgb);` : ''}
        ${srgb ? 'c = sRGBTransferOETF(c);' : ''}
        gl_FragColor = c;
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

/** Throw with the GL status when the bound framebuffer cannot be drawn to,
 *  so a target the GPU refuses (over its renderbuffer limit, an unsupported
 *  float format) surfaces as a catchable error instead of a silent black
 *  frame plus a console line from three. */
function assertFramebufferComplete(gl: WebGLRenderingContext | WebGL2RenderingContext, what: string): void {
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`offscreen capture: ${what} framebuffer incomplete (GL status 0x${status.toString(16)})`);
  }
}

/**
 * Render `scene` through `camera` at `width` x `height` and return a 2D canvas
 * holding the frame, right way up, straight alpha, tone mapped and encoded
 * the way the on-screen canvas is. Synchronous: the whole thing happens
 * inside one JS turn, so the live frame loop cannot interleave a frame and
 * the renderer cannot be disposed out from under it. Every GPU object it
 * allocates is released in `finally`, including on a throw, and the
 * renderer's current target is put back. Throws when the GPU refuses a
 * target; the caller falls back to the live canvas.
 */
export function captureSceneOffscreen(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): HTMLCanvasElement {
  const gl = renderer.getContext();
  // Half-float keeps the scene pass at GPU precision into the tone mapper;
  // an 8-bit linear target would band the darks once encoded to sRGB. Only
  // when the context can render to a float attachment, else 8-bit linear.
  const floatOk =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const sceneTarget = new THREE.WebGLRenderTarget(width, height, {
    samples: SAMPLES,
    type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  // The encoded target holds the bytes the output pass wrote, already sRGB;
  // it is declared linear so three does not ask the GPU to encode them again.
  const encodedTarget = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  const material = outputPassMaterial(renderer, sceneTarget.texture);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const passScene = new THREE.Scene();
  passScene.add(quad);
  // The vertex shader ignores the camera; three just needs one to render.
  const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prevTarget = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(sceneTarget);
    assertFramebufferComplete(gl, 'scene');
    renderer.render(scene, camera);

    renderer.setRenderTarget(encodedTarget);
    assertFramebufferComplete(gl, 'output');
    renderer.render(passScene, passCamera);

    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(encodedTarget, 0, 0, width, height, pixels);
    return pixelsToCanvas(pixels, width, height);
  } finally {
    renderer.setRenderTarget(prevTarget);
    quad.geometry.dispose();
    material.dispose();
    sceneTarget.dispose();
    encodedTarget.dispose();
  }
}
