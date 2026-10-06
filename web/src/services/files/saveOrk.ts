import { zipSync, strToU8 } from 'fflate';
import { exportOrk, type OrkTreeExportInput } from './orkFile';
import { saveBlob, exportFilename } from './saveFile';
import type { RocketTree } from '../../engine/openRocketEngine';

/** The bytes of a .ork: a zip holding rocket.ork and the curve of every motor outside the catalog. */
export function orkArchive(input: OrkTreeExportInput): Uint8Array {
  const xml = exportOrk(input);
  const files: Record<string, Uint8Array> = { 'rocket.ork': strToU8(xml) };
  // The curve of every motor outside the catalog that any configuration flies,
  // once each, where the desktop looks for it (`thrustcurves/<digest>.rse`).
  for (const config of input.configs ?? []) {
    for (const m of Object.values(config.motors ?? {})) {
      if (m.embedded) files[m.embedded.path] ??= strToU8(m.embedded.text);
    }
  }
  return zipSync(files, { level: 6 });
}

/** Build a .ork Blob from an export input. */
function orkBlob(input: OrkTreeExportInput): Blob {
  return new Blob([orkArchive(input) as BlobPart], { type: 'application/vnd.openrocket.ork' });
}

/** Export a design as a .ork file the user downloads. */
export function downloadOrk(input: OrkTreeExportInput): void {
  void saveBlob(orkBlob(input), exportFilename([input.name, 'design'], 'ork'));
}

/**
 * Export a design as a RockSim `.rkt` file, returning the component types that
 * had no RockSim element.
 *
 * Plain XML, not a zip: RockSim does not archive its files. The skipped list
 * comes back to the caller rather than being swallowed, so the user is told
 * what is missing from a file they are about to hand to somebody else.
 */
export async function downloadRkt(name: string, tree: RocketTree): Promise<string[]> {
  const { exportRkt } = await import('./rktExport');
  const { xml, skipped } = exportRkt(name, tree);
  await saveBlob(new Blob([xml], { type: 'application/xml' }), exportFilename([name, 'design'], 'rkt'));
  return skipped;
}
