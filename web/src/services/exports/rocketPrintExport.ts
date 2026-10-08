import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { asStageNodes } from '../design/orkTree';
import { parentRadiusOf } from '../../tree/finPlanform';
import { findNode } from '../../tree/treeWalk';
import { discSolidForNode, makeWatertight, solidForNode } from './solidMesh';
import { resolveDisc } from '../design/discGeometry';
import { DISC_TYPES } from '../files/componentFormats';
import { printableParts } from './printableParts';
import { colorForType } from '../design/partColors';
import { buildThreeMf, THREE_MF_MIME, type ThreeMfPart } from './threeMf';
import { exportFilename, saveBlob, safeFilename } from '../files/saveFile';

/**
 * Whole-rocket 3MF export.
 *
 * The per-component ⬇ button has always been able to write one part at a time,
 * which is fine for reprinting a fin and tedious for printing a rocket. This
 * walks the design once, builds every printable solid, and writes them either
 * as ONE 3MF holding a named object per part — the thing 3MF is for — or as a
 * zip of one file per part, for a workflow that wants them separate.
 *
 * Parts with no solid are left out and NAMED: a parachute, a shock cord, a mass
 * component and a rail button have no printable body, and a part whose geometry
 * fails `solidForNode`'s manifold check would produce a file no slicer accepts.
 * Both are the caller's to report.
 *
 * The HEAVY half: this pulls in the three.js meshers and the 3MF writer, so it
 * is reached only through the dynamic import in `store.exportPrint`. Which
 * parts a design can print is `printableParts.ts`, which the export dialog
 * imports instead; a static import of this module from a dialog the header
 * mounts eagerly would put the meshers back in the main bundle.
 */

export interface PrintExportOptions {
  /** Node ids to include. Absent = everything printable. */
  include?: ReadonlySet<string>;
  /** One file of named objects (default), or a zip of one file per part. */
  separateFiles?: boolean;
  /** Translate each part onto the build plate (see `threeMf.ts`). */
  placeOnPlate?: boolean;
  /**
   * Display labels by node id, for parts that carry no name of their own.
   *
   * The object name is most of why 3MF beats STL, so "Nose cone" is worth
   * having in the file rather than the raw type slug. The translation belongs
   * to the UI, not to a service, so the caller passes what it is already
   * showing in its own list.
   */
  labels?: Readonly<Record<string, string>>;
}

export interface PrintExportResult {
  /** How many parts were written. */
  written: number;
  /** Names of parts that were asked for but have no printable solid. */
  skipped: string[];
}

/**
 * The solid for one node. A disc, ring or tube part needs its parent tube's
 * bore resolved to size it. Anything else is sized from the body radius it is
 * mounted on: a tube fin set takes the kernel auto-radius from it, and any fin
 * clamps a through-the-wall tab to the depth the kernel allows.
 */
export function solidFor(tree: RocketTree, node: ComponentNode): ReturnType<typeof solidForNode> {
  const id = node.id as string;
  if (DISC_TYPES.has(node.type)) {
    const d = resolveDisc(tree, id);
    return d ? discSolidForNode(d.outerR, d.innerR, d.length) : null;
  }
  return solidForNode(node, parentRadiusOf(tree, id));
}

/** A part by id, searched below the stages (a stage itself is never a part). */
function nodeById(tree: RocketTree, id: string): ComponentNode | null {
  return findNode(
    asStageNodes(tree).flatMap((stage) => stage.children ?? []),
    id,
  );
}

/**
 * Build and download the design's printable parts as 3MF.
 *
 * Returns what was written and what could not be, rather than throwing on the
 * first bad part: one fin with degenerate geometry should not cost you the
 * other twenty parts.
 */
export async function downloadRocket3mf(
  name: string,
  tree: RocketTree,
  opts: PrintExportOptions = {},
): Promise<PrintExportResult> {
  const { include, separateFiles = false, placeOnPlate = true, labels } = opts;

  const built: { part: ThreeMfPart; id: string }[] = [];
  const skipped: string[] = [];
  for (const entry of printableParts(tree)) {
    if (include && !include.has(entry.id)) continue;
    const node = nodeById(tree, entry.id);
    const geometry = node ? solidFor(tree, node) : null;
    if (!geometry) {
      skipped.push(entry.name || labels?.[entry.id] || entry.type);
      continue;
    }
    built.push({
      id: entry.id,
      part: {
        name: entry.name || labels?.[entry.id] || entry.type,
        geometry: makeWatertight(geometry),
        color: colorForType(entry.type),
      },
    });
  }

  if (built.length === 0) throw new Error('No printable parts were selected.');

  if (!separateFiles) {
    const bytes = buildThreeMf(
      built.map((b) => b.part),
      { placeOnPlate },
    );
    await saveBlob(new Blob([bytes as BlobPart], { type: THREE_MF_MIME }), exportFilename([name, 'print'], '3mf'));
    return { written: built.length, skipped };
  }

  // A zip of one file per part. `fflate` is already a dependency (it is how a
  // `.ork` is read and written), so this costs nothing extra.
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const b of built) {
    // Two parts can legitimately share a name ("Centering ring" twice), and a
    // zip entry cannot — the second would silently replace the first.
    let entry = safeFilename(b.part.name, b.part.name || 'part');
    let n = 2;
    while (used.has(entry)) entry = `${safeFilename(b.part.name, 'part')}-${n++}`;
    used.add(entry);
    files[`${entry}.3mf`] = buildThreeMf([b.part], { placeOnPlate });
  }
  await saveBlob(
    new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }),
    exportFilename([name, '3mf'], 'zip'),
  );
  return { written: built.length, skipped };
}
