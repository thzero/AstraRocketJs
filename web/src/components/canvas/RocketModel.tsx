import { useMemo } from 'react';
import * as THREE from 'three';
import { useHoverCursor } from '../common/useHoverCursor';
import type { Piece } from './rocketPieces';
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
}: {
  pieces: Piece[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Cutaway: the half-space to keep. Applied to the AIRFRAME only (hull and
   *  inner tubes) — what is inside them stays whole, so the view is a rocket
   *  with its side opened rather than a scene sliced in half. Nothing inside
   *  is cut, so there is no open cross-section to cap and no stencil pass. */
  clip?: THREE.Plane | null;
}) {
  const scene = useSceneColors();
  const hoverCursor = useHoverCursor();
  // One array for every material: a new [plane] each render would reallocate
  // (and re-upload) uniforms on every frame the component re-renders.
  const planes = useMemo(() => (clip ? [clip] : null), [clip]);
  // A hit on the removed side of a clipped part is a hit on something nobody
  // can see: the raycaster does not know about clipping planes. Returning
  // WITHOUT stopping propagation hands the event to the next intersection —
  // the far wall, or the mount behind it — which is the part actually under
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
            {/* See-through layering (batch 08-21d — 0.88 with depth writes
                  on looked opaque in practice): opaque pieces (motor, fins)
                  first, then glassy inner tubes, then the shell — depth writes
                  off for both see-through tiers so each layer shows through
                  the ones over it; DoubleSide draws far walls for depth. A
                  selected part glows sky-blue and turns opaque so it reads. */}
            <meshStandardMaterial
              color={selected ? scene['scene-selected'] : p.color}
              roughness={0.6}
              metalness={0.05}
              emissive={selected ? scene['scene-selected-glow'] : '#000000'}
              emissiveIntensity={selected ? 0.6 : 0}
              transparent={!selected && !cut && (!!p.translucent || !!p.innerGlass)}
              opacity={selected || cut ? 1 : p.translucent ? 0.55 : p.innerGlass ? 0.5 : 1}
              depthWrite={selected || cut || (!p.translucent && !p.innerGlass)}
              side={cut || (!selected && (p.translucent || p.innerGlass)) ? THREE.DoubleSide : THREE.FrontSide}
              clippingPlanes={cut ? planes : null}
            />
          </mesh>
        );
      })}
    </>
  );
}
