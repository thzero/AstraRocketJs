import type { RocketTree } from '../engine/openRocketEngine';
import { findNode } from './treeEdit';
import { solidForNode, discSolid } from './solidMesh';
import { solidToStl, solidToObj, solidToGlb, safeName, downloadFile, STL_MIME, OBJ_MIME, GLB_MIME } from './meshExport';
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
  const base = safeName(node.name || node.type);

  if (format === 'dxf') {
    const dxf = componentToDxf(tree, nodeId);
    if (dxf === null) return false;
    downloadFile(dxf, `${base}.dxf`, DXF_MIME);
    return true;
  }

  // Disc/ring/tube parts need the parent tube's bore to size the solid; others
  // are self-contained.
  let geometry = null;
  if (DISC_TYPES.has(node.type)) {
    const d = resolveDisc(tree, nodeId);
    if (d) geometry = discSolid(d.outerR, d.innerR, d.length);
  } else {
    geometry = solidForNode(node);
  }
  if (!geometry) return false;
  if (format === 'stl') downloadFile(solidToStl(geometry), `${base}.stl`, STL_MIME);
  else if (format === 'obj') downloadFile(solidToObj(geometry), `${base}.obj`, OBJ_MIME);
  else downloadFile(await solidToGlb(geometry), `${base}.glb`, GLB_MIME);
  return true;
}
