import * as THREE from 'three';
import { useHoverCursor } from '../common/useHoverCursor';
import type { Piece } from './rocketPieces';

/**
 * Owns the rocket body in the 3D scene: one <mesh> per Piece with the
 * see-through layering, the selection glow and the click/hover wiring back to
 * the component tree. Geometry lifetime stays with whoever built the pieces.
 */
export function RocketModel({
  pieces,
  selectedId,
  onSelect,
}: {
  pieces: Piece[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const hoverCursor = useHoverCursor();
  return (
    <>
      {pieces.map((p) => {
        const selected = !!p.id && p.id === selectedId;
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
                    e.stopPropagation();
                    onSelect(p.id!);
                  }
                : undefined
            }
            onPointerOver={
              p.id && onSelect
                ? (e) => {
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
              color={selected ? '#7dd3fc' : p.color}
              roughness={0.6}
              metalness={0.05}
              emissive={selected ? '#0284c7' : '#000000'}
              emissiveIntensity={selected ? 0.6 : 0}
              transparent={!selected && (!!p.translucent || !!p.innerGlass)}
              opacity={selected ? 1 : p.translucent ? 0.55 : p.innerGlass ? 0.5 : 1}
              depthWrite={selected || (!p.translucent && !p.innerGlass)}
              side={!selected && (p.translucent || p.innerGlass) ? THREE.DoubleSide : THREE.FrontSide}
            />
          </mesh>
        );
      })}
    </>
  );
}
