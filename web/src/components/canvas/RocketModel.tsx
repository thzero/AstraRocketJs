import { useMemo } from 'react';
import * as THREE from 'three';
import { useHoverCursor } from '../common/useHoverCursor';
import type { Piece, RenderMode } from './rocketPieces';
import type { Look } from '../../services/design/appearance';
import { LookMaterial, surfacesOf } from './LookMaterial';
import { useSceneColors } from './sceneColors';

/**
 * Owns the rocket body in the 3D scene: one <mesh> per Piece with the
 * see-through layering, the selection glow and the click/hover wiring back to
 * the component tree. Geometry lifetime stays with whoever built the pieces.
 */
export function RocketModel({
  pieces,
  selectedId,
  onSelect,
  clip,
  mode = 'figure',
}: {
  pieces: Piece[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Cutaway: the half-space to keep. Applied to the airframe only (hull and
   *  inner tubes); what is inside them stays whole, so the view is a rocket
   *  with its side opened rather than a scene sliced in half. Nothing inside
   *  is cut, so there is no open cross-section to cap and no stencil pass. */
  clip?: THREE.Plane | null;
  /**
   * Desktop's 3D view type. Figure draws figure colors with the airframe
   * see-through, so what is inside it shows; Finished draws each part's
   * appearance, see-through only where its own opacity says so.
   */
  mode?: RenderMode;
}) {
  const scene = useSceneColors();
  const hoverCursor = useHoverCursor();
  // One array for every material: a new [plane] each render would reallocate
  // (and re-upload) uniforms on every frame the component re-renders.
  const planes = useMemo(() => (clip ? [clip] : null), [clip]);
  // A hit on the removed side of a clipped part is a hit on something nobody
  // can see: the raycaster does not know about clipping planes. Returning
  // without stopping propagation hands the event to the next intersection
  // (the far wall, or the mount behind it), which is the part actually under
  // the pointer.
  const hidden = (p: Piece, point: THREE.Vector3): boolean =>
    !!clip && (!!p.translucent || !!p.innerGlass) && clip.distanceToPoint(point) < 0;
  return (
    <>
      {pieces.map((p) => {
        const selected = !!p.id && p.id === selectedId;
        // Cut parts go opaque: the see-through tiers exist to show what is
        // inside a closed shell, and once the shell is open they only make the
        // internals muddier.
        const cut = !!planes && (!!p.translucent || !!p.innerGlass);
        const layered = mode === 'figure' && !selected && !cut;
        return (
          <mesh
            key={p.key}
            geometry={p.geometry}
            position={p.position ?? [0, 0, 0]}
            rotation={p.rotation ?? [0, 0, 0]}
            renderOrder={selected ? 3 : p.translucent ? 2 : p.innerGlass ? 1 : 0}
            onClick={
              p.id && onSelect
                ? (e) => {
                    if (hidden(p, e.point)) return;
                    e.stopPropagation();
                    onSelect(p.id!);
                  }
                : undefined
            }
            onPointerOver={
              p.id && onSelect
                ? (e) => {
                    if (hidden(p, e.point)) return;
                    e.stopPropagation();
                    hoverCursor(true);
                  }
                : undefined
            }
            onPointerOut={p.id && onSelect ? () => hoverCursor(false) : undefined}
          >
            {/* See-through layering: opaque pieces (motor, fins) first, then
                  glassy inner tubes, then the shell. Depth writes are off for
                  both see-through tiers (with them on, a translucent shell reads
                  as opaque) so each layer shows through
                  the ones over it; DoubleSide draws far walls for depth. A
                  selected part takes the theme's scene-selected color and glow and
                  turns opaque so it reads. The layering is the Figure view's;
                  Finished draws a part as opaque as its own opacity. */}
            {surfacesOf(p, mode).map(([attach, look]) => {
              const opacity = selected ? 1 : drawnOpacity(p, look, layered);
              const seeThrough = opacity < 1;
              return (
                <LookMaterial
                  key={attach}
                  attach={attach}
                  look={selected ? { ...look, color: scene['scene-selected'] } : look}
                  emissive={selected ? scene['scene-selected-glow'] : '#000000'}
                  emissiveIntensity={selected ? 0.6 : 0}
                  transparent={seeThrough}
                  opacity={opacity}
                  depthWrite={!seeThrough}
                  side={cut || (layered && (p.translucent || p.innerGlass)) ? THREE.DoubleSide : THREE.FrontSide}
                  clippingPlanes={cut ? planes : null}
                />
              );
            })}
          </mesh>
        );
      })}
    </>
  );
}

/**
 * How opaque a surface is drawn. In the Figure view the airframe is layered:
 * shells at 0.55 and inner tubes at 0.5, so the internals show through; the
 * Finished view has no layering. A part's own opacity multiplies either.
 */
export function drawnOpacity(p: Piece, look: Look, layered: boolean): number {
  const tier = !layered ? 1 : p.translucent ? 0.55 : p.innerGlass ? 0.5 : 1;
  return tier * look.opacity;
}
