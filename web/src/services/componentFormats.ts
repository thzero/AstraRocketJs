// The LIGHT half of per-component export: which formats each component type can
// produce. Deliberately free of heavy imports (no three.js meshers, no DXF
// writer) so a UI affordance — the tree's ⬇ button — can ask "what can this part
// export?" without pulling the whole exporter into the main bundle. The heavy
// dispatch that actually builds + downloads a file lives in componentExport.ts
// and is loaded on demand (store.exportComponent).

export type ExportFormat = 'stl' | 'obj' | 'glb' | 'dxf';

/** Disc / ring / tube parts — solids of revolution needing parent-tube context. */
export const DISC_TYPES = new Set(['centeringring', 'bulkhead', 'tubecoupler', 'engineblock']);

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

/** Flat parts that cut from sheet stock — exported as a 2D DXF outline. Bodies of
 *  revolution aren't here: they export as 3D solids (STL/OBJ/GLB) instead. */
export const DXF_CUTTABLE = new Set([
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'centeringring',
  'bulkhead',
]);

/** The export formats a component type supports, in menu order (empty = none). */
export function componentFormats(type: string): ExportFormat[] {
  const formats: ExportFormat[] = [];
  if (MESH_TYPES.has(type)) formats.push('stl', 'obj', 'glb');
  if (DXF_CUTTABLE.has(type)) formats.push('dxf');
  return formats;
}
