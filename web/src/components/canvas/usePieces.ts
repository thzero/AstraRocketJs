import { useEffect, useMemo } from 'react';
import type { RocketTree } from '../../engine/openRocketEngine';
import type { PartPalette } from '../../services/design/partColors';
import type { MotorDims } from '../../tree/schematicGeometry';
import { buildPieces } from './rocketPieces';

/**
 * The 3D geometry for a design, rebuilt when the tree, the motors or the
 * palette change. Mesh keys are stable across rebuilds, so R3F never unmounts
 * or auto-disposes the swapped-out geometries; this releases each set when it
 * is replaced or the view unmounts, or every edit leaks a full set of GPU
 * buffers.
 */
export function usePieces(tree: RocketTree, motors: MotorDims | undefined, palette: PartPalette) {
  const built = useMemo(() => buildPieces(tree, motors, palette), [tree, motors, palette]);
  const { pieces } = built;
  useEffect(
    () => () => {
      for (const p of pieces) p.geometry.dispose();
    },
    [pieces],
  );
  return built;
}
