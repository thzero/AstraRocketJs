import type { ComponentNode, ComponentType, RocketTree } from '../../engine/openRocketEngine';
import { asStageNodes } from '../design/orkTree';
import { isPrintable } from '../files/componentFormats';

/**
 * The LIGHT half of the whole-rocket print export: WHICH parts of a design can
 * be printed, with no ability to build one.
 *
 * Deliberately free of heavy imports (no three.js meshers, no 3MF writer), the
 * way `componentFormats` is for the per-component ⬇ button, so the export
 * dialog can list the parts and tick them without pulling the builders in
 * behind it. `rocketPrintExport.ts` is the heavy on-demand half, reached only
 * through the dynamic import in `store.exportPrint`: a static import of it from
 * a dialog that the header mounts eagerly puts the meshers in the main bundle
 * and the dynamic import stops splitting anything.
 */

/** One entry of the export's selection tree, in the order the design has them. */
export interface PrintablePart {
  /** The component's node id — what a selection is keyed by. */
  id: string;
  /** The component's OWN name, or '' when it has none. The picker falls back to
   *  the translated type label, exactly as the component tree does — naming it
   *  here would put i18n in a service and print "nosecone" in the dialog. */
  name: string;
  type: ComponentType;
  /** Nesting depth, so a picker can indent without re-walking the tree. */
  depth: number;
}

/** Every printable component in the design, depth-first, in tree order. */
export function printableParts(tree: RocketTree): PrintablePart[] {
  const out: PrintablePart[] = [];
  const walk = (nodes: ComponentNode[] | undefined, depth: number): void => {
    for (const n of nodes ?? []) {
      const id = n.id;
      if (id && isPrintable(n.type)) out.push({ id, name: n.name ?? '', type: n.type, depth });
      // Recurse whatever the parent was: a body tube is printable and so are
      // the rings inside it, and an unprintable parent (a stage, a pod set)
      // still has printable children.
      walk(n.children, depth + (id && isPrintable(n.type) ? 1 : 0));
    }
  };
  for (const stage of asStageNodes(tree)) walk(stage.children, 0);
  return out;
}
