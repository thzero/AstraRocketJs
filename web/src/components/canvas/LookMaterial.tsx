import type { ThreeElements } from '@react-three/fiber';
import type { Look } from '../../services/design/appearance';
import { isSurfaced, SURFACE, type Piece, type RenderMode } from './rocketPieces';

/**
 * The materials a piece is drawn with, as `[attach, look]` pairs: one for a
 * piece whose geometry is not split by surface, one per surface for one that is.
 */
export function surfacesOf(p: Piece, mode: RenderMode): [string, Look][] {
  const looks = p.looks[mode];
  if (!isSurfaced(p.geometry)) return [['material', looks.outside]];
  return [
    [`material-${SURFACE.outside}`, looks.outside],
    [`material-${SURFACE.inside}`, looks.inside],
    [`material-${SURFACE.edges}`, looks.edges],
  ];
}

/**
 * One surface's material, lit the way desktop's realistic view lights it
 * (`RealisticRenderer.render`): the paint is the diffuse color, and the shine
 * is both the specular level and, times 100, the shininess.
 */
export function LookMaterial({
  look,
  ...rest
}: { look: Look; attach: string } & Omit<ThreeElements['meshPhongMaterial'], 'color' | 'specular' | 'shininess'>) {
  return (
    <meshPhongMaterial
      color={look.color}
      specular={[look.shine, look.shine, look.shine]}
      shininess={100 * look.shine}
      {...rest}
    />
  );
}
