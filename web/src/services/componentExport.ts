import type { RocketTree } from '../engine/openRocketEngine';
import { findNode } from './treeEdit';
import { solidForNode, discSolid } from './solidMesh';
import { solidToStl, solidToObj, solidToGlb, safeName, downloadFile, STL_MIME, OBJ_MIME, GLB_MIME } from './meshExport';
import { componentToDxf, resolveDisc, DXF_MIME, DXF_CUTTABLE } from './dxfExport';

/**
 * Per-component export: which formats a component type can produce, and the
 * dispatch that builds + downloads one. Not every part is exportable — only the
 * geometric structural ones — so the tree only offers export where it means
 * something (a parachute or a mass has no object to export).
 */

export type ExportFormat = 'stl' | 'obj' | 'glb' | 'dxf';

/** Disc / ring / tube parts — solids of revolution needing parent-tube context. */
const DISC_TYPES = new Set(['centeringring', 'bulkhead', 'tubecoupler', 'engineblock']);

/** Types with a 3D-printable solid body (STL / OBJ / GLB). */
const MESH_TYPES = new Set([
  'nosecone',
  'bodytube',
  'transition',
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'innertube',
  'launchlug',
  'tubefinset',
  ...DISC_TYPES,
]);

/** The export formats a component type supports, in menu order (empty = none). */
export function componentFormats(type: string): ExportFormat[] {
  const formats: ExportFormat[] = [];
  if (MESH_TYPES.has(type)) formats.push('stl', 'obj', 'glb');
  if (DXF_CUTTABLE.has(type)) formats.push('dxf');
  return formats;
}

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
