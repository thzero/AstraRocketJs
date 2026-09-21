import type { RocketTree } from '../engine/openRocketEngine';
import { findNode } from './treeEdit';
import { parentRadiusOf } from '../tree/finPlanform';
import { solidForNode, discSolid } from './solidMesh';
import { solidToStl, solidToObj, solidToGlb, STL_MIME, OBJ_MIME, GLB_MIME } from './meshExport';
import { download, safeFilename } from './saveFile';
import { buildThreeMf, THREE_MF_MIME } from './threeMf';
import { colorForType } from './partColors';
import { makeWatertight } from './solidMesh';
import { componentToDxf, resolveDisc, DXF_MIME } from './dxfExport';
import { DISC_TYPES, type ExportFormat } from './componentFormats';

/**
 * The HEAVY half of per-component export: the dispatch that builds + downloads
 * one component as a mesh (STL/OBJ/GLB) or a DXF. Pulls in the meshers and the
 * DXF writer, so it's loaded on demand (store.exportComponent) rather than at
 * first paint. Which formats a part offers lives in the light `componentFormats`
 * module, imported by the tree's export button.
 */

/** Build and download one component in the given format. Returns false on a no-op. */
export async function exportComponent(tree: RocketTree, nodeId: string, format: ExportFormat): Promise<boolean> {
  const node = findNode(tree, nodeId);
  if (!node) return false;
  const base = safeFilename(node.name || node.type, 'part');

  if (format === 'dxf') {
    const dxf = componentToDxf(tree, nodeId);
    if (dxf === null) return false;
    download(`${base}.dxf`, dxf, DXF_MIME);
    return true;
  }

  // Disc/ring/tube parts need the parent tube's bore to size the solid; others
  // are self-contained.
  let geometry = null;
  if (DISC_TYPES.has(node.type)) {
    const d = resolveDisc(tree, nodeId);
    if (d) geometry = discSolid(d.outerR, d.innerR, d.length);
  } else {
    // The body radius the part is mounted on. A tube fin set needs it to size
    // itself (the kernel auto-radius), and any fin needs it to clamp a
    // through-the-wall tab to the depth the kernel allows.
    geometry = solidForNode(node, parentRadiusOf(tree, nodeId));
  }
  if (!geometry) return false;
  if (format === 'stl') download(`${base}.stl`, solidToStl(geometry), STL_MIME);
  else if (format === 'obj') download(`${base}.obj`, solidToObj(geometry), OBJ_MIME);
  else if (format === '3mf') {
    // The 3MF writer reads vertices and indices directly, so it needs the
    // welded/capped geometry the three.js exporters get from `meshGroup`.
    const parts = [
      { name: node.name || node.type, geometry: makeWatertight(geometry), color: colorForType(node.type) },
    ];
    download(`${base}.3mf`, buildThreeMf(parts) as BlobPart, THREE_MF_MIME);
  } else download(`${base}.glb`, await solidToGlb(geometry), GLB_MIME);
  return true;
}
