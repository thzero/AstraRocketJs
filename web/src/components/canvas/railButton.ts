import type { ComponentNode } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { KERNEL_RAILBUTTON_OUTER_DIAMETER } from '../../tree/kernelDefaults';
import { COMPONENT_DEFAULTS } from '../../services/design/componentDefaults';

/**
 * A rail button's size as the views draw it: `diameter` across, its outer
 * diameter (RailButton's own default when absent), and `reach` out from the
 * body, its total height plus the screw head on top of the flange, as the
 * kernel bounds an instance (`RailButton.getInstanceBoundingBox`). Each absent
 * height is the kernel's: a total height of 9.7 mm and no screw.
 */
export function railButtonSize(node: ComponentNode): { diameter: number; reach: number } {
  const height = Math.max(0, num(node, 'height', COMPONENT_DEFAULTS.railbutton.height));
  const screw = Math.max(0, num(node, 'screwHeight', COMPONENT_DEFAULTS.railbutton.screwHeight));
  return { diameter: num(node, 'outerDiameter', KERNEL_RAILBUTTON_OUTER_DIAMETER), reach: height + screw };
}
