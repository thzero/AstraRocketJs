import type { ComponentNode } from '../../engine/openRocketEngine';

/**
 * Surface and airfoil mapping: our finish ids and airfoil-section ids to the
 * strings RASAero's global <Surface> and per-fin <AirfoilSection> accept.
 */

/** Our airfoilSection ids → RASAero's supersonic airfoil strings (feature #4). */
export const SECTION_TO_AIRFOIL: Record<string, string> = {
  doublewedge: 'Double Wedge',
  hexbluntbase: 'Hexagonal Blunt Base',
  hexagonal: 'Hexagonal',
  naca: 'NACA',
  biconvex: 'Biconvex',
  singlewedge: 'Single Wedge',
};

/**
 * Our finish ids (the .ork spelling: ExternalComponent.Finish lowercased) to
 * RASAero's global surface strings, transcribed VERBATIM from the desktop's
 * RASAeroCommonConstants.OPENROCKET_TO_RASAERO_SURFACE (lines 370-391). The
 * earlier table was "approx" and disagreed with it on three rows: `polished`
 * went to Sheet Metal (the desktop sends OPTIMUM there and lets POLISHED fall
 * to the default), `smooth` to Smooth Paint (desktop: Camouflage Paint) and
 * `rough` to Cast Iron (desktop: ROUGHUNFINISHED). ROUGH and POLISHED have no
 * row in the desktop either; they take {@link RASAERO_SURFACE_DEFAULT} with a
 * warning, exactly as its `else` branch does.
 */
const FINISH_TO_SURFACE: Readonly<Record<string, string>> = {
  mirror: 'Smooth (Zero Roughness)',
  finishpolished: 'Polished',
  optimum: 'Sheet Metal',
  smooth: 'Camouflage Paint',
  normal: 'Rough Camouflage Paint',
  unfinished: 'Galvanized Metal',
  roughunfinished: 'Cast Iron (Very Rough)',
};
export const RASAERO_SURFACE_DEFAULT = 'Smooth (Zero Roughness)';

/** The RASAero surface for a finish id, with the desktop's warning when it has no row. */
export function rasaeroSurface(finish: string): { surface: string; warning?: string } {
  const surface = FINISH_TO_SURFACE[finish];
  if (surface) return { surface };
  return {
    surface: RASAERO_SURFACE_DEFAULT,
    warning: `Unknown surface finish: ${finish}, defaulting to Smooth.`,
  };
}

/**
 * Global surface: the desktop takes it from the first nose cone's finish
 * (RocketDesignDTO.java:108); with none, the first part carrying a finish.
 * A part with no finish key has the kernel's default, NORMAL.
 */
export function designSurface(stagesIn: ComponentNode[], warnings: string[] | undefined): string {
  const finishOf = (n: ComponentNode | undefined) =>
    n ? (typeof n['finish'] === 'string' ? (n['finish'] as string) : 'normal') : undefined;
  const walk = (nodes: ComponentNode[]): string | undefined => {
    for (const n of nodes) {
      if (typeof n['finish'] === 'string') return n['finish'] as string;
      const hit = walk(n.children ?? []);
      if (hit) return hit;
    }
    return undefined;
  };
  const finish =
    finishOf((stagesIn[0]!.children ?? []).find((n) => n.type === 'nosecone')) ?? walk(stagesIn) ?? 'normal';
  const mapped = rasaeroSurface(finish);
  if (mapped.warning) warnings?.push(mapped.warning);
  return mapped.surface;
}
