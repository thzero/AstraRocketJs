import type { RocketTree } from '../../engine/openRocketEngine';
import { findNode } from '../design/treeEdit';
import { solidToStl, solidToObj, solidToGlb, STL_MIME, OBJ_MIME, GLB_MIME } from '../exports/meshExport';
import { download, exportFilename } from './saveFile';
import { designNameOf } from '../app/appInfo';
import { buildThreeMf, THREE_MF_MIME } from '../exports/threeMf';
import { colorForType } from '../design/partColors';
import { makeWatertight } from '../exports/solidMesh';
import { componentToDxf, DXF_MIME } from '../exports/dxfExport';
import type { ExportFormat } from './componentFormats';
import { solidFor } from '../exports/rocketPrintExport';

/**
 * The HEAVY half of per-component export: the dispatch that builds + downloads
 * one component as a mesh (STL/OBJ/GLB) or a DXF. Pulls in the meshers and the
 * DXF writer, so it's loaded on demand (store.exportComponent) rather than at
 * first paint. Which formats a part offers lives in the light `componentFormats`
 * module, imported by the tree's export button.
 */

/** Build and download one component in the given format. Returns false on a no-op. */
export async function exportComponent(
  tree: RocketTree,
  nodeId: string,
  format: ExportFormat,
  rocketName: string = designNameOf(tree, null),
): Promise<boolean> {
  const node = findNode(tree, nodeId);
  if (!node) return false;
  // Rocket first, then the part: a downloads folder holds the nose cones of
  // every design at once, and "Nose cone.stl" does not say whose.
  const name = (ext: string) => exportFilename([rocketName, node.name || node.type], ext, 'part');

  if (format === 'dxf') {
    const dxf = componentToDxf(tree, nodeId);
    if (dxf === null) return false;
    download(name('dxf'), dxf, DXF_MIME);
    return true;
  }

  const geometry = solidFor(tree, node);
  if (!geometry) return false;
  if (format === 'stl') download(name('stl'), solidToStl(geometry), STL_MIME);
  else if (format === 'obj') download(name('obj'), solidToObj(geometry), OBJ_MIME);
  else if (format === '3mf') {
    // The 3MF writer reads vertices and indices directly, so it needs the
    // welded/capped geometry the three.js exporters get from `meshGroup`.
    const parts = [
      { name: node.name || node.type, geometry: makeWatertight(geometry), color: colorForType(node.type) },
    ];
    download(name('3mf'), buildThreeMf(parts) as BlobPart, THREE_MF_MIME);
  } else download(name('glb'), await solidToGlb(geometry), GLB_MIME);
  return true;
}
