import type { ComponentNode } from '../../engine/openRocketEngine';

/**
 * The material a new fin fillet is made of: West System Six10, a thickened epoxy
 * adhesive made for fillets and widely available. Desktop OpenRocket gives a fillet its default bulk
 * material, Cardboard, which no one fillets with. The material catalog's own
 * entry (`materials.generated.json`); a test holds the two equal.
 */
export const DEFAULT_FILLET_MATERIAL = {
  name: 'Epoxy - West System Six10',
  density: 1180,
  group: 'Adhesives',
} as const;

/**
 * The patch, plus the default fillet material when it adds a fillet to a part
 * that has none and names no material of its own.
 *
 * Only a fillet created here gets it. A fillet that arrived from a file without
 * a material keeps the file's meaning, Cardboard (see filletXml), and a fillet
 * that already has a material keeps it through any radius change.
 */
export function withFilletDefault(
  node: ComponentNode | null | undefined,
  patch: Partial<ComponentNode>,
): Partial<ComponentNode> {
  const radius = patch['filletRadius'];
  if (typeof radius !== 'number' || !(radius > 0)) return patch;
  const before = node?.['filletRadius'];
  if (typeof before === 'number' && before > 0) return patch;
  if (node?.['filletDensity'] !== undefined || patch['filletDensity'] !== undefined) return patch;
  return {
    ...patch,
    filletMaterialName: DEFAULT_FILLET_MATERIAL.name,
    filletDensity: DEFAULT_FILLET_MATERIAL.density,
    filletMaterialGroup: DEFAULT_FILLET_MATERIAL.group,
  };
}
