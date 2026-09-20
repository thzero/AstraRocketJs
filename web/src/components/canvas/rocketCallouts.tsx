import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

/**
 * Owns the annotation primitives of the 3D view: the OpenRocket-style CG/CP
 * marker texture, the billboard label texture and sprite, and the on-axis
 * callout (marker + dashed leader + label). Scene components only; the
 * stability-specific CP row is composed from these in StabilityCallout.tsx.
 */

/**
 * OpenRocket-style CG/CP symbol as a billboard texture — a quartered circle
 * (two opposite quadrants colored, two white) with a colored rim. Drawn to a
 * canvas so a <sprite> can always face the camera instead of a 3D ball.
 */
export function markerTexture(color: string): THREE.CanvasTexture {
  const s = 128;
  const cvs = document.createElement('canvas');
  cvs.width = s;
  cvs.height = s;
  const ctx = cvs.getContext('2d')!;
  const cx = s / 2,
    cy = s / 2,
    r = s / 2 - 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, (i * Math.PI) / 2, (i * Math.PI) / 2 + Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? color : '#ffffff';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cvs);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Canvas-texture for a billboard label. Drawn at 3× the nominal glyph size so
 * it stays devicePixel-sharp when zoomed; the thin dark outline keeps the ink
 * legible over the light band of the dusk background.
 */
function labelTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const px = 96;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `700 ${px}px system-ui, 'Segoe UI', sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + px * 0.3);
  const h = Math.ceil(px * 1.25);
  canvas.width = w;
  canvas.height = h; // resizing resets the 2D context state — restyle below
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = px * 0.14;
  ctx.strokeStyle = 'rgba(10, 15, 22, 0.9)';
  ctx.strokeText(text, px * 0.15, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, px * 0.15, h / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: w / h };
}

/**
 * Billboard text beside a gadget sphere. The sprite `center` shifts it in
 * SCREEN space by `gap` (world units), so every label hangs the same distance
 * from its anchor at any camera angle — a world-space offset would swing
 * around with the orbit. `place` splits the three labels vertically: CG and
 * CP sit almost on one line, so hanging all three to the right piles them up
 * exactly when the margin is small — the case that matters most.
 */
export function CalloutLabel({
  text,
  color,
  position,
  height,
  gap,
  place = 'right',
}: {
  text: string;
  color: string;
  position: [number, number, number];
  height: number;
  gap: number;
  place?: 'right' | 'left' | 'above' | 'below';
}) {
  const { texture, aspect } = useMemo(() => labelTexture(text, color), [text, color]);
  // The JSX-declared material is R3F-disposed on unmount; its map is ours.
  useEffect(() => () => texture.dispose(), [texture]);
  const center = useMemo(
    () =>
      place === 'above'
        ? new THREE.Vector2(0.5, -(gap / height))
        : place === 'below'
          ? new THREE.Vector2(0.5, 1 + gap / height)
          : place === 'left'
            ? new THREE.Vector2(1 + gap / (height * aspect), 0.5)
            : new THREE.Vector2(-(gap / (height * aspect)), 0.5),
    [place, gap, height, aspect],
  );
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} center={center} renderOrder={13}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}

/**
 * CG/CP callout with 2D semantics: a small quartered-circle marker on the axis
 * station, a dashed leader out past the rocket (CG up, CP down), and the label
 * in the clear at the leader's end. Mirrors TreeSchematic's leader-line lanes.
 */
export function AxisCallout({
  x,
  dir,
  color,
  tex,
  label,
  len,
  markerR,
}: {
  x: number;
  dir: 1 | -1;
  color: string;
  tex: THREE.Texture;
  label: string;
  len: number;
  markerR: number;
}) {
  // drei's Line rebuilds its geometry whenever `points` changes identity, so
  // the leader is memoized rather than written as a literal per render.
  const { end, points } = useMemo(() => {
    const e: [number, number, number] = [x, dir * len, 0];
    return { end: e, points: [[x, 0, 0] as [number, number, number], e] };
  }, [x, dir, len]);
  return (
    <>
      <sprite position={[x, 0, 0]} scale={[markerR * 0.5, markerR * 0.5, 1]} renderOrder={12}>
        <spriteMaterial map={tex} depthTest={false} transparent />
      </sprite>
      <Line
        points={points}
        color={color}
        lineWidth={1.4}
        dashed
        dashSize={len * 0.09}
        gapSize={len * 0.06}
        depthTest={false}
        transparent
        renderOrder={12}
      />
      <CalloutLabel
        text={label}
        color={color}
        place={dir === 1 ? 'above' : 'below'}
        position={end}
        height={markerR * 0.52}
        gap={markerR * 0.3}
      />
    </>
  );
}
